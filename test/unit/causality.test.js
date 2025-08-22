/**
 * Causality Engine Unit Tests
 * 
 * Tests the core causality detection, pattern matching,
 * and anomaly scoring functionality.
 */

import { describe, it, beforeEach, expect } from '@jest/globals';
import CausalityEngine from '../../src/engine/causalityEngine.js';

describe('CausalityEngine', () => {
  let engine;
  
  beforeEach(() => {
    engine = new CausalityEngine();
  });
  
  describe('Event Processing', () => {
    it('should process basic events', () => {
      const event = {
        eventId: 'evt-1',
        timestamp: Date.now(),
        eventType: 'http.request',
        serviceId: 'api-gateway',
        data: { method: 'GET', path: '/users' }
      };
      
      engine.processEvent(event);
      
      expect(engine.eventGraph.has('evt-1')).toBe(true);
      const node = engine.eventGraph.get('evt-1');
      expect(node.event).toEqual(event);
    });
    
    it('should detect temporal causality', (done) => {
      engine.on('causality:detected', ({ cause, effect, type, confidence }) => {
        expect(type).toBe('temporal');
        expect(confidence).toBeGreaterThan(0.5);
        expect(cause.eventId).toBe('evt-1');
        expect(effect.eventId).toBe('evt-2');
        done();
      });
      
      const event1 = {
        eventId: 'evt-1',
        timestamp: 1000,
        eventType: 'http.request',
        serviceId: 'api-gateway',
        data: { method: 'GET', path: '/users' }
      };
      
      const event2 = {
        eventId: 'evt-2',
        timestamp: 1100, // 100ms later
        eventType: 'http.response',
        serviceId: 'api-gateway',
        data: { status: 200, path: '/users' }
      };
      
      engine.processEvent(event1);
      engine.processEvent(event2);
    });
    
    it('should detect trace-based causality', (done) => {
      engine.on('causality:detected', ({ cause, effect, type }) => {
        expect(type).toBe('trace');
        done();
      });
      
      const traceId = 'trace-123';
      const event1 = {
        eventId: 'evt-1',
        timestamp: 1000,
        eventType: 'http.request',
        traceId,
        spanId: 'span-1',
        data: {}
      };
      
      const event2 = {
        eventId: 'evt-2',
        timestamp: 1050,
        eventType: 'db.query',
        traceId,
        spanId: 'span-2',
        parentSpanId: 'span-1',
        data: {}
      };
      
      engine.processEvent(event1);
      engine.processEvent(event2);
    });
    
    it('should detect service dependency causality', (done) => {
      engine.on('causality:detected', ({ type, confidence }) => {
        expect(type).toBe('service');
        expect(confidence).toBeGreaterThan(0.6);
        done();
      });
      
      const event1 = {
        eventId: 'evt-1',
        timestamp: 1000,
        eventType: 'service.call',
        serviceId: 'user-service',
        data: { target: 'auth-service', method: 'validateToken' }
      };
      
      const event2 = {
        eventId: 'evt-2',
        timestamp: 1020,
        eventType: 'auth.validate',
        serviceId: 'auth-service',
        data: { result: 'valid' }
      };
      
      engine.processEvent(event1);
      engine.processEvent(event2);
    });
  });
  
  describe('Pattern Detection', () => {
    it('should detect repeating error patterns', (done) => {
      engine.on('pattern:matched', ({ pattern }) => {
        expect(pattern.type).toBe('error_sequence');
        expect(pattern.confidence).toBeGreaterThan(0.7);
        done();
      });
      
      // Create a pattern of repeated database timeout errors
      const events = [];
      for (let i = 0; i < 5; i++) {
        events.push({
          eventId: `evt-${i}`,
          timestamp: 1000 + (i * 1000),
          eventType: 'db.error',
          serviceId: 'user-service',
          data: { error: 'timeout', query: 'SELECT * FROM users' }
        });
      }
      
      events.forEach(event => engine.processEvent(event));
    });
    
    it('should detect cascade failure patterns', (done) => {
      engine.on('pattern:matched', ({ pattern }) => {
        expect(pattern.type).toBe('cascade_failure');
        done();
      });
      
      const services = ['gateway', 'user-service', 'db-service'];
      const baseTime = 1000;
      
      services.forEach((service, i) => {
        engine.processEvent({
          eventId: `fail-${i}`,
          timestamp: baseTime + (i * 100),
          eventType: 'service.error',
          serviceId: service,
          data: { error: 'connection_failed' }
        });
      });
    });
  });
  
  describe('Anomaly Scoring', () => {
    it('should assign low anomaly scores to normal events', () => {
      const event = {
        eventId: 'evt-1',
        timestamp: Date.now(),
        eventType: 'http.request',
        serviceId: 'api-gateway',
        data: { method: 'GET', path: '/users', status: 200 }
      };
      
      engine.processEvent(event);
      
      const node = engine.eventGraph.get('evt-1');
      expect(node.anomalyScore).toBeLessThan(0.3);
    });
    
    it('should assign high anomaly scores to error events', () => {
      const event = {
        eventId: 'evt-1',
        timestamp: Date.now(),
        eventType: 'http.error',
        serviceId: 'api-gateway',
        data: { method: 'GET', path: '/users', status: 500, error: 'Internal Server Error' }
      };
      
      engine.processEvent(event);
      
      const node = engine.eventGraph.get('evt-1');
      expect(node.anomalyScore).toBeGreaterThan(0.7);
    });
    
    it('should increase anomaly scores for frequency anomalies', () => {
      const baseTime = Date.now();
      const events = [];
      
      // Generate 100 events in 1 second (unusually high frequency)
      for (let i = 0; i < 100; i++) {
        events.push({
          eventId: `high-freq-${i}`,
          timestamp: baseTime + (i * 10), // 10ms apart
          eventType: 'http.request',
          serviceId: 'api-gateway',
          data: { method: 'GET', path: '/spam' }
        });
      }
      
      events.forEach(event => engine.processEvent(event));
      
      // Later events should have higher anomaly scores due to frequency
      const lastEvent = engine.eventGraph.get('high-freq-99');
      expect(lastEvent.anomalyScore).toBeGreaterThan(0.5);
    });
  });
  
  describe('Performance', () => {
    it('should handle large volumes of events efficiently', () => {
      const startTime = Date.now();
      const eventCount = 10000;
      
      for (let i = 0; i < eventCount; i++) {
        engine.processEvent({
          eventId: `perf-${i}`,
          timestamp: Date.now() + i,
          eventType: 'test.event',
          serviceId: 'test-service',
          data: { index: i }
        });
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Should process 10k events in less than 1 second
      expect(duration).toBeLessThan(1000);
      expect(engine.eventGraph.size).toBe(eventCount);
    });
    
    it('should cleanup old events to prevent memory leaks', () => {
      const oldEventCount = 1000;
      const baseTime = Date.now() - (2 * 60 * 60 * 1000); // 2 hours ago
      
      // Add old events
      for (let i = 0; i < oldEventCount; i++) {
        engine.processEvent({
          eventId: `old-${i}`,
          timestamp: baseTime + i,
          eventType: 'old.event',
          data: {}
        });
      }
      
      expect(engine.eventGraph.size).toBe(oldEventCount);
      
      // Trigger cleanup by adding a new event
      engine.processEvent({
        eventId: 'new-event',
        timestamp: Date.now(),
        eventType: 'new.event',
        data: {}
      });
      
      // Old events should be cleaned up
      expect(engine.eventGraph.size).toBeLessThan(oldEventCount);
    });
  });
  
  describe('Statistics', () => {
    it('should provide engine statistics', () => {
      // Add some test events
      for (let i = 0; i < 10; i++) {
        engine.processEvent({
          eventId: `stat-${i}`,
          timestamp: Date.now() + i,
          eventType: 'test.event',
          data: {}
        });
      }
      
      const stats = engine.getStats();
      
      expect(stats.totalEvents).toBe(10);
      expect(stats.causalityRelationships).toBeGreaterThanOrEqual(0);
      expect(stats.patternsDetected).toBeGreaterThanOrEqual(0);
      expect(stats.averageProcessingTime).toBeGreaterThan(0);
    });
  });
});