/**
 * TimescaleDB Storage Adapter
 * 
 * Provides persistent storage for production events using TimescaleDB.
 * Handles connection pooling, data compression, and efficient queries.
 */

import pg from 'pg';
import Redis from 'ioredis';
import { EventEmitter } from 'events';

const { Pool } = pg;

class TimescaleAdapter extends EventEmitter {
  constructor(config = {}) {
    super();
    
    // PostgreSQL/TimescaleDB configuration
    this.pgConfig = {
      host: config.dbHost || process.env.DB_HOST || 'localhost',
      port: config.dbPort || process.env.DB_PORT || 5432,
      database: config.dbName || process.env.DB_NAME || 'traversion',
      user: config.dbUser || process.env.DB_USER || 'traversion',
      password: config.dbPassword || process.env.DB_PASSWORD || 'traversion_secret',
      max: config.maxConnections || 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    };
    
    // Redis configuration for caching
    this.redisConfig = {
      host: config.redisHost || process.env.REDIS_HOST || 'localhost',
      port: config.redisPort || process.env.REDIS_PORT || 6379,
      password: config.redisPassword || process.env.REDIS_PASSWORD,
      db: config.redisDb || 0,
      retryStrategy: (times) => Math.min(times * 50, 2000)
    };
    
    this.pool = null;
    this.redis = null;
    this.connected = false;
    
    // Cache settings
    this.cacheEnabled = config.cacheEnabled !== false;
    this.cacheTTL = config.cacheTTL || 300; // 5 minutes default
    
    // Batch settings for bulk inserts
    this.batchSize = config.batchSize || 1000;
    this.batchInterval = config.batchInterval || 1000; // 1 second
    this.eventBatch = [];
    this.batchTimer = null;
  }

  /**
   * Connect to databases
   */
  async connect() {
    try {
      // Connect to PostgreSQL/TimescaleDB
      this.pool = new Pool(this.pgConfig);
      
      // Test connection
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      
      console.log('✓ Connected to TimescaleDB');
      
      // Connect to Redis if caching is enabled
      if (this.cacheEnabled) {
        this.redis = new Redis(this.redisConfig);
        
        this.redis.on('connect', () => {
          console.log('✓ Connected to Redis');
        });
        
        this.redis.on('error', (err) => {
          console.error('Redis error:', err);
        });
      }
      
      this.connected = true;
      this.emit('connected');
      
      // Start batch processing
      this.startBatchProcessor();
      
      return true;
    } catch (error) {
      console.error('Database connection failed:', error);
      throw error;
    }
  }

  /**
   * Store an event
   */
  async storeEvent(event) {
    if (!this.connected) {
      throw new Error('Storage not connected');
    }
    
    // Add to batch
    this.eventBatch.push(event);
    
    // Flush if batch is full
    if (this.eventBatch.length >= this.batchSize) {
      await this.flushBatch();
    }
    
    return event.eventId;
  }

  /**
   * Store multiple events in bulk
   */
  async storeEvents(events) {
    if (!this.connected) {
      throw new Error('Storage not connected');
    }
    
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Prepare bulk insert
      const values = [];
      const placeholders = [];
      let paramIndex = 1;
      
      for (const event of events) {
        // Ensure service exists
        const serviceId = await this.ensureService(client, event.serviceId, event.serviceName);
        
        placeholders.push(`(
          $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++},
          $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++},
          $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}
        )`);
        
        values.push(
          event.eventId,
          new Date(event.timestamp),
          serviceId,
          event.serviceName,
          event.eventType,
          event.traceId || null,
          event.spanId || null,
          event.parentSpanId || null,
          JSON.stringify(event.data || {}),
          JSON.stringify(event.metadata || {}),
          event.tags || [],
          event.anomalyScore || 0
        );
      }
      
      const query = `
        INSERT INTO traversion.events (
          event_id, timestamp, service_id, service_name, event_type,
          trace_id, span_id, parent_span_id, data, metadata, tags, anomaly_score
        ) VALUES ${placeholders.join(', ')}
        ON CONFLICT (event_id) DO NOTHING
      `;
      
      await client.query(query, values);
      await client.query('COMMIT');
      
      this.emit('events:stored', { count: events.length });
      
      // Invalidate relevant caches
      if (this.cacheEnabled && this.redis) {
        await this.invalidateCache('timeline:*');
      }
      
      return events.length;
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Failed to store events:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Store causality relationship
   */
  async storeCausality(causeEventId, effectEventId, confidence, type) {
    const query = `
      INSERT INTO traversion.causality (
        cause_event_id, effect_event_id, confidence, causality_type
      ) VALUES ($1, $2, $3, $4)
      ON CONFLICT (cause_event_id, effect_event_id) 
      DO UPDATE SET confidence = GREATEST(causality.confidence, $3)
    `;
    
    try {
      await this.pool.query(query, [causeEventId, effectEventId, confidence, type]);
    } catch (error) {
      console.error('Failed to store causality:', error);
      throw error;
    }
  }

  /**
   * Query events in time range
   */
  async queryTimeRange(startTime, endTime, filters = {}) {
    const cacheKey = `timeline:${startTime}:${endTime}:${JSON.stringify(filters)}`;
    
    // Check cache
    if (this.cacheEnabled && this.redis) {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    }
    
    let query = `
      SELECT * FROM traversion.events
      WHERE timestamp >= $1 AND timestamp <= $2
    `;
    
    const params = [new Date(startTime), new Date(endTime)];
    let paramIndex = 3;
    
    // Add filters
    if (filters.serviceId) {
      query += ` AND service_id = $${paramIndex}`;
      params.push(filters.serviceId);
      paramIndex++;
    }
    
    if (filters.eventType) {
      query += ` AND event_type = $${paramIndex}`;
      params.push(filters.eventType);
      paramIndex++;
    }
    
    if (filters.minAnomalyScore) {
      query += ` AND anomaly_score >= $${paramIndex}`;
      params.push(filters.minAnomalyScore);
      paramIndex++;
    }
    
    query += ' ORDER BY timestamp ASC LIMIT 10000';
    
    try {
      const result = await this.pool.query(query, params);
      
      // Cache result
      if (this.cacheEnabled && this.redis) {
        await this.redis.setex(cacheKey, this.cacheTTL, JSON.stringify(result.rows));
      }
      
      return result.rows;
    } catch (error) {
      console.error('Query failed:', error);
      throw error;
    }
  }

  /**
   * Get system state at specific time
   */
  async getSystemStateAt(timestamp) {
    const query = `SELECT * FROM traversion.get_system_state_at($1)`;
    
    try {
      const result = await this.pool.query(query, [new Date(timestamp)]);
      return result.rows;
    } catch (error) {
      console.error('Failed to get system state:', error);
      throw error;
    }
  }

  /**
   * Find root cause of an error
   */
  async findRootCause(errorEventId) {
    const query = `SELECT * FROM traversion.find_root_cause($1)`;
    
    try {
      const result = await this.pool.query(query, [errorEventId]);
      return result.rows;
    } catch (error) {
      console.error('Failed to find root cause:', error);
      throw error;
    }
  }

  /**
   * Get event by ID
   */
  async getEvent(eventId) {
    const cacheKey = `event:${eventId}`;
    
    // Check cache
    if (this.cacheEnabled && this.redis) {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    }
    
    const query = `SELECT * FROM traversion.events WHERE event_id = $1`;
    
    try {
      const result = await this.pool.query(query, [eventId]);
      const event = result.rows[0] || null;
      
      // Cache result
      if (this.cacheEnabled && this.redis && event) {
        await this.redis.setex(cacheKey, this.cacheTTL, JSON.stringify(event));
      }
      
      return event;
    } catch (error) {
      console.error('Failed to get event:', error);
      throw error;
    }
  }

  /**
   * Get causality chain
   */
  async getCausalityChain(eventId, direction = 'backward', maxDepth = 50) {
    const query = direction === 'backward' 
      ? `
        WITH RECURSIVE chain AS (
          SELECT e.*, 0 as depth
          FROM traversion.events e
          WHERE e.event_id = $1
          
          UNION ALL
          
          SELECT e.*, c.depth + 1
          FROM chain c
          JOIN traversion.causality ca ON ca.effect_event_id = c.event_id
          JOIN traversion.events e ON e.event_id = ca.cause_event_id
          WHERE c.depth < $2
        )
        SELECT * FROM chain ORDER BY depth
      `
      : `
        WITH RECURSIVE chain AS (
          SELECT e.*, 0 as depth
          FROM traversion.events e
          WHERE e.event_id = $1
          
          UNION ALL
          
          SELECT e.*, c.depth + 1
          FROM chain c
          JOIN traversion.causality ca ON ca.cause_event_id = c.event_id
          JOIN traversion.events e ON e.event_id = ca.effect_event_id
          WHERE c.depth < $2
        )
        SELECT * FROM chain ORDER BY depth
      `;
    
    try {
      const result = await this.pool.query(query, [eventId, maxDepth]);
      return result.rows;
    } catch (error) {
      console.error('Failed to get causality chain:', error);
      throw error;
    }
  }

  /**
   * Store a pattern
   */
  async storePattern(pattern) {
    const query = `
      INSERT INTO traversion.patterns (
        pattern_hash, pattern_type, signature, occurrences, last_seen
      ) VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (pattern_hash) 
      DO UPDATE SET 
        occurrences = patterns.occurrences + 1,
        last_seen = NOW()
    `;
    
    const patternHash = this.hashPattern(pattern);
    
    try {
      await this.pool.query(query, [
        patternHash,
        pattern.type,
        JSON.stringify(pattern.signature),
        1
      ]);
    } catch (error) {
      console.error('Failed to store pattern:', error);
      throw error;
    }
  }

  /**
   * Get metrics for time range
   */
  async getMetrics(startTime, endTime, metricName = null) {
    let query = `
      SELECT 
        time_bucket('1 minute', timestamp) AS minute,
        metric_name,
        AVG(metric_value) as avg_value,
        MAX(metric_value) as max_value,
        MIN(metric_value) as min_value
      FROM traversion.metrics
      WHERE timestamp >= $1 AND timestamp <= $2
    `;
    
    const params = [new Date(startTime), new Date(endTime)];
    
    if (metricName) {
      query += ' AND metric_name = $3';
      params.push(metricName);
    }
    
    query += ' GROUP BY minute, metric_name ORDER BY minute';
    
    try {
      const result = await this.pool.query(query, params);
      return result.rows;
    } catch (error) {
      console.error('Failed to get metrics:', error);
      throw error;
    }
  }

  /**
   * Helper methods
   */
  
  async ensureService(client, serviceId, serviceName) {
    const query = `
      INSERT INTO traversion.services (service_id, service_name)
      VALUES ($1, $2)
      ON CONFLICT (service_id) DO UPDATE SET service_name = $2
      RETURNING id
    `;
    
    const result = await client.query(query, [serviceId, serviceName]);
    return result.rows[0].id;
  }
  
  hashPattern(pattern) {
    const crypto = require('crypto');
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(pattern))
      .digest('hex');
  }
  
  async invalidateCache(pattern) {
    if (!this.redis) return;
    
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
  
  startBatchProcessor() {
    this.batchTimer = setInterval(() => {
      if (this.eventBatch.length > 0) {
        this.flushBatch();
      }
    }, this.batchInterval);
  }
  
  async flushBatch() {
    if (this.eventBatch.length === 0) return;
    
    const events = [...this.eventBatch];
    this.eventBatch = [];
    
    try {
      await this.storeEvents(events);
    } catch (error) {
      // Re-add events to batch on failure
      this.eventBatch.unshift(...events);
      console.error('Batch flush failed:', error);
    }
  }

  /**
   * Get statistics
   */
  async getStats() {
    const query = `
      SELECT 
        (SELECT COUNT(*) FROM traversion.events) as total_events,
        (SELECT COUNT(DISTINCT service_id) FROM traversion.events) as total_services,
        (SELECT COUNT(*) FROM traversion.causality) as total_causalities,
        (SELECT COUNT(*) FROM traversion.patterns) as total_patterns,
        (SELECT pg_size_pretty(pg_database_size(current_database()))) as database_size,
        (SELECT COUNT(*) FROM traversion.events WHERE timestamp > NOW() - INTERVAL '1 hour') as events_last_hour
    `;
    
    try {
      const result = await this.pool.query(query);
      return result.rows[0];
    } catch (error) {
      console.error('Failed to get stats:', error);
      throw error;
    }
  }

  /**
   * Cleanup and disconnect
   */
  async disconnect() {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
    }
    
    // Flush remaining events
    await this.flushBatch();
    
    if (this.redis) {
      await this.redis.quit();
    }
    
    if (this.pool) {
      await this.pool.end();
    }
    
    this.connected = false;
    this.emit('disconnected');
  }
}

export default TimescaleAdapter;