/**
 * Temporal Query Engine Unit Tests
 * 
 * Tests the TimeQL query language implementation,
 * query parsing, execution, and result formatting.
 */

import { describe, it, beforeEach, expect } from '@jest/globals';
import TemporalQueryEngine from '../../src/engine/temporalQueryEngine.js';
import CausalityEngine from '../../src/engine/causalityEngine.js';

describe('TemporalQueryEngine', () => {
  let queryEngine;
  let causalityEngine;
  
  beforeEach(() => {
    causalityEngine = new CausalityEngine();
    queryEngine = new TemporalQueryEngine(causalityEngine);
    
    // Add test data to causality engine
    const testEvents = [
      {
        eventId: 'evt-1',
        timestamp: 1000,
        eventType: 'http.request',
        serviceId: 'api-gateway',
        tenantId: 'tenant-1',
        data: { method: 'GET', path: '/users', status: 200 }
      },
      {
        eventId: 'evt-2',
        timestamp: 1100,
        eventType: 'db.query',
        serviceId: 'user-service',
        tenantId: 'tenant-1',
        data: { query: 'SELECT * FROM users', duration: 50 }
      },
      {
        eventId: 'evt-3',
        timestamp: 1200,
        eventType: 'http.response',
        serviceId: 'api-gateway',
        tenantId: 'tenant-1',
        data: { status: 200, responseTime: 200 }
      },
      {
        eventId: 'evt-error',
        timestamp: 2000,
        eventType: 'http.error',
        serviceId: 'api-gateway',
        tenantId: 'tenant-1',
        data: { status: 500, error: 'Internal Server Error' }
      }
    ];
    
    testEvents.forEach(event => causalityEngine.processEvent(event));
  });
  
  describe('Query Parsing', () => {
    it('should parse STATE AT queries', () => {
      const query = 'STATE AT 2023-01-01T10:00:00Z WHERE service = "api-gateway"';
      const parsed = queryEngine._parseQuery(query);
      
      expect(parsed.type).toBe('STATE_AT');
      expect(parsed.timestamp).toBeDefined();
      expect(parsed.filters).toEqual({ service: 'api-gateway' });
    });
    
    it('should parse TRAVERSE queries', () => {
      const query = 'TRAVERSE FROM "evt-1" DIRECTION backward DEPTH 5';
      const parsed = queryEngine._parseQuery(query);
      
      expect(parsed.type).toBe('TRAVERSE');
      expect(parsed.eventId).toBe('evt-1');
      expect(parsed.direction).toBe('backward');
      expect(parsed.depth).toBe(5);
    });
    
    it('should parse PATTERN queries', () => {
      const query = 'PATTERN "error_cascade" IN LAST 1 hour WHERE confidence > 0.7';
      const parsed = queryEngine._parseQuery(query);
      
      expect(parsed.type).toBe('PATTERN');
      expect(parsed.pattern).toBe('error_cascade');
      expect(parsed.timeRange.amount).toBe(1);
      expect(parsed.timeRange.unit).toBe('hour');
      expect(parsed.filters).toEqual({ confidence: { operator: '>', value: 0.7 } });
    });
    
    it('should parse TIMELINE queries', () => {
      const query = 'TIMELINE FROM 2023-01-01 TO 2023-01-02 WHERE service IN ["api-gateway", "user-service"]';
      const parsed = queryEngine._parseQuery(query);
      
      expect(parsed.type).toBe('TIMELINE');
      expect(parsed.startTime).toBeDefined();
      expect(parsed.endTime).toBeDefined();
      expect(parsed.filters).toEqual({ service: { operator: 'IN', value: ['api-gateway', 'user-service'] } });
    });
    
    it('should parse COMPARE queries', () => {
      const query = 'COMPARE "evt-1" WITH "evt-2" METRICS ["responseTime", "errorRate"]';
      const parsed = queryEngine._parseQuery(query);
      
      expect(parsed.type).toBe('COMPARE');
      expect(parsed.eventIds).toEqual(['evt-1', 'evt-2']);
      expect(parsed.metrics).toEqual(['responseTime', 'errorRate']);
    });
    
    it('should parse PREDICT queries', () => {
      const query = 'PREDICT anomaly IN NEXT 30 minutes BASED ON LAST 2 hours';
      const parsed = queryEngine._parseQuery(query);
      
      expect(parsed.type).toBe('PREDICT');
      expect(parsed.target).toBe('anomaly');
      expect(parsed.futureWindow).toEqual({ amount: 30, unit: 'minutes' });
      expect(parsed.historicalWindow).toEqual({ amount: 2, unit: 'hours' });
    });
  });
  
  describe('Query Execution', () => {
    it('should execute STATE AT queries', async () => {
      const query = 'STATE AT 1150 WHERE service = "api-gateway"';
      const result = await queryEngine.query(query, { tenantId: 'tenant-1' });
      
      expect(result.type).toBe('STATE_AT');
      expect(result.timestamp).toBe(1150);
      expect(result.events).toBeDefined();
      expect(result.events.length).toBeGreaterThan(0);
      
      // Should only include events before the timestamp
      result.events.forEach(event => {
        expect(event.timestamp).toBeLessThanOrEqual(1150);
        expect(event.serviceId).toBe('api-gateway');
      });
    });
    
    it('should execute TRAVERSE queries', async () => {
      const query = 'TRAVERSE FROM "evt-1" DIRECTION forward DEPTH 3';
      const result = await queryEngine.query(query, { tenantId: 'tenant-1' });
      
      expect(result.type).toBe('TRAVERSE');
      expect(result.startEvent).toBe('evt-1');
      expect(result.chain).toBeDefined();
      expect(Array.isArray(result.chain)).toBe(true);
      
      // Should trace forward from evt-1
      if (result.chain.length > 0) {
        expect(result.chain[0].eventId).toBe('evt-1');
      }
    });
    
    it('should execute PATTERN queries', async () => {
      const query = 'PATTERN "http_sequence" IN LAST 5 seconds';
      const result = await queryEngine.query(query, { tenantId: 'tenant-1' });
      
      expect(result.type).toBe('PATTERN');
      expect(result.patterns).toBeDefined();
      expect(Array.isArray(result.patterns)).toBe(true);
    });
    
    it('should execute TIMELINE queries', async () => {
      const query = 'TIMELINE FROM 900 TO 1300 WHERE eventType = "http.request"';
      const result = await queryEngine.query(query, { tenantId: 'tenant-1' });
      
      expect(result.type).toBe('TIMELINE');
      expect(result.events).toBeDefined();
      expect(Array.isArray(result.events)).toBe(true);
      
      // Should be ordered by timestamp
      for (let i = 1; i < result.events.length; i++) {
        expect(result.events[i].timestamp).toBeGreaterThanOrEqual(result.events[i-1].timestamp);
      }
    });
    
    it('should execute COMPARE queries', async () => {
      const query = 'COMPARE "evt-1" WITH "evt-3" METRICS ["timestamp", "eventType"]';
      const result = await queryEngine.query(query, { tenantId: 'tenant-1' });
      
      expect(result.type).toBe('COMPARE');
      expect(result.comparison).toBeDefined();
      expect(result.comparison.event1).toBeDefined();
      expect(result.comparison.event2).toBeDefined();
      expect(result.comparison.differences).toBeDefined();
    });
    
    it('should execute PREDICT queries', async () => {
      const query = 'PREDICT anomaly IN NEXT 10 minutes BASED ON LAST 1 hour';
      const result = await queryEngine.query(query, { tenantId: 'tenant-1' });
      
      expect(result.type).toBe('PREDICT');
      expect(result.prediction).toBeDefined();
      expect(typeof result.prediction.probability).toBe('number');
      expect(result.prediction.confidence).toBeDefined();
    });
  });
  
  describe('Filters and Operators', () => {
    it('should handle equality filters', async () => {
      const query = 'TIMELINE FROM 900 TO 1300 WHERE eventType = "http.request"';
      const result = await queryEngine.query(query, { tenantId: 'tenant-1' });
      
      result.events.forEach(event => {
        expect(event.eventType).toBe('http.request');
      });
    });
    
    it('should handle comparison filters', async () => {
      const query = 'TIMELINE FROM 900 TO 1300 WHERE timestamp > 1000';
      const result = await queryEngine.query(query, { tenantId: 'tenant-1' });
      
      result.events.forEach(event => {
        expect(event.timestamp).toBeGreaterThan(1000);
      });
    });
    
    it('should handle IN filters', async () => {
      const query = 'TIMELINE FROM 900 TO 1300 WHERE serviceId IN ["api-gateway", "user-service"]';
      const result = await queryEngine.query(query, { tenantId: 'tenant-1' });
      
      result.events.forEach(event => {
        expect(['api-gateway', 'user-service']).toContain(event.serviceId);
      });
    });
    
    it('should handle CONTAINS filters', async () => {
      const query = 'TIMELINE FROM 900 TO 1300 WHERE data CONTAINS "users"';
      const result = await queryEngine.query(query, { tenantId: 'tenant-1' });
      
      result.events.forEach(event => {
        const dataStr = JSON.stringify(event.data);
        expect(dataStr).toContain('users');
      });
    });
  });
  
  describe('Tenant Isolation', () => {
    it('should only return events for specified tenant', async () => {
      // Add event for different tenant
      causalityEngine.processEvent({
        eventId: 'evt-other-tenant',
        timestamp: 1500,
        eventType: 'test.event',
        serviceId: 'test-service',
        tenantId: 'tenant-2',
        data: {}
      });
      
      const query = 'TIMELINE FROM 900 TO 2000';
      const result = await queryEngine.query(query, { tenantId: 'tenant-1' });
      
      result.events.forEach(event => {
        expect(event.tenantId).toBe('tenant-1');
      });
      
      // Should not include the other tenant's event
      const otherTenantEvents = result.events.filter(e => e.eventId === 'evt-other-tenant');
      expect(otherTenantEvents.length).toBe(0);
    });
  });
  
  describe('Error Handling', () => {
    it('should handle invalid query syntax', async () => {
      const query = 'INVALID QUERY SYNTAX';
      
      try {
        await queryEngine.query(query, { tenantId: 'tenant-1' });
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).toContain('Invalid query syntax');
      }
    });
    
    it('should handle non-existent event IDs', async () => {
      const query = 'TRAVERSE FROM "non-existent-event" DIRECTION forward DEPTH 3';
      const result = await queryEngine.query(query, { tenantId: 'tenant-1' });
      
      expect(result.chain).toBeDefined();
      expect(result.chain.length).toBe(0);
    });
    
    it('should handle malformed timestamps', async () => {
      const query = 'STATE AT invalid-timestamp';
      
      try {
        await queryEngine.query(query, { tenantId: 'tenant-1' });
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).toContain('Invalid timestamp');
      }
    });
  });
  
  describe('Performance', () => {
    it('should cache frequently used queries', async () => {
      const query = 'TIMELINE FROM 900 TO 1300';
      
      // First execution
      const start1 = Date.now();
      await queryEngine.query(query, { tenantId: 'tenant-1' });
      const duration1 = Date.now() - start1;
      
      // Second execution (should be cached)
      const start2 = Date.now();
      await queryEngine.query(query, { tenantId: 'tenant-1' });
      const duration2 = Date.now() - start2;
      
      // Cached query should be significantly faster
      expect(duration2).toBeLessThan(duration1);
    });
    
    it('should provide query statistics', async () => {
      const query = 'TIMELINE FROM 900 TO 1300';
      await queryEngine.query(query, { tenantId: 'tenant-1' });
      
      const stats = queryEngine.getStats();
      
      expect(stats.totalQueries).toBeGreaterThan(0);
      expect(stats.cacheHitRate).toBeGreaterThanOrEqual(0);
      expect(stats.averageExecutionTime).toBeGreaterThan(0);
    });
  });
});