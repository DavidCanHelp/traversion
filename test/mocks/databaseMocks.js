/**
 * Database Test Mocks
 * 
 * Mock implementations for database connections in tests
 */

import { jest } from '@jest/globals';

// Mock PostgreSQL pool
export const mockPgPool = {
  connect: jest.fn().mockResolvedValue({
    query: jest.fn().mockResolvedValue({ rows: [] }),
    release: jest.fn()
  }),
  query: jest.fn().mockResolvedValue({ rows: [] }),
  end: jest.fn().mockResolvedValue(undefined),
  on: jest.fn()
};

// Mock Redis client
export const mockRedisClient = {
  connect: jest.fn().mockResolvedValue(undefined),
  ping: jest.fn().mockResolvedValue('PONG'),
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  expire: jest.fn().mockResolvedValue(1),
  zadd: jest.fn().mockResolvedValue(1),
  zrange: jest.fn().mockResolvedValue([]),
  zrangebyscore: jest.fn().mockResolvedValue([]),
  hset: jest.fn().mockResolvedValue(1),
  hget: jest.fn().mockResolvedValue(null),
  hgetall: jest.fn().mockResolvedValue({}),
  quit: jest.fn().mockResolvedValue('OK'),
  on: jest.fn()
};

// Mock TimescaleDB specific functions
export const mockTimescaleQueries = {
  createHypertable: jest.fn().mockResolvedValue({ rows: [] }),
  createIndex: jest.fn().mockResolvedValue({ rows: [] }),
  setRetentionPolicy: jest.fn().mockResolvedValue({ rows: [] }),
  timeseriesQuery: jest.fn().mockResolvedValue({ rows: [] })
};

// Mock SQLite for local testing
export const mockSqliteDb = {
  prepare: jest.fn().mockReturnValue({
    run: jest.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 }),
    get: jest.fn().mockReturnValue(undefined),
    all: jest.fn().mockReturnValue([]),
    finalize: jest.fn()
  }),
  run: jest.fn((sql, params, callback) => {
    if (callback) callback(null);
    return { changes: 1, lastInsertRowid: 1 };
  }),
  get: jest.fn((sql, params, callback) => {
    if (callback) callback(null, undefined);
    return undefined;
  }),
  all: jest.fn((sql, params, callback) => {
    if (callback) callback(null, []);
    return [];
  }),
  close: jest.fn((callback) => {
    if (callback) callback(null);
  })
};

// Create mock database adapter
export const createMockAdapter = () => ({
  connect: jest.fn().mockResolvedValue(true),
  disconnect: jest.fn().mockResolvedValue(true),
  storeEvent: jest.fn().mockResolvedValue({ eventId: 'mock-event-id' }),
  storeEvents: jest.fn().mockResolvedValue({ count: 0 }),
  queryEvents: jest.fn().mockResolvedValue([]),
  getSystemState: jest.fn().mockResolvedValue({}),
  compareStates: jest.fn().mockResolvedValue({ differences: [] }),
  searchEvents: jest.fn().mockResolvedValue([]),
  aggregateMetrics: jest.fn().mockResolvedValue({}),
  getCausalityChain: jest.fn().mockResolvedValue([]),
  storeCausalityRelation: jest.fn().mockResolvedValue(true),
  getPatterns: jest.fn().mockResolvedValue([]),
  storePattern: jest.fn().mockResolvedValue({ patternId: 'mock-pattern' }),
  cleanup: jest.fn().mockResolvedValue({ removed: 0 }),
  getStats: jest.fn().mockResolvedValue({
    eventCount: 0,
    oldestEvent: null,
    newestEvent: null,
    avgEventsPerSecond: 0
  })
});

// Helper to reset all mocks
export const resetDatabaseMocks = () => {
  Object.values(mockPgPool).forEach(fn => {
    if (typeof fn.mockReset === 'function') {
      fn.mockReset();
    }
  });
  
  Object.values(mockRedisClient).forEach(fn => {
    if (typeof fn.mockReset === 'function') {
      fn.mockReset();
    }
  });
  
  Object.values(mockSqliteDb).forEach(fn => {
    if (typeof fn.mockReset === 'function') {
      fn.mockReset();
    }
  });
};

export default {
  mockPgPool,
  mockRedisClient,
  mockTimescaleQueries,
  mockSqliteDb,
  createMockAdapter,
  resetDatabaseMocks
};