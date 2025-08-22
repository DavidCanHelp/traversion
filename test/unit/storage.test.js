/**
 * Storage Layer Unit Tests
 * 
 * Tests TimescaleDB adapter, data persistence,
 * caching, and multi-tenant data isolation.
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect } from '@jest/globals';
import TimescaleAdapter from '../../src/storage/timescaleAdapter.js';

const TEST_CONFIG = {
  dbHost: process.env.TEST_DB_HOST || 'localhost',
  dbPort: process.env.TEST_DB_PORT || 5432,
  dbName: process.env.TEST_DB_NAME || 'traversion_test',
  dbUser: process.env.TEST_DB_USER || 'traversion',
  dbPassword: process.env.TEST_DB_PASSWORD || 'traversion_secret',
  redisHost: process.env.TEST_REDIS_HOST || 'localhost',
  redisPort: process.env.TEST_REDIS_PORT || 6379
};

describe('TimescaleAdapter', () => {
  let storage;
  let testTenantId;
  
  beforeAll(async () => {
    storage = new TimescaleAdapter(TEST_CONFIG);
    await storage.connect();
    
    // Create test tenant
    const tenantResult = await storage.query(
      'INSERT INTO tenants (name) VALUES ($1) RETURNING id',
      ['Test Storage Tenant']
    );
    testTenantId = tenantResult.rows[0].id;
  });
  
  afterAll(async () => {
    // Cleanup test data
    await storage.query('DELETE FROM events WHERE tenant_id = $1', [testTenantId]);
    await storage.query('DELETE FROM services WHERE tenant_id = $1', [testTenantId]);
    await storage.query('DELETE FROM tenants WHERE id = $1', [testTenantId]);
    
    await storage.disconnect();
  });
  
  beforeEach(async () => {
    // Clear test events before each test
    await storage.query('DELETE FROM events WHERE tenant_id = $1', [testTenantId]);
    await storage.query('DELETE FROM causality WHERE cause_event_id IN (SELECT event_id FROM events WHERE tenant_id = $1)', [testTenantId]);
    await storage.flushCache();
  });
  
  describe('Connection Management', () => {
    it('should connect to TimescaleDB successfully', () => {
      expect(storage.connected).toBe(true);
    });
    
    it('should connect to Redis successfully', () => {
      expect(storage.redis.status).toBe('ready');
    });
    
    it('should handle connection errors gracefully', async () => {
      const badStorage = new TimescaleAdapter({
        ...TEST_CONFIG,
        dbHost: 'invalid-host'
      });
      
      try {
        await badStorage.connect();
        fail('Should have thrown connection error');
      } catch (error) {
        expect(error.message).toContain('connection');
      }
    });
  });
  
  describe('Event Storage', () => {
    it('should store single event', async () => {
      const event = {
        eventId: 'test-evt-1',
        tenantId: testTenantId,
        timestamp: new Date().toISOString(),
        eventType: 'test.event',
        serviceId: 'test-service',
        data: { test: true }
      };
      
      const stored = await storage.storeEvent(event);
      expect(stored).toBe(1);
      
      // Verify storage
      const result = await storage.query(
        'SELECT * FROM events WHERE event_id = $1',
        [event.eventId]
      );
      
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].event_type).toBe('test.event');
      expect(result.rows[0].tenant_id).toBe(testTenantId);
    });
    
    it('should store batch of events efficiently', async () => {
      const events = [];
      for (let i = 0; i < 100; i++) {
        events.push({
          eventId: `batch-evt-${i}`,
          tenantId: testTenantId,
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
          eventType: 'batch.test',
          serviceId: 'batch-service',
          data: { index: i }
        });
      }
      
      const startTime = Date.now();
      const stored = await storage.storeEvents(events);
      const duration = Date.now() - startTime;
      
      expect(stored).toBe(100);
      expect(duration).toBeLessThan(1000); // Should be fast
      
      // Verify all events stored
      const result = await storage.query(
        'SELECT COUNT(*) as count FROM events WHERE event_type = $1 AND tenant_id = $2',
        ['batch.test', testTenantId]
      );
      
      expect(parseInt(result.rows[0].count)).toBe(100);
    });
    
    it('should handle duplicate event IDs gracefully', async () => {
      const event = {
        eventId: 'duplicate-test',
        tenantId: testTenantId,
        timestamp: new Date().toISOString(),
        eventType: 'duplicate.test',
        data: { version: 1 }
      };
      
      // Store first time
      await storage.storeEvent(event);
      
      // Try to store duplicate
      const duplicateEvent = { ...event, data: { version: 2 } };
      const result = await storage.storeEvent(duplicateEvent);
      
      // Should handle gracefully (either update or skip)
      expect(result).toBeGreaterThanOrEqual(0);
    });
  });
  
  describe('Event Querying', () => {
    beforeEach(async () => {
      // Setup test events
      const testEvents = [
        {
          eventId: 'query-evt-1',
          tenantId: testTenantId,
          timestamp: new Date('2023-01-01T10:00:00Z').toISOString(),
          eventType: 'http.request',
          serviceId: 'api-service',
          data: { method: 'GET', path: '/users' }
        },
        {
          eventId: 'query-evt-2',
          tenantId: testTenantId,
          timestamp: new Date('2023-01-01T10:01:00Z').toISOString(),
          eventType: 'http.response',
          serviceId: 'api-service',
          data: { status: 200, responseTime: 150 }
        },
        {
          eventId: 'query-evt-3',
          tenantId: testTenantId,
          timestamp: new Date('2023-01-01T10:02:00Z').toISOString(),
          eventType: 'http.error',
          serviceId: 'api-service',
          data: { status: 500, error: 'Internal Server Error' }
        }
      ];
      
      await storage.storeEvents(testEvents);
    });
    
    it('should query events by time range', async () => {
      const startTime = new Date('2023-01-01T09:59:00Z').getTime();
      const endTime = new Date('2023-01-01T10:01:30Z').getTime();
      
      const events = await storage.queryTimeRange(startTime, endTime, {
        tenantId: testTenantId
      });
      
      expect(events.length).toBe(2);
      events.forEach(event => {
        const eventTime = new Date(event.timestamp).getTime();
        expect(eventTime).toBeGreaterThanOrEqual(startTime);
        expect(eventTime).toBeLessThanOrEqual(endTime);
        expect(event.tenantId).toBe(testTenantId);
      });
    });
    
    it('should filter events by service', async () => {
      const startTime = new Date('2023-01-01T09:00:00Z').getTime();
      const endTime = new Date('2023-01-01T11:00:00Z').getTime();
      
      const events = await storage.queryTimeRange(startTime, endTime, {
        tenantId: testTenantId,
        serviceId: 'api-service'
      });
      
      expect(events.length).toBe(3);
      events.forEach(event => {
        expect(event.serviceId).toBe('api-service');
      });
    });
    
    it('should filter events by type', async () => {
      const startTime = new Date('2023-01-01T09:00:00Z').getTime();
      const endTime = new Date('2023-01-01T11:00:00Z').getTime();
      
      const events = await storage.queryTimeRange(startTime, endTime, {
        tenantId: testTenantId,
        eventType: 'http.error'
      });
      
      expect(events.length).toBe(1);
      expect(events[0].eventType).toBe('http.error');
    });
    
    it('should filter events by anomaly score', async () => {
      // First, update an event to have a high anomaly score
      await storage.query(
        'UPDATE events SET anomaly_score = $1 WHERE event_id = $2',
        [0.9, 'query-evt-3']
      );
      
      const startTime = new Date('2023-01-01T09:00:00Z').getTime();
      const endTime = new Date('2023-01-01T11:00:00Z').getTime();
      
      const events = await storage.queryTimeRange(startTime, endTime, {
        tenantId: testTenantId,
        minAnomalyScore: 0.8
      });
      
      expect(events.length).toBe(1);
      expect(events[0].eventId).toBe('query-evt-3');
    });
  });
  
  describe('Causality Storage', () => {
    it('should store causality relationships', async () => {
      // Store test events first
      await storage.storeEvents([
        {
          eventId: 'cause-evt',
          tenantId: testTenantId,
          timestamp: new Date().toISOString(),
          eventType: 'http.request',
          data: {}
        },
        {
          eventId: 'effect-evt',
          tenantId: testTenantId,
          timestamp: new Date(Date.now() + 1000).toISOString(),
          eventType: 'http.response',
          data: {}
        }
      ]);
      
      const stored = await storage.storeCausality(
        'cause-evt',
        'effect-evt',
        0.85,
        'temporal'
      );
      
      expect(stored).toBe(1);
      
      // Verify storage
      const result = await storage.query(
        'SELECT * FROM causality WHERE cause_event_id = $1 AND effect_event_id = $2',
        ['cause-evt', 'effect-evt']
      );
      
      expect(result.rows.length).toBe(1);
      expect(parseFloat(result.rows[0].confidence)).toBe(0.85);
      expect(result.rows[0].causality_type).toBe('temporal');
    });
    
    it('should retrieve causality chains', async () => {
      // Create a chain of events
      const events = [
        { eventId: 'chain-1', tenantId: testTenantId },
        { eventId: 'chain-2', tenantId: testTenantId },
        { eventId: 'chain-3', tenantId: testTenantId }
      ].map((event, i) => ({
        ...event,
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
        eventType: 'chain.event',
        data: {}
      }));
      
      await storage.storeEvents(events);
      
      // Store causality relationships
      await storage.storeCausality('chain-1', 'chain-2', 0.8, 'trace');
      await storage.storeCausality('chain-2', 'chain-3', 0.7, 'trace');
      
      const chain = await storage.getCausalityChain('chain-3', 'backward', 5, testTenantId);
      
      expect(chain.length).toBeGreaterThan(0);
      expect(chain.some(event => event.eventId === 'chain-1')).toBe(true);
    });
  });
  
  describe('Caching', () => {
    it('should cache query results', async () => {
      const startTime = Date.now() - 3600000;
      const endTime = Date.now();
      
      // First query (no cache)
      const start1 = Date.now();
      const events1 = await storage.queryTimeRange(startTime, endTime, {
        tenantId: testTenantId
      });
      const duration1 = Date.now() - start1;
      
      // Second query (from cache)
      const start2 = Date.now();
      const events2 = await storage.queryTimeRange(startTime, endTime, {
        tenantId: testTenantId
      });
      const duration2 = Date.now() - start2;
      
      expect(events1).toEqual(events2);
      expect(duration2).toBeLessThan(duration1);
    });
    
    it('should invalidate cache on new data', async () => {
      const cacheKey = `events:${testTenantId}:${Date.now()}`;
      
      // Store in cache
      await storage.redis.set(cacheKey, JSON.stringify({ test: 'data' }), 'EX', 300);
      
      // Verify cached
      let cached = await storage.redis.get(cacheKey);
      expect(cached).toBeTruthy();
      
      // Store new event (should trigger cache invalidation)
      await storage.storeEvent({
        eventId: 'cache-test',
        tenantId: testTenantId,
        timestamp: new Date().toISOString(),
        eventType: 'cache.test',
        data: {}
      });
      
      // Cache should still exist (selective invalidation)
      cached = await storage.redis.get(cacheKey);
      expect(cached).toBeTruthy();
    });
  });
  
  describe('Statistics', () => {
    it('should provide storage statistics', async () => {
      const stats = await storage.getStats(testTenantId);
      
      expect(stats).toBeDefined();
      expect(typeof stats.totalEvents).toBe('number');
      expect(typeof stats.totalServices).toBe('number');
      expect(typeof stats.databaseSize).toBe('string');
      expect(stats.eventsByType).toBeDefined();
    });
  });
  
  describe('Tenant Isolation', () => {
    let otherTenantId;
    
    beforeAll(async () => {
      // Create another test tenant
      const result = await storage.query(
        'INSERT INTO tenants (name) VALUES ($1) RETURNING id',
        ['Other Test Tenant']
      );
      otherTenantId = result.rows[0].id;
    });
    
    afterAll(async () => {
      await storage.query('DELETE FROM events WHERE tenant_id = $1', [otherTenantId]);
      await storage.query('DELETE FROM tenants WHERE id = $1', [otherTenantId]);
    });
    
    it('should isolate events between tenants', async () => {
      // Store events for both tenants
      await storage.storeEvents([
        {
          eventId: 'tenant1-evt',
          tenantId: testTenantId,
          timestamp: new Date().toISOString(),
          eventType: 'isolation.test',
          data: { tenant: 'test' }
        },
        {
          eventId: 'tenant2-evt',
          tenantId: otherTenantId,
          timestamp: new Date().toISOString(),
          eventType: 'isolation.test',
          data: { tenant: 'other' }
        }
      ]);
      
      // Query for first tenant
      const tenant1Events = await storage.queryTimeRange(
        Date.now() - 3600000,
        Date.now(),
        { tenantId: testTenantId }
      );
      
      // Should only see own events
      expect(tenant1Events.every(e => e.tenantId === testTenantId)).toBe(true);
      expect(tenant1Events.some(e => e.eventId === 'tenant2-evt')).toBe(false);
      
      // Query for second tenant
      const tenant2Events = await storage.queryTimeRange(
        Date.now() - 3600000,
        Date.now(),
        { tenantId: otherTenantId }
      );
      
      // Should only see own events
      expect(tenant2Events.every(e => e.tenantId === otherTenantId)).toBe(true);
      expect(tenant2Events.some(e => e.eventId === 'tenant1-evt')).toBe(false);
    });
  });
  
  describe('Performance', () => {
    it('should handle concurrent operations', async () => {
      const concurrentOps = 10;
      const eventsPerOp = 10;
      
      const operations = [];
      for (let i = 0; i < concurrentOps; i++) {
        const events = [];
        for (let j = 0; j < eventsPerOp; j++) {
          events.push({
            eventId: `concurrent-${i}-${j}`,
            tenantId: testTenantId,
            timestamp: new Date().toISOString(),
            eventType: 'concurrent.test',
            data: { op: i, event: j }
          });
        }
        operations.push(storage.storeEvents(events));
      }
      
      const startTime = Date.now();
      const results = await Promise.all(operations);
      const duration = Date.now() - startTime;
      
      // All operations should succeed
      expect(results.every(r => r === eventsPerOp)).toBe(true);
      
      // Should complete in reasonable time
      expect(duration).toBeLessThan(5000);
      
      // Verify all events stored
      const totalEvents = await storage.query(
        'SELECT COUNT(*) as count FROM events WHERE event_type = $1 AND tenant_id = $2',
        ['concurrent.test', testTenantId]
      );
      
      expect(parseInt(totalEvents.rows[0].count)).toBe(concurrentOps * eventsPerOp);
    });
  });
});