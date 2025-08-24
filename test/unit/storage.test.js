/**
 * Storage Layer Unit Tests
 * 
 * Tests TimescaleDB adapter, data persistence,
 * caching, and multi-tenant data isolation.
 */

import { jest, describe, it, beforeAll, afterAll, beforeEach, expect } from '@jest/globals';
import { mockPgPool, mockRedisClient, createMockAdapter } from '../mocks/databaseMocks.js';

// Mock the pg and ioredis modules
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => mockPgPool)
}));

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => mockRedisClient);
});

describe('TimescaleAdapter', () => {
  let storage;
  let TimescaleAdapter;
  const testTenantId = 'test-tenant-123';
  
  beforeAll(async () => {
    // Dynamically import after mocks are set up
    const module = await import('../../src/storage/timescaleAdapter.js');
    TimescaleAdapter = module.default;
    
    storage = new TimescaleAdapter({
      dbHost: 'localhost',
      dbPort: 5432,
      dbName: 'traversion_test',
      dbUser: 'test',
      dbPassword: 'test',
      redisHost: 'localhost',
      redisPort: 6379
    });
  });
  
  afterAll(async () => {
    if (storage) {
      await storage.disconnect();
    }
  });
  
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    
    // Setup default mock responses
    mockPgPool.connect.mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn()
    });
    
    mockPgPool.query.mockResolvedValue({ rows: [] });
    mockRedisClient.ping.mockResolvedValue('PONG');
  });
  
  describe('Connection Management', () => {
    it('should connect to TimescaleDB successfully', async () => {
      mockPgPool.connect.mockResolvedValueOnce({
        query: jest.fn().mockResolvedValue({ rows: [{ now: new Date() }] }),
        release: jest.fn()
      });
      
      const result = await storage.connect();
      
      expect(result).toBe(true);
      expect(mockPgPool.connect).toHaveBeenCalled();
    });
    
    it('should connect to Redis successfully', async () => {
      mockRedisClient.connect.mockResolvedValueOnce();
      mockRedisClient.ping.mockResolvedValueOnce('PONG');
      
      await storage.connect();
      
      expect(mockRedisClient.ping).toHaveBeenCalled();
    });
    
    it('should handle connection errors gracefully', async () => {
      mockPgPool.connect.mockRejectedValueOnce(new Error('Connection failed'));
      
      await expect(storage.connect()).rejects.toThrow('Connection failed');
    });
  });
  
  describe('Event Storage', () => {
    it('should store single event', async () => {
      const event = {
        eventId: 'test-event-1',
        timestamp: new Date(),
        eventType: 'test.created',
        serviceId: 'test-service',
        data: { test: true }
      };
      
      mockPgPool.query.mockResolvedValueOnce({
        rows: [{ id: 1, ...event }]
      });
      
      const result = await storage.storeEvent(event, testTenantId);
      
      expect(result).toBeDefined();
      expect(mockPgPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO events'),
        expect.arrayContaining([event.eventId, testTenantId])
      );
    });
    
    it('should store multiple events in batch', async () => {
      const events = [
        {
          eventId: 'test-event-1',
          timestamp: new Date(),
          eventType: 'test.created',
          serviceId: 'test-service'
        },
        {
          eventId: 'test-event-2',
          timestamp: new Date(),
          eventType: 'test.updated',
          serviceId: 'test-service'
        }
      ];
      
      mockPgPool.query.mockResolvedValueOnce({
        rowCount: 2
      });
      
      const result = await storage.storeEvents(events, testTenantId);
      
      expect(result.count).toBe(2);
    });
    
    it('should handle duplicate event IDs', async () => {
      const event = {
        eventId: 'duplicate-event',
        timestamp: new Date(),
        eventType: 'test.duplicate'
      };
      
      mockPgPool.query.mockRejectedValueOnce({
        code: '23505', // Unique violation
        message: 'duplicate key value'
      });
      
      await expect(storage.storeEvent(event, testTenantId))
        .rejects.toThrow();
    });
  });
  
  describe('Event Querying', () => {
    it('should query events by time range', async () => {
      const startTime = new Date(Date.now() - 3600000);
      const endTime = new Date();
      
      mockPgPool.query.mockResolvedValueOnce({
        rows: [
          { eventId: 'event-1', timestamp: startTime },
          { eventId: 'event-2', timestamp: endTime }
        ]
      });
      
      const events = await storage.queryEvents({
        startTime,
        endTime,
        tenantId: testTenantId
      });
      
      expect(events).toHaveLength(2);
      expect(mockPgPool.query).toHaveBeenCalledWith(
        expect.stringContaining('timestamp BETWEEN'),
        expect.arrayContaining([startTime, endTime, testTenantId])
      );
    });
    
    it('should filter events by service', async () => {
      mockPgPool.query.mockResolvedValueOnce({
        rows: [{ eventId: 'service-event', serviceId: 'api-gateway' }]
      });
      
      const events = await storage.queryEvents({
        serviceId: 'api-gateway',
        tenantId: testTenantId
      });
      
      expect(events).toHaveLength(1);
      expect(mockPgPool.query).toHaveBeenCalledWith(
        expect.stringContaining('service_id = '),
        expect.arrayContaining(['api-gateway'])
      );
    });
    
    it('should limit query results', async () => {
      mockPgPool.query.mockResolvedValueOnce({
        rows: Array(10).fill({ eventId: 'event' })
      });
      
      const events = await storage.queryEvents({
        limit: 10,
        tenantId: testTenantId
      });
      
      expect(events).toHaveLength(10);
      expect(mockPgPool.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        expect.arrayContaining([10])
      );
    });
  });
  
  describe('Caching', () => {
    it('should cache frequently accessed events', async () => {
      const eventId = 'cached-event';
      const cachedData = JSON.stringify({
        eventId,
        timestamp: new Date(),
        eventType: 'cached'
      });
      
      // First call - miss cache, query database
      mockRedisClient.get.mockResolvedValueOnce(null);
      mockPgPool.query.mockResolvedValueOnce({
        rows: [{ eventId }]
      });
      
      await storage.getEvent(eventId, testTenantId);
      
      expect(mockRedisClient.get).toHaveBeenCalledWith(
        expect.stringContaining(eventId)
      );
      expect(mockPgPool.query).toHaveBeenCalled();
      
      // Second call - hit cache
      mockRedisClient.get.mockResolvedValueOnce(cachedData);
      
      await storage.getEvent(eventId, testTenantId);
      
      expect(mockRedisClient.get).toHaveBeenCalledTimes(2);
    });
    
    it('should invalidate cache on event update', async () => {
      const eventId = 'updated-event';
      
      await storage.updateEvent(eventId, { data: { updated: true } }, testTenantId);
      
      expect(mockRedisClient.del).toHaveBeenCalledWith(
        expect.stringContaining(eventId)
      );
    });
  });
  
  describe('Multi-tenant Isolation', () => {
    it('should isolate data between tenants', async () => {
      const tenant1 = 'tenant-1';
      const tenant2 = 'tenant-2';
      
      // Store event for tenant 1
      await storage.storeEvent({
        eventId: 'tenant1-event',
        timestamp: new Date()
      }, tenant1);
      
      // Query events for tenant 2 - should be empty
      mockPgPool.query.mockResolvedValueOnce({ rows: [] });
      
      const events = await storage.queryEvents({ tenantId: tenant2 });
      
      expect(events).toHaveLength(0);
      expect(mockPgPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([tenant2])
      );
    });
    
    it('should prevent cross-tenant data access', async () => {
      const eventId = 'private-event';
      const wrongTenant = 'wrong-tenant';
      
      mockPgPool.query.mockResolvedValueOnce({ rows: [] });
      
      const event = await storage.getEvent(eventId, wrongTenant);
      
      expect(event).toBeUndefined();
    });
  });
  
  describe('System State Queries', () => {
    it('should get system state at timestamp', async () => {
      const timestamp = new Date();
      
      mockPgPool.query.mockResolvedValueOnce({
        rows: [
          { serviceId: 'api', metric: 'cpu', value: 45 },
          { serviceId: 'db', metric: 'memory', value: 80 }
        ]
      });
      
      const state = await storage.getSystemState(timestamp, testTenantId);
      
      expect(state).toBeDefined();
      expect(mockPgPool.query).toHaveBeenCalledWith(
        expect.stringContaining('timestamp <= '),
        expect.arrayContaining([timestamp])
      );
    });
    
    it('should compare two system states', async () => {
      const time1 = new Date(Date.now() - 3600000);
      const time2 = new Date();
      
      mockPgPool.query
        .mockResolvedValueOnce({ rows: [{ serviceId: 'api', value: 40 }] })
        .mockResolvedValueOnce({ rows: [{ serviceId: 'api', value: 60 }] });
      
      const comparison = await storage.compareStates(time1, time2, testTenantId);
      
      expect(comparison.differences).toBeDefined();
      expect(mockPgPool.query).toHaveBeenCalledTimes(2);
    });
  });
  
  describe('Data Cleanup', () => {
    it('should clean up old events', async () => {
      const retentionDays = 30;
      
      mockPgPool.query.mockResolvedValueOnce({
        rowCount: 100
      });
      
      const result = await storage.cleanup(retentionDays, testTenantId);
      
      expect(result.removed).toBe(100);
      expect(mockPgPool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM events'),
        expect.any(Array)
      );
    });
    
    it('should handle cleanup errors gracefully', async () => {
      mockPgPool.query.mockRejectedValueOnce(new Error('Cleanup failed'));
      
      await expect(storage.cleanup(30, testTenantId))
        .rejects.toThrow('Cleanup failed');
    });
  });
});