/**
 * Authentication and Multi-tenancy Integration Tests
 * 
 * Tests the complete authentication flow, multi-tenant isolation,
 * and role-based access control for Traversion production platform.
 */

import { describe, it, beforeAll, afterAll, expect } from '@jest/globals';
import fetch from 'node-fetch';
import AuthService from '../../src/auth/authService.js';
import TimescaleAdapter from '../../src/storage/timescaleAdapter.js';

const TEST_DB_CONFIG = {
  dbHost: process.env.TEST_DB_HOST || 'localhost',
  dbPort: process.env.TEST_DB_PORT || 5432,
  dbName: process.env.TEST_DB_NAME || 'traversion_test',
  dbUser: process.env.TEST_DB_USER || 'traversion',
  dbPassword: process.env.TEST_DB_PASSWORD || 'traversion_secret',
  redisHost: process.env.TEST_REDIS_HOST || 'localhost',
  redisPort: process.env.TEST_REDIS_PORT || 6379
};

const API_BASE = 'http://localhost:3338';
let storage;
let authService;
let testTenant1, testTenant2;
let adminUser, editorUser, viewerUser;
let adminToken, editorToken, viewerToken;
let apiKey;

describe('Authentication & Multi-tenancy', () => {
  beforeAll(async () => {
    // Initialize storage and auth service
    storage = new TimescaleAdapter(TEST_DB_CONFIG);
    await storage.connect();
    
    authService = new AuthService(storage, {
      jwtSecret: 'test-secret-key',
      jwtExpiry: '1h',
      apiKeySecret: 'test-api-secret'
    });
    
    await authService.initialize();
    
    // Create test tenants
    const tenant1Result = await authService.createTenant('Test Organization 1');
    const tenant2Result = await authService.createTenant('Test Organization 2');
    
    expect(tenant1Result.success).toBe(true);
    expect(tenant2Result.success).toBe(true);
    
    testTenant1 = tenant1Result.tenant;
    testTenant2 = tenant2Result.tenant;
    
    // Create test users
    const adminResult = await authService.createUser(
      'admin@test1.com', 'password123', 'Admin User', testTenant1.id, 'admin'
    );
    const editorResult = await authService.createUser(
      'editor@test1.com', 'password123', 'Editor User', testTenant1.id, 'editor'
    );
    const viewerResult = await authService.createUser(
      'viewer@test2.com', 'password123', 'Viewer User', testTenant2.id, 'viewer'
    );
    
    expect(adminResult.success).toBe(true);
    expect(editorResult.success).toBe(true);
    expect(viewerResult.success).toBe(true);
    
    adminUser = adminResult.user;
    editorUser = editorResult.user;
    viewerUser = viewerResult.user;
    
    // Get authentication tokens
    const adminLogin = await authService.login('admin@test1.com', 'password123');
    const editorLogin = await authService.login('editor@test1.com', 'password123');
    const viewerLogin = await authService.login('viewer@test2.com', 'password123');
    
    adminToken = adminLogin.token;
    editorToken = editorLogin.token;
    viewerToken = viewerLogin.token;
    
    // Create test API key
    const apiKeyResult = await authService.createAPIKey(
      'test-api-key', testTenant1.id, adminUser.id, ['events:write', 'events:read']
    );
    apiKey = apiKeyResult.apiKey.key;
  });
  
  afterAll(async () => {
    // Cleanup test data
    await storage.query('DELETE FROM audit_log WHERE tenant_id IN ($1, $2)', [testTenant1.id, testTenant2.id]);
    await storage.query('DELETE FROM api_keys WHERE tenant_id IN ($1, $2)', [testTenant1.id, testTenant2.id]);
    await storage.query('DELETE FROM user_sessions WHERE user_id IN ($1, $2, $3)', [adminUser.id, editorUser.id, viewerUser.id]);
    await storage.query('DELETE FROM users WHERE tenant_id IN ($1, $2)', [testTenant1.id, testTenant2.id]);
    await storage.query('DELETE FROM tenants WHERE id IN ($1, $2)', [testTenant1.id, testTenant2.id]);
    
    await storage.disconnect();
  });
  
  describe('Authentication Flow', () => {
    it('should login with valid credentials', async () => {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'admin@test1.com',
          password: 'password123'
        })
      });
      
      const result = await response.json();
      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.token).toBeDefined();
      expect(result.user.email).toBe('admin@test1.com');
      expect(result.tenant.id).toBe(testTenant1.id);
    });
    
    it('should reject login with invalid credentials', async () => {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'admin@test1.com',
          password: 'wrongpassword'
        })
      });
      
      const result = await response.json();
      expect(response.status).toBe(401);
      expect(result.success).toBe(false);
    });
    
    it('should refresh JWT token', async () => {
      const response = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        }
      });
      
      const result = await response.json();
      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.token).toBeDefined();
    });
    
    it('should logout successfully', async () => {
      const response = await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${adminToken}`
        }
      });
      
      const result = await response.json();
      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
    });
  });
  
  describe('Multi-tenant Isolation', () => {
    it('should isolate events between tenants', async () => {
      // Create event for tenant 1
      const event1 = {
        eventType: 'user.login',
        serviceId: 'auth-service',
        data: { userId: 'user123' }
      };
      
      const response1 = await fetch(`${API_BASE}/api/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify(event1)
      });
      
      expect(response1.status).toBe(200);
      
      // Try to access events from tenant 2
      const response2 = await fetch(`${API_BASE}/api/events`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${viewerToken}` // tenant 2 user
        }
      });
      
      const result2 = await response2.json();
      expect(response2.status).toBe(200);
      expect(result2.events).toBeDefined();
      
      // Events should be filtered by tenant
      const tenant1Events = result2.events.filter(e => e.tenantId === testTenant1.id);
      expect(tenant1Events.length).toBe(0); // Tenant 2 user shouldn't see tenant 1 events
    });
    
    it('should isolate users between tenants', async () => {
      const response = await fetch(`${API_BASE}/api/auth/users`, {
        headers: {
          'Authorization': `Bearer ${adminToken}` // tenant 1 admin
        }
      });
      
      const result = await response.json();
      expect(response.status).toBe(200);
      expect(result.users).toBeDefined();
      
      // Should only see users from same tenant
      const tenant1Users = result.users.filter(u => u.tenantId === testTenant1.id);
      const tenant2Users = result.users.filter(u => u.tenantId === testTenant2.id);
      
      expect(tenant1Users.length).toBeGreaterThan(0);
      expect(tenant2Users.length).toBe(0);
    });
  });
  
  describe('Role-based Access Control', () => {
    it('should allow admin to create API keys', async () => {
      const response = await fetch(`${API_BASE}/api/auth/api-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          name: 'test-key-rbac',
          permissions: ['events:read']
        })
      });
      
      const result = await response.json();
      expect(response.status).toBe(201);
      expect(result.success).toBe(true);
      expect(result.apiKey.key).toBeDefined();
    });
    
    it('should deny editor from creating API keys', async () => {
      const response = await fetch(`${API_BASE}/api/auth/api-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${editorToken}`
        },
        body: JSON.stringify({
          name: 'unauthorized-key',
          permissions: ['events:read']
        })
      });
      
      expect(response.status).toBe(403); // Forbidden
    });
    
    it('should allow editor to query events', async () => {
      const response = await fetch(`${API_BASE}/api/events`, {
        headers: {
          'Authorization': `Bearer ${editorToken}`
        }
      });
      
      expect(response.status).toBe(200);
    });
    
    it('should deny viewer from writing events', async () => {
      const response = await fetch(`${API_BASE}/api/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${viewerToken}`
        },
        body: JSON.stringify({
          eventType: 'test.event',
          data: {}
        })
      });
      
      expect(response.status).toBe(403); // Forbidden
    });
  });
  
  describe('API Key Authentication', () => {
    it('should authenticate with valid API key', async () => {
      const response = await fetch(`${API_BASE}/api/events`, {
        headers: {
          'X-API-Key': apiKey
        }
      });
      
      expect(response.status).toBe(200);
    });
    
    it('should reject invalid API key', async () => {
      const response = await fetch(`${API_BASE}/api/events`, {
        headers: {
          'X-API-Key': 'invalid-key'
        }
      });
      
      expect(response.status).toBe(401);
    });
    
    it('should respect API key permissions', async () => {
      // API key has events:write permission, should work
      const writeResponse = await fetch(`${API_BASE}/api/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey
        },
        body: JSON.stringify({
          eventType: 'api.test',
          data: { test: true }
        })
      });
      
      expect(writeResponse.status).toBe(200);
    });
  });
  
  describe('WebSocket Authentication', () => {
    it('should authenticate WebSocket with JWT token', (done) => {
      const WebSocket = require('ws');
      const ws = new WebSocket('ws://localhost:3339');
      
      ws.on('open', () => {
        ws.send(JSON.stringify({
          type: 'authenticate',
          token: adminToken
        }));
      });
      
      ws.on('message', (data) => {
        const message = JSON.parse(data);
        
        if (message.type === 'authenticated') {
          expect(message.user).toBeDefined();
          expect(message.user.email).toBe('admin@test1.com');
          ws.close();
          done();
        }
      });
      
      ws.on('error', done);
    });
    
    it('should authenticate WebSocket with API key', (done) => {
      const WebSocket = require('ws');
      const ws = new WebSocket('ws://localhost:3339');
      
      ws.on('open', () => {
        ws.send(JSON.stringify({
          type: 'authenticate',
          apiKey: apiKey
        }));
      });
      
      ws.on('message', (data) => {
        const message = JSON.parse(data);
        
        if (message.type === 'authenticated') {
          expect(message.user.tenantId).toBe(testTenant1.id);
          ws.close();
          done();
        }
      });
      
      ws.on('error', done);
    });
  });
  
  describe('Audit Logging', () => {
    it('should log authentication events', async () => {
      // Login to generate audit event
      await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'admin@test1.com',
          password: 'password123'
        })
      });
      
      // Check audit log
      const auditResult = await storage.query(
        'SELECT * FROM audit_log WHERE tenant_id = $1 AND action = $2 ORDER BY timestamp DESC LIMIT 1',
        [testTenant1.id, 'auth.login']
      );
      
      expect(auditResult.rows.length).toBeGreaterThan(0);
      expect(auditResult.rows[0].action).toBe('auth.login');
      expect(auditResult.rows[0].user_id).toBe(adminUser.id);
    });
  });
});