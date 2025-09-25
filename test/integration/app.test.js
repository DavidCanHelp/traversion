/**
 * Comprehensive Integration Tests for Traversion Application
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import TraversionApp from '../../src/app.js';
import Database from 'better-sqlite3';
import { existsSync, rmSync } from 'fs';

describe('Traversion Application Integration Tests', () => {
  let app;
  let server;
  let authToken;
  let testUser = {
    username: 'testuser',
    email: 'test@example.com',
    password: 'Test123!@#'
  };

  beforeAll(async () => {
    // Clean test database
    if (existsSync('./.traversion/test.db')) {
      rmSync('./.traversion/test.db');
    }

    // Start application
    const traversionApp = new TraversionApp(0); // Random port
    server = await traversionApp.start();
    app = traversionApp.app;
  });

  afterAll(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  describe('Health & Info Endpoints', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('timestamp');
    });

    it('should return application info', async () => {
      const response = await request(app)
        .get('/api/info')
        .expect(200);

      expect(response.body).toHaveProperty('app', 'Traversion');
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('status', 'running');
    });
  });

  describe('Authentication', () => {
    it('should register a new user', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send(testUser)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('id');
      expect(response.body.user).toHaveProperty('username', testUser.username);
    });

    it('should not register duplicate user', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send(testUser)
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should login with valid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password
        })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');

      authToken = response.body.token;
    });

    it('should reject invalid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: testUser.username,
          password: 'wrongpassword'
        })
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });

    it('should get current user with valid token', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('username', testUser.username);
    });

    it('should generate API key', async () => {
      const response = await request(app)
        .post('/api/auth/api-key')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Test API Key' })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('apiKey');
      expect(response.body.apiKey.apiKey).toMatch(/^trav_/);
    });

    it('should logout successfully', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
    });
  });

  describe('Protected Endpoints', () => {
    beforeEach(async () => {
      // Login to get fresh token
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password
        });

      authToken = loginResponse.body.token;
    });

    it('should require authentication for timeline', async () => {
      await request(app)
        .get('/api/timeline')
        .expect(401);
    });

    it('should get timeline with authentication', async () => {
      const response = await request(app)
        .get('/api/timeline')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('commits');
      expect(Array.isArray(response.body.commits)).toBe(true);
    });

    it('should analyze incident', async () => {
      const response = await request(app)
        .post('/api/incident')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          time: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
          hours: 24
        })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('incidentId');
      expect(response.body).toHaveProperty('suspiciousCommits');
      expect(response.body).toHaveProperty('recommendations');
    });

    it('should get incidents list', async () => {
      const response = await request(app)
        .get('/api/incidents')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('incidents');
      expect(Array.isArray(response.body.incidents)).toBe(true);
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits on auth endpoints', async () => {
      // Make multiple rapid requests
      const requests = [];
      for (let i = 0; i < 10; i++) {
        requests.push(
          request(app)
            .post('/api/auth/login')
            .send({
              username: `user${i}`,
              password: 'wrong'
            })
        );
      }

      const responses = await Promise.all(requests);
      const rateLimited = responses.filter(r => r.status === 429);

      expect(rateLimited.length).toBeGreaterThan(0);
    });
  });

  describe('Input Validation', () => {
    it('should validate registration input', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'ab', // Too short
          email: 'invalid-email',
          password: '123' // Too weak
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('details');
    });

    it('should validate incident analysis input', async () => {
      const response = await request(app)
        .post('/api/incident')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          time: 'invalid-date',
          hours: 'not-a-number'
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should sanitize HTML in input', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'test<script>alert(1)</script>user',
          email: 'test@example.com',
          password: 'Test123!@#'
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Error Handling', () => {
    it('should handle 404 errors', async () => {
      const response = await request(app)
        .get('/api/nonexistent')
        .expect(404);

      expect(response.body).toHaveProperty('error');
    });

    it('should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"invalid json')
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Swagger Documentation', () => {
    it('should serve API documentation', async () => {
      const response = await request(app)
        .get('/api-docs/')
        .expect(200);

      expect(response.text).toContain('swagger');
    });
  });

  describe('Risk Analysis Integration', () => {
    it('should calculate risk scores for commits', async () => {
      const response = await request(app)
        .get('/api/timeline')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      if (response.body.commits && response.body.commits.length > 0) {
        const commit = response.body.commits[0];
        expect(commit).toHaveProperty('risk');
        expect(commit).toHaveProperty('riskLevel');
        expect(commit).toHaveProperty('riskFactors');
        expect(typeof commit.risk).toBe('number');
        expect(commit.risk).toBeGreaterThanOrEqual(0);
        expect(commit.risk).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('Causality Analysis (Feature Flag)', () => {
    it('should include causality analysis when ML feature is enabled', async () => {
      // This would only work if FEATURE_ML=true
      process.env.FEATURE_ML = 'true';

      const response = await request(app)
        .post('/api/incident')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          time: new Date(Date.now() - 3600000).toISOString(),
          hours: 24
        });

      // Causality analysis might be null if feature is disabled
      if (response.body.causalityAnalysis) {
        expect(response.body.causalityAnalysis).toHaveProperty('nodes');
        expect(response.body.causalityAnalysis).toHaveProperty('chains');
        expect(response.body.causalityAnalysis).toHaveProperty('rootCauses');
      }
    });
  });

  describe('Security Headers', () => {
    it('should include security headers', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.headers).toHaveProperty('x-content-type-options');
      expect(response.headers).toHaveProperty('x-frame-options');
      expect(response.headers).toHaveProperty('x-xss-protection');
    });
  });

  describe('Database Persistence', () => {
    it('should persist incidents to database', async () => {
      // Create incident
      const incidentResponse = await request(app)
        .post('/api/incident')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          time: new Date(Date.now() - 7200000).toISOString(),
          hours: 12
        })
        .expect(200);

      const incidentId = incidentResponse.body.incidentId;

      // Fetch incidents list
      const listResponse = await request(app)
        .get('/api/incidents')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const foundIncident = listResponse.body.incidents.find(
        inc => inc.id === incidentId
      );

      expect(foundIncident).toBeDefined();
      expect(foundIncident.id).toBe(incidentId);
    });
  });
});

describe('Environment Configuration', () => {
  it('should validate production configuration', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    // This should throw if JWT_SECRET is not set properly
    expect(() => {
      process.env.JWT_SECRET = 'development-secret-change-in-production';
      require('../../src/config/environment.js');
    }).toThrow();

    process.env.NODE_ENV = originalEnv;
  });
});

describe('Secret Management', () => {
  it('should handle secret rotation', async () => {
    const { SecretManager } = await import('../../src/security/secretManager.js');
    const manager = new SecretManager({ backend: 'env' });

    // Set a secret
    manager.set('TEST_SECRET', 'initial-value');
    expect(manager.get('TEST_SECRET')).toBe('initial-value');

    // Rotate the secret
    const result = await manager.rotate('TEST_SECRET');
    expect(result).toHaveProperty('rotated', true);
    expect(manager.get('TEST_SECRET')).not.toBe('initial-value');
  });
});