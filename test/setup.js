/**
 * Test Environment Setup
 * 
 * Global test configuration and setup for Jest test suite.
 * Handles test database initialization, cleanup, and environment variables.
 */

import { jest } from '@jest/globals';

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // Reduce log noise during tests

// Test database configuration
process.env.TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';
process.env.TEST_DB_PORT = process.env.TEST_DB_PORT || '5432';
process.env.TEST_DB_NAME = process.env.TEST_DB_NAME || 'traversion_test';
process.env.TEST_DB_USER = process.env.TEST_DB_USER || 'traversion';
process.env.TEST_DB_PASSWORD = process.env.TEST_DB_PASSWORD || 'traversion_secret';

// Test Redis configuration
process.env.TEST_REDIS_HOST = process.env.TEST_REDIS_HOST || 'localhost';
process.env.TEST_REDIS_PORT = process.env.TEST_REDIS_PORT || '6379';

// Authentication test configuration
process.env.JWT_SECRET = 'test-jwt-secret-key';
process.env.API_KEY_SECRET = 'test-api-key-secret';

// Global test timeout (30 seconds for integration tests)
jest.setTimeout(30000);

// Global test utilities
global.testUtils = {
  // Generate test event
  createTestEvent: (overrides = {}) => ({
    eventId: `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    eventType: 'test.event',
    serviceId: 'test-service',
    data: { test: true },
    ...overrides
  }),
  
  // Generate test user
  createTestUser: (overrides = {}) => ({
    email: `test-${Date.now()}@example.com`,
    password: 'testPassword123',
    name: 'Test User',
    role: 'viewer',
    ...overrides
  }),
  
  // Generate test tenant
  createTestTenant: (overrides = {}) => ({
    name: `Test Tenant ${Date.now()}`,
    subdomain: `test-${Date.now()}`,
    ...overrides
  }),
  
  // Wait for async operations
  wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  
  // Generate time range
  timeRange: (hoursAgo = 1, hoursForward = 0) => ({
    start: Date.now() - (hoursAgo * 60 * 60 * 1000),
    end: Date.now() + (hoursForward * 60 * 60 * 1000)
  })
};

// Global error handler for unhandled promise rejections
process.on('unhandledRejection', (error) => {
  console.error('Unhandled Promise Rejection during tests:', error);
});

console.log('Test environment initialized');