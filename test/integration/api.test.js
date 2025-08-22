/**
 * Production API Integration Tests
 * 
 * End-to-end tests for the complete Traversion API,
 * including TimeQL queries, event ingestion, and real-time features.
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect } from '@jest/globals';
import fetch from 'node-fetch';
import WebSocket from 'ws';

const API_BASE = process.env.API_URL || 'http://localhost:3338';
const WS_URL = process.env.WS_URL || 'ws://localhost:3339';

describe('Traversion Production API', () => {
  let adminToken;
  let editorToken;
  let apiKey;
  let testTenantId;
  
  beforeAll(async () => {
    // Wait for API to be ready
    let retries = 10;
    while (retries > 0) {
      try {
        const response = await fetch(`${API_BASE}/health`);
        if (response.ok) break;
      } catch (error) {
        // API not ready yet
      }
      retries--;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    if (retries === 0) {
      throw new Error('API server not available for testing');
    }
    
    // Register test users and get tokens
    const adminRegister = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@apitest.com',
        password: 'password123',
        name: 'API Test Admin',
        tenantName: 'API Test Organization',
        role: 'admin'
      })
    });
    
    const adminResult = await adminRegister.json();
    if (!adminResult.success) {
      // User might already exist, try login
      const adminLogin = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'admin@apitest.com',
          password: 'password123'
        })
      });
      
      const loginResult = await adminLogin.json();
      adminToken = loginResult.token;
      testTenantId = loginResult.tenant.id;
    } else {
      adminToken = (await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'admin@apitest.com',
          password: 'password123'
        })
      }).then(r => r.json())).token;
      testTenantId = adminResult.tenant.id;
    }
    
    // Create API key for testing
    const apiKeyResponse = await fetch(`${API_BASE}/api/auth/api-keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: 'API Test Key',
        permissions: ['events:read', 'events:write', 'query:read']
      })
    });
    
    if (apiKeyResponse.ok) {
      const apiKeyResult = await apiKeyResponse.json();
      apiKey = apiKeyResult.apiKey.key;
    }
  });
  
  describe('Health and Status', () => {
    it('should return health status', async () => {
      const response = await fetch(`${API_BASE}/health`);
      const health = await response.json();
      
      expect(response.status).toBe(200);
      expect(health.status).toBe('healthy');
      expect(health.uptime).toBeGreaterThan(0);
      expect(health.storage).toBe(true);
    });
    
    it('should return system statistics', async () => {
      const response = await fetch(`${API_BASE}/api/stats`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      
      const stats = await response.json();
      
      expect(response.status).toBe(200);
      expect(stats.success).toBe(true);
      expect(stats.stats.database).toBeDefined();
      expect(stats.stats.engine).toBeDefined();
      expect(stats.stats.queries).toBeDefined();
    });
  });
  
  describe('Event Ingestion', () => {
    it('should ingest single event with JWT authentication', async () => {
      const event = {
        eventType: 'api.test.single',
        serviceId: 'test-service',
        data: {
          message: 'Single event test',
          timestamp: new Date().toISOString()
        }
      };
      
      const response = await fetch(`${API_BASE}/api/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify(event)
      });
      
      const result = await response.json();
      
      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.stored).toBe(1);
    });
    
    it('should ingest batch events with API key authentication', async () => {
      if (!apiKey) {
        console.log('Skipping API key test - no API key available');
        return;
      }
      
      const events = Array.from({ length: 5 }, (_, i) => ({
        eventType: 'api.test.batch',
        serviceId: 'batch-test-service',
        data: {
          batchIndex: i,
          timestamp: new Date(Date.now() + i * 1000).toISOString()
        }
      }));
      
      const response = await fetch(`${API_BASE}/api/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey
        },
        body: JSON.stringify(events)
      });
      
      const result = await response.json();
      
      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.stored).toBe(5);
    });
    
    it('should reject unauthenticated event ingestion', async () => {
      const event = {
        eventType: 'unauthorized.test',
        data: {}
      };
      
      const response = await fetch(`${API_BASE}/api/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event)
      });
      
      expect(response.status).toBe(401);
    });
  });
  
  describe('Event Querying', () => {
    beforeEach(async () => {
      // Ensure we have some test events
      const testEvents = [
        {
          eventType: 'query.test.http',
          serviceId: 'api-gateway',
          data: { method: 'GET', path: '/test', status: 200 }
        },
        {
          eventType: 'query.test.db',
          serviceId: 'database',
          data: { query: 'SELECT * FROM test', duration: 45 }
        },
        {
          eventType: 'query.test.error',
          serviceId: 'api-gateway',
          data: { method: 'POST', path: '/test', status: 500, error: 'Test error' }
        }
      ];
      
      await fetch(`${API_BASE}/api/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify(testEvents)
      });
      
      // Wait for events to be processed
      await new Promise(resolve => setTimeout(resolve, 1000));
    });
    
    it('should query events by time range', async () => {
      const endTime = Date.now();
      const startTime = endTime - (60 * 60 * 1000); // 1 hour ago
      
      const response = await fetch(
        `${API_BASE}/api/events?start=${startTime}&end=${endTime}`,
        {
          headers: { 'Authorization': `Bearer ${adminToken}` }
        }
      );
      
      const result = await response.json();
      
      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(Array.isArray(result.events)).toBe(true);
      
      // Verify events are within time range
      result.events.forEach(event => {
        const eventTime = new Date(event.timestamp).getTime();
        expect(eventTime).toBeGreaterThanOrEqual(startTime);
        expect(eventTime).toBeLessThanOrEqual(endTime);
      });
    });
    
    it('should filter events by service', async () => {
      const response = await fetch(
        `${API_BASE}/api/events?service=api-gateway`,
        {
          headers: { 'Authorization': `Bearer ${adminToken}` }
        }
      );
      
      const result = await response.json();
      
      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      
      // All events should be from api-gateway service
      result.events.forEach(event => {
        expect(event.serviceId).toBe('api-gateway');
      });
    });
    
    it('should filter events by type', async () => {
      const response = await fetch(
        `${API_BASE}/api/events?type=query.test.error`,
        {
          headers: { 'Authorization': `Bearer ${adminToken}` }
        }
      );
      
      const result = await response.json();
      
      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      
      // All events should be error type
      result.events.forEach(event => {
        expect(event.eventType).toBe('query.test.error');
      });
    });
  });
  
  describe('TimeQL Queries', () => {
    it('should execute STATE AT query', async () => {
      const timestamp = Date.now();
      const query = `STATE AT ${timestamp} WHERE service = "api-gateway"`;
      
      const response = await fetch(`${API_BASE}/api/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ query })
      });
      
      const result = await response.json();
      
      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.result.type).toBe('STATE_AT');
    });
    
    it('should execute TIMELINE query', async () => {
      const endTime = Date.now();
      const startTime = endTime - (30 * 60 * 1000); // 30 minutes ago
      const query = `TIMELINE FROM ${startTime} TO ${endTime} WHERE eventType = "query.test.http"`;
      
      const response = await fetch(`${API_BASE}/api/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ query })
      });
      
      const result = await response.json();
      
      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.result.type).toBe('TIMELINE');
      expect(Array.isArray(result.result.events)).toBe(true);
    });
    
    it('should handle invalid TimeQL syntax', async () => {
      const query = 'INVALID QUERY SYNTAX';
      
      const response = await fetch(`${API_BASE}/api/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ query })
      });
      
      const result = await response.json();
      
      expect(response.status).toBe(400);
      expect(result.success).toBe(false);
      expect(result.error).toContain('query');
    });
  });
  
  describe('Causality Analysis', () => {
    it('should retrieve causality chain', async () => {
      // First create some linked events
      const events = [
        {
          eventId: 'causality-1',
          eventType: 'http.request',
          traceId: 'trace-causality-test',
          spanId: 'span-1',
          data: { method: 'GET' }
        },
        {
          eventId: 'causality-2',
          eventType: 'db.query',
          traceId: 'trace-causality-test',
          spanId: 'span-2',
          parentSpanId: 'span-1',
          data: { query: 'SELECT *' }
        }
      ];
      
      await fetch(`${API_BASE}/api/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify(events)
      });
      
      // Wait for causality processing
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const response = await fetch(
        `${API_BASE}/api/causality/causality-2?direction=backward&depth=10`,
        {
          headers: { 'Authorization': `Bearer ${adminToken}` }
        }
      );
      
      const result = await response.json();
      
      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(Array.isArray(result.chain)).toBe(true);
    });
  });
  
  describe('WebSocket Real-time Events', () => {
    it('should authenticate and receive real-time events', (done) => {
      const ws = new WebSocket(WS_URL);
      let authenticated = false;
      
      const timeout = setTimeout(() => {
        ws.close();
        done(new Error('WebSocket test timeout'));
      }, 10000);
      
      ws.on('open', () => {
        // Authenticate with JWT
        ws.send(JSON.stringify({
          type: 'authenticate',
          token: adminToken
        }));
      });
      
      ws.on('message', async (data) => {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'authenticated') {
          authenticated = true;
          expect(message.user).toBeDefined();
          
          // Send a test event after authentication
          await fetch(`${API_BASE}/api/events`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${adminToken}`
            },
            body: JSON.stringify({
              eventType: 'websocket.test',
              data: { realtime: true }
            })
          });
        }
        
        if (message.type === 'events' && authenticated) {
          expect(Array.isArray(message.events)).toBe(true);
          
          const testEvent = message.events.find(e => e.eventType === 'websocket.test');
          if (testEvent) {
            expect(testEvent.data.realtime).toBe(true);
            clearTimeout(timeout);
            ws.close();
            done();
          }
        }
      });
      
      ws.on('error', (error) => {
        clearTimeout(timeout);
        done(error);
      });
    });
    
    it('should handle subscription filtering', (done) => {
      const ws = new WebSocket(WS_URL);
      
      const timeout = setTimeout(() => {
        ws.close();
        done(new Error('WebSocket subscription test timeout'));
      }, 10000);
      
      ws.on('open', () => {
        ws.send(JSON.stringify({
          type: 'authenticate',
          token: adminToken
        }));
      });
      
      ws.on('message', async (data) => {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'authenticated') {
          // Subscribe to specific event types
          ws.send(JSON.stringify({
            type: 'subscribe',
            subscriptions: [{ type: 'subscription.test' }]
          }));
        }
        
        if (message.type === 'subscribed') {
          // Send events of different types
          await fetch(`${API_BASE}/api/events`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${adminToken}`
            },
            body: JSON.stringify([
              { eventType: 'subscription.test', data: { filtered: true } },
              { eventType: 'other.test', data: { filtered: false } }
            ])
          });
        }
        
        if (message.type === 'events') {
          // Should only receive subscribed event types
          message.events.forEach(event => {
            expect(event.eventType).toBe('subscription.test');
          });
          
          clearTimeout(timeout);
          ws.close();
          done();
        }
      });
      
      ws.on('error', (error) => {
        clearTimeout(timeout);
        done(error);
      });
    });
  });
  
  describe('Performance', () => {
    it('should handle high-volume event ingestion', async () => {
      const eventCount = 100;
      const events = Array.from({ length: eventCount }, (_, i) => ({
        eventType: 'performance.test',
        serviceId: `perf-service-${i % 5}`,
        data: {
          index: i,
          timestamp: new Date(Date.now() + i).toISOString()
        }
      }));
      
      const startTime = Date.now();
      
      const response = await fetch(`${API_BASE}/api/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify(events)
      });
      
      const duration = Date.now() - startTime;
      const result = await response.json();
      
      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.stored).toBe(eventCount);
      
      // Should process 100 events reasonably quickly
      expect(duration).toBeLessThan(5000);
    });
    
    it('should handle concurrent API requests', async () => {
      const concurrentRequests = 10;
      const requests = Array.from({ length: concurrentRequests }, (_, i) =>
        fetch(`${API_BASE}/api/events`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
          },
          body: JSON.stringify({
            eventType: 'concurrent.test',
            data: { requestId: i }
          })
        })
      );
      
      const startTime = Date.now();
      const responses = await Promise.all(requests);
      const duration = Date.now() - startTime;
      
      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
      
      // Should handle concurrent requests efficiently
      expect(duration).toBeLessThan(5000);
    });
  });
});