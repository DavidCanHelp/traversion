import { jest } from '@jest/globals';
import TimescaleAdapter from '../../src/storage/timescaleAdapter.js';
import pg from 'pg';
import Redis from 'ioredis';

// Mock dependencies
jest.mock('pg');
jest.mock('ioredis');
jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

describe('TimescaleAdapter', () => {
  let adapter;
  let mockPool;
  let mockClient;
  let mockRedis;

  beforeEach(() => {
    // Setup mock pool
    mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };

    mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient),
      query: jest.fn(),
      end: jest.fn()
    };

    pg.Pool = jest.fn().mockReturnValue(mockPool);

    // Setup mock Redis
    mockRedis = {
      get: jest.fn(),
      set: jest.fn(),
      setex: jest.fn(),
      del: jest.fn(),
      keys: jest.fn().mockResolvedValue([]),
      quit: jest.fn(),
      on: jest.fn()
    };

    Redis.mockReturnValue(mockRedis);

    adapter = new TimescaleAdapter();
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (adapter.batchTimer) {
      clearInterval(adapter.batchTimer);
    }
  });

  describe('constructor', () => {
    test('should initialize with default configuration', () => {
      expect(adapter.pgConfig.host).toBe('localhost');
      expect(adapter.pgConfig.port).toBe(5432);
      expect(adapter.pgConfig.database).toBe('traversion');
      expect(adapter.pgConfig.user).toBe('traversion');
      expect(adapter.pgConfig.max).toBe(20);
    });

    test('should initialize with custom configuration', () => {
      const customAdapter = new TimescaleAdapter({
        dbHost: 'custom-host',
        dbPort: 5433,
        dbName: 'custom-db',
        batchSize: 500,
        cacheTTL: 600
      });

      expect(customAdapter.pgConfig.host).toBe('custom-host');
      expect(customAdapter.pgConfig.port).toBe(5433);
      expect(customAdapter.pgConfig.database).toBe('custom-db');
      expect(customAdapter.batchSize).toBe(500);
      expect(customAdapter.cacheTTL).toBe(600);
    });

    test('should respect environment variables', () => {
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        DB_HOST: 'env-host',
        DB_PORT: '5434',
        REDIS_HOST: 'redis-env'
      };

      const envAdapter = new TimescaleAdapter();
      expect(envAdapter.pgConfig.host).toBe('env-host');
      expect(envAdapter.pgConfig.port).toBe('5434');
      expect(envAdapter.redisConfig.host).toBe('redis-env');

      process.env = originalEnv;
    });

    test('should initialize batch processing settings', () => {
      expect(adapter.batchSize).toBe(1000);
      expect(adapter.batchInterval).toBe(1000);
      expect(adapter.eventBatch).toEqual([]);
      expect(adapter.batchTimer).toBeNull();
    });
  });

  describe('connect', () => {
    test('should connect to PostgreSQL/TimescaleDB', async () => {
      mockClient.query.mockResolvedValue({ rows: [] });

      await adapter.connect();

      expect(pg.Pool).toHaveBeenCalledWith(adapter.pgConfig);
      expect(mockPool.connect).toHaveBeenCalled();
      expect(mockClient.query).toHaveBeenCalledWith('SELECT NOW()');
      expect(mockClient.release).toHaveBeenCalled();
      expect(adapter.connected).toBe(true);
    });

    test('should connect to Redis when caching is enabled', async () => {
      mockClient.query.mockResolvedValue({ rows: [] });

      await adapter.connect();

      expect(Redis).toHaveBeenCalledWith(adapter.redisConfig);
      expect(adapter.redis).toBe(mockRedis);
    });

    test('should not connect to Redis when caching is disabled', async () => {
      mockClient.query.mockResolvedValue({ rows: [] });
      
      const noCacheAdapter = new TimescaleAdapter({ cacheEnabled: false });
      await noCacheAdapter.connect();

      expect(noCacheAdapter.redis).toBeNull();
    });

    test('should emit connected event', async () => {
      mockClient.query.mockResolvedValue({ rows: [] });
      const emitSpy = jest.spyOn(adapter, 'emit');

      await adapter.connect();

      expect(emitSpy).toHaveBeenCalledWith('connected');
    });

    test('should start batch processor', async () => {
      mockClient.query.mockResolvedValue({ rows: [] });
      const startBatchSpy = jest.spyOn(adapter, 'startBatchProcessor');

      await adapter.connect();

      expect(startBatchSpy).toHaveBeenCalled();
      expect(adapter.batchTimer).toBeDefined();
    });

    test('should handle connection errors', async () => {
      const error = new Error('Connection failed');
      mockPool.connect.mockRejectedValue(error);

      await expect(adapter.connect()).rejects.toThrow('Connection failed');
      expect(adapter.connected).toBe(false);
    });
  });

  describe('storeEvent', () => {
    beforeEach(async () => {
      mockClient.query.mockResolvedValue({ rows: [] });
      await adapter.connect();
    });

    test('should add event to batch', async () => {
      const event = {
        eventId: 'event1',
        timestamp: Date.now(),
        serviceId: 'service1',
        eventType: 'request'
      };

      const result = await adapter.storeEvent(event);

      expect(adapter.eventBatch).toContain(event);
      expect(result).toBe('event1');
    });

    test('should flush batch when full', async () => {
      const flushSpy = jest.spyOn(adapter, 'flushBatch');
      flushSpy.mockResolvedValue();

      adapter.batchSize = 2;
      
      await adapter.storeEvent({ eventId: 'event1' });
      await adapter.storeEvent({ eventId: 'event2' });

      expect(flushSpy).toHaveBeenCalled();
    });

    test('should throw error if not connected', async () => {
      adapter.connected = false;

      await expect(adapter.storeEvent({ eventId: 'event1' }))
        .rejects.toThrow('Storage not connected');
    });
  });

  describe('storeEvents', () => {
    beforeEach(async () => {
      mockClient.query.mockResolvedValue({ 
        rows: [{ id: 1 }] 
      });
      await adapter.connect();
    });

    test('should store multiple events in bulk', async () => {
      const events = [
        {
          eventId: 'event1',
          timestamp: Date.now(),
          serviceId: 'service1',
          serviceName: 'Service 1',
          eventType: 'request',
          data: { test: true }
        },
        {
          eventId: 'event2',
          timestamp: Date.now(),
          serviceId: 'service2',
          serviceName: 'Service 2',
          eventType: 'response'
        }
      ];

      const result = await adapter.storeEvents(events);

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(result).toBe(2);
    });

    test('should handle transaction rollback on error', async () => {
      const error = new Error('Insert failed');
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // ensureService
        .mockRejectedValueOnce(error); // INSERT

      await expect(adapter.storeEvents([{ eventId: 'event1' }]))
        .rejects.toThrow('Insert failed');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    test('should invalidate cache after storing', async () => {
      const invalidateSpy = jest.spyOn(adapter, 'invalidateCache');
      
      await adapter.storeEvents([{ eventId: 'event1' }]);

      expect(invalidateSpy).toHaveBeenCalledWith('timeline:*');
    });

    test('should emit events:stored', async () => {
      const emitSpy = jest.spyOn(adapter, 'emit');
      const events = [{ eventId: 'event1' }, { eventId: 'event2' }];

      await adapter.storeEvents(events);

      expect(emitSpy).toHaveBeenCalledWith('events:stored', { count: 2 });
    });

    test('should handle empty events array', async () => {
      const result = await adapter.storeEvents([]);
      expect(result).toBe(0);
    });

    test('should throw error if not connected', async () => {
      adapter.connected = false;

      await expect(adapter.storeEvents([]))
        .rejects.toThrow('Storage not connected');
    });
  });

  describe('storeCausality', () => {
    beforeEach(async () => {
      mockClient.query.mockResolvedValue({ rows: [] });
      await adapter.connect();
      mockPool.query.mockResolvedValue({ rows: [] });
    });

    test('should store causality relationship', async () => {
      await adapter.storeCausality('cause1', 'effect1', 0.95, 'trace');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO traversion.causality'),
        ['cause1', 'effect1', 0.95, 'trace']
      );
    });

    test('should update confidence on conflict', async () => {
      await adapter.storeCausality('cause1', 'effect1', 0.8, 'temporal');

      const query = mockPool.query.mock.calls[0][0];
      expect(query).toContain('ON CONFLICT');
      expect(query).toContain('DO UPDATE SET confidence = GREATEST');
    });

    test('should handle errors', async () => {
      const error = new Error('Insert failed');
      mockPool.query.mockRejectedValue(error);

      await expect(adapter.storeCausality('cause1', 'effect1', 0.9, 'trace'))
        .rejects.toThrow('Insert failed');
    });
  });

  describe('queryTimeRange', () => {
    beforeEach(async () => {
      mockClient.query.mockResolvedValue({ rows: [] });
      await adapter.connect();
    });

    test('should query events in time range', async () => {
      const startTime = Date.now() - 10000;
      const endTime = Date.now();
      const events = [
        { eventId: 'event1', timestamp: startTime + 1000 },
        { eventId: 'event2', timestamp: startTime + 2000 }
      ];

      mockPool.query.mockResolvedValue({ rows: events });

      const result = await adapter.queryTimeRange(startTime, endTime);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE timestamp >= $1 AND timestamp <= $2'),
        expect.arrayContaining([new Date(startTime), new Date(endTime)])
      );
      expect(result).toEqual(events);
    });

    test('should apply filters', async () => {
      const filters = {
        serviceId: 'service1',
        eventType: 'request',
        minAnomalyScore: 0.8
      };

      mockPool.query.mockResolvedValue({ rows: [] });

      await adapter.queryTimeRange(0, Date.now(), filters);

      const query = mockPool.query.mock.calls[0][0];
      expect(query).toContain('AND service_id = $3');
      expect(query).toContain('AND event_type = $4');
      expect(query).toContain('AND anomaly_score >= $5');
    });

    test('should use cache when available', async () => {
      const cachedEvents = [{ eventId: 'cached1' }];
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedEvents));

      const result = await adapter.queryTimeRange(0, Date.now());

      expect(mockRedis.get).toHaveBeenCalled();
      expect(result).toEqual(cachedEvents);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    test('should cache results', async () => {
      const events = [{ eventId: 'event1' }];
      mockPool.query.mockResolvedValue({ rows: events });
      mockRedis.get.mockResolvedValue(null);

      await adapter.queryTimeRange(0, Date.now());

      expect(mockRedis.setex).toHaveBeenCalledWith(
        expect.any(String),
        adapter.cacheTTL,
        JSON.stringify(events)
      );
    });

    test('should handle query errors', async () => {
      const error = new Error('Query failed');
      mockPool.query.mockRejectedValue(error);

      await expect(adapter.queryTimeRange(0, Date.now()))
        .rejects.toThrow('Query failed');
    });
  });

  describe('getEvent', () => {
    beforeEach(async () => {
      mockClient.query.mockResolvedValue({ rows: [] });
      await adapter.connect();
    });

    test('should retrieve event by ID', async () => {
      const event = { eventId: 'event1', timestamp: Date.now() };
      mockPool.query.mockResolvedValue({ rows: [event] });

      const result = await adapter.getEvent('event1');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE event_id = $1'),
        ['event1']
      );
      expect(result).toEqual(event);
    });

    test('should return null for non-existent event', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await adapter.getEvent('nonexistent');

      expect(result).toBeNull();
    });

    test('should use cache when available', async () => {
      const cachedEvent = { eventId: 'cached1' };
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedEvent));

      const result = await adapter.getEvent('cached1');

      expect(result).toEqual(cachedEvent);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    test('should cache retrieved event', async () => {
      const event = { eventId: 'event1' };
      mockPool.query.mockResolvedValue({ rows: [event] });
      mockRedis.get.mockResolvedValue(null);

      await adapter.getEvent('event1');

      expect(mockRedis.setex).toHaveBeenCalledWith(
        'event:event1',
        adapter.cacheTTL,
        JSON.stringify(event)
      );
    });
  });

  describe('getCausalityChain', () => {
    beforeEach(async () => {
      mockClient.query.mockResolvedValue({ rows: [] });
      await adapter.connect();
    });

    test('should get backward causality chain', async () => {
      const chain = [
        { eventId: 'event1', depth: 0 },
        { eventId: 'event2', depth: 1 }
      ];
      mockPool.query.mockResolvedValue({ rows: chain });

      const result = await adapter.getCausalityChain('event1', 'backward', 10);

      const query = mockPool.query.mock.calls[0][0];
      expect(query).toContain('WITH RECURSIVE chain');
      expect(query).toContain('ca.effect_event_id = c.event_id');
      expect(result).toEqual(chain);
    });

    test('should get forward causality chain', async () => {
      const chain = [
        { eventId: 'event1', depth: 0 },
        { eventId: 'event3', depth: 1 }
      ];
      mockPool.query.mockResolvedValue({ rows: chain });

      const result = await adapter.getCausalityChain('event1', 'forward', 10);

      const query = mockPool.query.mock.calls[0][0];
      expect(query).toContain('ca.cause_event_id = c.event_id');
      expect(result).toEqual(chain);
    });

    test('should respect maxDepth parameter', async () => {
      await adapter.getCausalityChain('event1', 'backward', 5);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        ['event1', 5]
      );
    });
  });

  describe('storePattern', () => {
    beforeEach(async () => {
      mockClient.query.mockResolvedValue({ rows: [] });
      await adapter.connect();
      mockPool.query.mockResolvedValue({ rows: [] });
    });

    test('should store pattern with hash', async () => {
      const pattern = {
        type: 'error_cascade',
        signature: { events: ['error', 'retry', 'failure'] }
      };

      await adapter.storePattern(pattern);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO traversion.patterns'),
        expect.arrayContaining([
          expect.any(String), // hash
          'error_cascade',
          JSON.stringify(pattern.signature),
          1
        ])
      );
    });

    test('should update occurrences on conflict', async () => {
      const pattern = { type: 'test', signature: {} };
      await adapter.storePattern(pattern);

      const query = mockPool.query.mock.calls[0][0];
      expect(query).toContain('ON CONFLICT (pattern_hash)');
      expect(query).toContain('occurrences = patterns.occurrences + 1');
    });
  });

  describe('getMetrics', () => {
    beforeEach(async () => {
      mockClient.query.mockResolvedValue({ rows: [] });
      await adapter.connect();
    });

    test('should get metrics for time range', async () => {
      const metrics = [
        { minute: new Date(), metric_name: 'latency', avg_value: 100 }
      ];
      mockPool.query.mockResolvedValue({ rows: metrics });

      const result = await adapter.getMetrics(0, Date.now());

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('time_bucket'),
        expect.arrayContaining([new Date(0), expect.any(Date)])
      );
      expect(result).toEqual(metrics);
    });

    test('should filter by metric name', async () => {
      await adapter.getMetrics(0, Date.now(), 'latency');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('AND metric_name = $3'),
        expect.arrayContaining(['latency'])
      );
    });
  });

  describe('getStats', () => {
    beforeEach(async () => {
      mockClient.query.mockResolvedValue({ rows: [] });
      await adapter.connect();
    });

    test('should get database statistics', async () => {
      const stats = {
        total_events: '10000',
        total_services: '10',
        total_causalities: '5000',
        total_patterns: '50',
        database_size: '100 MB',
        events_last_hour: '500'
      };
      mockPool.query.mockResolvedValue({ rows: [stats] });

      const result = await adapter.getStats();

      expect(result).toEqual(stats);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('COUNT(*) FROM traversion.events')
      );
    });
  });

  describe('batch processing', () => {
    beforeEach(async () => {
      mockClient.query.mockResolvedValue({ rows: [{ id: 1 }] });
      await adapter.connect();
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('should process batch on interval', async () => {
      const flushSpy = jest.spyOn(adapter, 'flushBatch');
      flushSpy.mockResolvedValue();

      adapter.eventBatch.push({ eventId: 'event1' });

      jest.advanceTimersByTime(adapter.batchInterval);

      expect(flushSpy).toHaveBeenCalled();
    });

    test('should not flush empty batch', async () => {
      const storeEventsSpy = jest.spyOn(adapter, 'storeEvents');

      jest.advanceTimersByTime(adapter.batchInterval);

      expect(storeEventsSpy).not.toHaveBeenCalled();
    });

    test('flushBatch should store events', async () => {
      const storeEventsSpy = jest.spyOn(adapter, 'storeEvents');
      storeEventsSpy.mockResolvedValue(2);

      adapter.eventBatch = [
        { eventId: 'event1' },
        { eventId: 'event2' }
      ];

      await adapter.flushBatch();

      expect(storeEventsSpy).toHaveBeenCalledWith([
        { eventId: 'event1' },
        { eventId: 'event2' }
      ]);
      expect(adapter.eventBatch).toEqual([]);
    });

    test('should re-add events to batch on flush failure', async () => {
      const storeEventsSpy = jest.spyOn(adapter, 'storeEvents');
      storeEventsSpy.mockRejectedValue(new Error('Store failed'));

      adapter.eventBatch = [{ eventId: 'event1' }];

      await adapter.flushBatch();

      expect(adapter.eventBatch).toEqual([{ eventId: 'event1' }]);
    });
  });

  describe('caching', () => {
    beforeEach(async () => {
      mockClient.query.mockResolvedValue({ rows: [] });
      await adapter.connect();
    });

    test('invalidateCache should delete matching keys', async () => {
      mockRedis.keys.mockResolvedValue(['timeline:1', 'timeline:2']);

      await adapter.invalidateCache('timeline:*');

      expect(mockRedis.keys).toHaveBeenCalledWith('timeline:*');
      expect(mockRedis.del).toHaveBeenCalledWith('timeline:1', 'timeline:2');
    });

    test('invalidateCache should handle no matching keys', async () => {
      mockRedis.keys.mockResolvedValue([]);

      await adapter.invalidateCache('nonexistent:*');

      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    test('should not use cache when Redis is not available', async () => {
      adapter.redis = null;
      mockPool.query.mockResolvedValue({ rows: [{ eventId: 'event1' }] });

      const result = await adapter.getEvent('event1');

      expect(result).toEqual({ eventId: 'event1' });
      expect(mockRedis.get).not.toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    beforeEach(async () => {
      mockClient.query.mockResolvedValue({ rows: [{ id: 1 }] });
      await adapter.connect();
    });

    test('should clear batch timer', async () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      const timer = adapter.batchTimer;

      await adapter.disconnect();

      expect(clearIntervalSpy).toHaveBeenCalledWith(timer);
    });

    test('should flush remaining events', async () => {
      const flushSpy = jest.spyOn(adapter, 'flushBatch');
      adapter.eventBatch = [{ eventId: 'event1' }];

      await adapter.disconnect();

      expect(flushSpy).toHaveBeenCalled();
    });

    test('should disconnect from Redis', async () => {
      await adapter.disconnect();

      expect(mockRedis.quit).toHaveBeenCalled();
    });

    test('should disconnect from PostgreSQL', async () => {
      await adapter.disconnect();

      expect(mockPool.end).toHaveBeenCalled();
    });

    test('should emit disconnected event', async () => {
      const emitSpy = jest.spyOn(adapter, 'emit');

      await adapter.disconnect();

      expect(emitSpy).toHaveBeenCalledWith('disconnected');
      expect(adapter.connected).toBe(false);
    });

    test('should handle disconnect when not connected', async () => {
      adapter.connected = false;
      adapter.pool = null;
      adapter.redis = null;

      await expect(adapter.disconnect()).resolves.not.toThrow();
    });
  });

  describe('helper methods', () => {
    describe('ensureService', () => {
      test('should insert or update service', async () => {
        const client = { query: jest.fn().mockResolvedValue({ rows: [{ id: 1 }] }) };

        const result = await adapter.ensureService(client, 'service1', 'Service One');

        expect(client.query).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO traversion.services'),
          ['service1', 'Service One']
        );
        expect(result).toBe(1);
      });
    });

    describe('hashPattern', () => {
      test('should create consistent hash for pattern', () => {
        const pattern = { type: 'test', signature: { events: ['a', 'b'] } };
        
        const hash1 = adapter.hashPattern(pattern);
        const hash2 = adapter.hashPattern(pattern);

        expect(hash1).toBe(hash2);
        expect(hash1).toMatch(/^[a-f0-9]{64}$/);
      });

      test('should create different hashes for different patterns', () => {
        const pattern1 = { type: 'test1', signature: {} };
        const pattern2 = { type: 'test2', signature: {} };

        const hash1 = adapter.hashPattern(pattern1);
        const hash2 = adapter.hashPattern(pattern2);

        expect(hash1).not.toBe(hash2);
      });
    });
  });

  describe('error handling', () => {
    beforeEach(async () => {
      mockClient.query.mockResolvedValue({ rows: [] });
      await adapter.connect();
    });

    test('should handle database errors gracefully', async () => {
      const error = new Error('Database error');
      mockPool.query.mockRejectedValue(error);

      await expect(adapter.getSystemStateAt(Date.now()))
        .rejects.toThrow('Database error');
    });

    test('should handle Redis errors gracefully', async () => {
      const error = new Error('Redis error');
      mockRedis.get.mockRejectedValue(error);
      mockPool.query.mockResolvedValue({ rows: [{ eventId: 'event1' }] });

      // Should fall back to database when cache fails
      const result = await adapter.getEvent('event1');
      expect(result).toEqual({ eventId: 'event1' });
    });
  });

  describe('specialized queries', () => {
    beforeEach(async () => {
      mockClient.query.mockResolvedValue({ rows: [] });
      await adapter.connect();
    });

    test('getSystemStateAt should call stored procedure', async () => {
      const timestamp = Date.now();
      const state = [{ service: 'service1', state: 'healthy' }];
      mockPool.query.mockResolvedValue({ rows: state });

      const result = await adapter.getSystemStateAt(timestamp);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('get_system_state_at($1)'),
        [new Date(timestamp)]
      );
      expect(result).toEqual(state);
    });

    test('findRootCause should call stored procedure', async () => {
      const rootCause = [{ eventId: 'root1', confidence: 0.95 }];
      mockPool.query.mockResolvedValue({ rows: rootCause });

      const result = await adapter.findRootCause('error1');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('find_root_cause($1)'),
        ['error1']
      );
      expect(result).toEqual(rootCause);
    });
  });
});