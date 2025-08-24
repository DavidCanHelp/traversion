/**
 * Authentication & Authorization Service
 * 
 * Provides JWT-based authentication, role-based access control,
 * and multi-tenancy support for Traversion production platform.
 */

import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { EventEmitter } from 'events';

class AuthService extends EventEmitter {
  constructor(storage) {
    super();
    this.storage = storage;
    this.jwtSecret = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
    this.jwtExpiry = process.env.JWT_EXPIRY || '24h';
    this.saltRounds = 12;
    
    // Permission definitions
    this.permissions = {
      // Read permissions
      'events:read': 'Read events and timeline data',
      'causality:read': 'Read causality chains and patterns',
      'metrics:read': 'Read system metrics and stats',
      'queries:execute': 'Execute TimeQL queries',
      
      // Write permissions
      'events:write': 'Create and modify events',
      'causality:write': 'Create causality relationships',
      'patterns:write': 'Create and modify patterns',
      
      // Admin permissions
      'users:manage': 'Manage users and permissions',
      'tenants:manage': 'Manage tenant settings',
      'system:admin': 'Full system administration',
      
      // Export permissions
      'data:export': 'Export data and create backups',
      'data:import': 'Import data from external sources'
    };
    
    // Role definitions
    this.roles = {
      'viewer': {
        name: 'Viewer',
        description: 'Read-only access to events and metrics',
        permissions: ['events:read', 'causality:read', 'metrics:read', 'queries:execute']
      },
      'developer': {
        name: 'Developer',
        description: 'Read access plus ability to create events',
        permissions: ['events:read', 'events:write', 'causality:read', 'metrics:read', 'queries:execute']
      },
      'analyst': {
        name: 'Analyst',
        description: 'Full read access plus data export',
        permissions: ['events:read', 'causality:read', 'metrics:read', 'queries:execute', 'data:export']
      },
      'admin': {
        name: 'Administrator',
        description: 'Full access to tenant resources',
        permissions: Object.keys(this.permissions).filter(p => !p.includes('system:'))
      },
      'superadmin': {
        name: 'Super Administrator',
        description: 'Full system access across all tenants',
        permissions: Object.keys(this.permissions)
      }
    };
  }

  /**
   * Initialize authentication tables
   */
  async initialize() {
    try {
      await this.createAuthTables();
      await this.createDefaultSuperAdmin();
      logger.info('✓ Authentication service initialized');
    } catch (error) {
      logger.error('Failed to initialize auth service:', error);
      throw error;
    }
  }

  /**
   * Create authentication database tables
   */
  async createAuthTables() {
    const queries = [
      // Tenants table
      `CREATE TABLE IF NOT EXISTS traversion.tenants (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(255) NOT NULL UNIQUE,
        display_name VARCHAR(255) NOT NULL,
        domain VARCHAR(255),
        settings JSONB DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        active BOOLEAN DEFAULT TRUE
      )`,
      
      // Users table
      `CREATE TABLE IF NOT EXISTS traversion.users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        tenant_id UUID REFERENCES traversion.tenants(id),
        role VARCHAR(50) NOT NULL DEFAULT 'viewer',
        permissions TEXT[] DEFAULT '{}',
        settings JSONB DEFAULT '{}',
        last_login TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        active BOOLEAN DEFAULT TRUE,
        email_verified BOOLEAN DEFAULT FALSE
      )`,
      
      // API Keys table
      `CREATE TABLE IF NOT EXISTS traversion.api_keys (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        key_hash VARCHAR(255) NOT NULL UNIQUE,
        key_prefix VARCHAR(20) NOT NULL,
        name VARCHAR(255) NOT NULL,
        user_id UUID REFERENCES traversion.users(id),
        tenant_id UUID REFERENCES traversion.tenants(id),
        permissions TEXT[] DEFAULT '{}',
        expires_at TIMESTAMP WITH TIME ZONE,
        last_used TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        active BOOLEAN DEFAULT TRUE
      )`,
      
      // Sessions table
      `CREATE TABLE IF NOT EXISTS traversion.auth_sessions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES traversion.users(id),
        token_hash VARCHAR(255) NOT NULL,
        ip_address INET,
        user_agent TEXT,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        active BOOLEAN DEFAULT TRUE
      )`,
      
      // Audit log
      `CREATE TABLE IF NOT EXISTS traversion.auth_audit (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES traversion.users(id),
        tenant_id UUID REFERENCES traversion.tenants(id),
        action VARCHAR(100) NOT NULL,
        resource VARCHAR(100),
        ip_address INET,
        user_agent TEXT,
        success BOOLEAN NOT NULL,
        details JSONB DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )`
    ];
    
    for (const query of queries) {
      await this.storage.pool.query(query);
    }
    
    // Create indexes
    await this.storage.pool.query('CREATE INDEX IF NOT EXISTS idx_users_email ON traversion.users(email)');
    await this.storage.pool.query('CREATE INDEX IF NOT EXISTS idx_users_tenant ON traversion.users(tenant_id)');
    await this.storage.pool.query('CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON traversion.api_keys(key_hash)');
    await this.storage.pool.query('CREATE INDEX IF NOT EXISTS idx_sessions_token ON traversion.auth_sessions(token_hash)');
    await this.storage.pool.query('CREATE INDEX IF NOT EXISTS idx_audit_user ON traversion.auth_audit(user_id, created_at)');
  }

  /**
   * Create default super admin
   */
  async createDefaultSuperAdmin() {
    // Check if super admin exists
    const existing = await this.storage.pool.query(
      'SELECT id FROM traversion.users WHERE role = $1 LIMIT 1',
      ['superadmin']
    );
    
    if (existing.rows.length > 0) return;
    
    // Create default tenant
    const tenant = await this.createTenant('default', 'Default Organization');
    
    // Create super admin user
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@traversion.local';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123!';
    
    await this.createUser({
      email: adminEmail,
      password: adminPassword,
      firstName: 'Super',
      lastName: 'Admin',
      tenantId: tenant.id,
      role: 'superadmin',
      emailVerified: true
    });
    
    logger.info(`✓ Created super admin: ${adminEmail}`);
    logger.info(`  Default password: ${adminPassword}`);
    logger.info('  ⚠️  Please change the default password!');
  }

  /**
   * Create a new tenant
   */
  async createTenant(name, displayName, domain = null) {
    const query = `
      INSERT INTO traversion.tenants (name, display_name, domain)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    
    try {
      const result = await this.storage.pool.query(query, [name, displayName, domain]);
      const tenant = result.rows[0];
      
      this.emit('tenant:created', tenant);
      return tenant;
    } catch (error) {
      if (error.code === '23505') { // Unique violation
        throw new Error('Tenant name already exists');
      }
      throw error;
    }
  }

  /**
   * Create a new user
   */
  async createUser(userData) {
    const {
      email,
      password,
      firstName,
      lastName,
      tenantId,
      role = 'viewer',
      permissions = [],
      emailVerified = false
    } = userData;
    
    // Validate role
    if (!this.roles[role]) {
      throw new Error('Invalid role');
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, this.saltRounds);
    
    const query = `
      INSERT INTO traversion.users (
        email, password_hash, first_name, last_name,
        tenant_id, role, permissions, email_verified
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, email, first_name, last_name, role, created_at
    `;
    
    try {
      const result = await this.storage.pool.query(query, [
        email.toLowerCase(),
        passwordHash,
        firstName,
        lastName,
        tenantId,
        role,
        permissions,
        emailVerified
      ]);
      
      const user = result.rows[0];
      this.emit('user:created', user);
      return user;
    } catch (error) {
      if (error.code === '23505') { // Unique violation
        throw new Error('Email already exists');
      }
      throw error;
    }
  }

  /**
   * Authenticate user with email/password
   */
  async authenticate(email, password, ipAddress = null, userAgent = null) {
    try {
      // Get user with tenant info
      const query = `
        SELECT u.*, t.name as tenant_name
        FROM traversion.users u
        JOIN traversion.tenants t ON t.id = u.tenant_id
        WHERE u.email = $1 AND u.active = true AND t.active = true
      `;
      
      const result = await this.storage.pool.query(query, [email.toLowerCase()]);
      const user = result.rows[0];
      
      if (!user) {
        await this.logAudit(null, null, 'login_failed', 'user', ipAddress, userAgent, false, {
          email,
          reason: 'user_not_found'
        });
        throw new Error('Invalid credentials');
      }
      
      // Verify password
      const validPassword = await bcrypt.compare(password, user.password_hash);
      if (!validPassword) {
        await this.logAudit(user.id, user.tenant_id, 'login_failed', 'user', ipAddress, userAgent, false, {
          reason: 'invalid_password'
        });
        throw new Error('Invalid credentials');
      }
      
      // Generate JWT token
      const token = this.generateToken(user);
      
      // Store session
      await this.createSession(user.id, token, ipAddress, userAgent);
      
      // Update last login
      await this.storage.pool.query(
        'UPDATE traversion.users SET last_login = NOW() WHERE id = $1',
        [user.id]
      );
      
      // Log successful login
      await this.logAudit(user.id, user.tenant_id, 'login_success', 'user', ipAddress, userAgent, true);
      
      // Clean user object
      const { password_hash, ...userWithoutPassword } = user;
      
      this.emit('user:authenticated', { user: userWithoutPassword, token });
      
      return {
        user: userWithoutPassword,
        token,
        permissions: this.getUserPermissions(user)
      };
    } catch (error) {
      logger.error('Authentication failed:', error);
      throw error;
    }
  }

  /**
   * Verify JWT token
   */
  async verifyToken(token) {
    try {
      const decoded = jwt.verify(token, this.jwtSecret);
      
      // Check if session is still active
      const session = await this.storage.pool.query(
        'SELECT s.*, u.active as user_active, t.active as tenant_active FROM traversion.auth_sessions s JOIN traversion.users u ON u.id = s.user_id JOIN traversion.tenants t ON t.id = u.tenant_id WHERE s.token_hash = $1 AND s.active = true AND s.expires_at > NOW()',
        [this.hashToken(token)]
      );
      
      if (session.rows.length === 0) {
        throw new Error('Invalid or expired session');
      }
      
      const sessionData = session.rows[0];
      if (!sessionData.user_active || !sessionData.tenant_active) {
        throw new Error('User or tenant deactivated');
      }
      
      // Get user details
      const user = await this.getUserById(decoded.userId);
      if (!user) {
        throw new Error('User not found');
      }
      
      return {
        user,
        permissions: this.getUserPermissions(user),
        sessionId: sessionData.id
      };
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new Error('Token expired');
      }
      throw error;
    }
  }

  /**
   * Verify API key
   */
  async verifyApiKey(apiKey) {
    try {
      const keyHash = this.hashApiKey(apiKey);
      
      const query = `
        SELECT ak.*, u.email, u.tenant_id, u.role, t.name as tenant_name
        FROM traversion.api_keys ak
        JOIN traversion.users u ON u.id = ak.user_id
        JOIN traversion.tenants t ON t.id = ak.tenant_id
        WHERE ak.key_hash = $1 
        AND ak.active = true 
        AND u.active = true 
        AND t.active = true
        AND (ak.expires_at IS NULL OR ak.expires_at > NOW())
      `;
      
      const result = await this.storage.pool.query(query, [keyHash]);
      const apiKeyData = result.rows[0];
      
      if (!apiKeyData) {
        throw new Error('Invalid or expired API key');
      }
      
      // Update last used
      await this.storage.pool.query(
        'UPDATE traversion.api_keys SET last_used = NOW() WHERE id = $1',
        [apiKeyData.id]
      );
      
      return {
        apiKey: apiKeyData,
        permissions: apiKeyData.permissions,
        user: {
          id: apiKeyData.user_id,
          email: apiKeyData.email,
          tenant_id: apiKeyData.tenant_id,
          role: apiKeyData.role
        }
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Create API key
   */
  async createApiKey(userId, name, permissions = [], expiresAt = null) {
    // Generate API key
    const apiKey = `trav_${crypto.randomBytes(32).toString('hex')}`;
    const keyHash = this.hashApiKey(apiKey);
    const keyPrefix = apiKey.substring(0, 12);
    
    // Get user to determine tenant
    const user = await this.getUserById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    
    const query = `
      INSERT INTO traversion.api_keys (
        key_hash, key_prefix, name, user_id, tenant_id, permissions, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, key_prefix, name, permissions, expires_at, created_at
    `;
    
    try {
      const result = await this.storage.pool.query(query, [
        keyHash,
        keyPrefix,
        name,
        userId,
        user.tenant_id,
        permissions,
        expiresAt
      ]);
      
      const keyData = result.rows[0];
      this.emit('api_key:created', { keyData, userId });
      
      return {
        ...keyData,
        apiKey // Only returned once during creation
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get user permissions
   */
  getUserPermissions(user) {
    const rolePermissions = this.roles[user.role]?.permissions || [];
    const customPermissions = user.permissions || [];
    
    return [...new Set([...rolePermissions, ...customPermissions])];
  }

  /**
   * Check if user has permission
   */
  hasPermission(userPermissions, requiredPermission) {
    return userPermissions.includes(requiredPermission) || 
           userPermissions.includes('system:admin');
  }

  /**
   * Middleware for Express authentication
   */
  authMiddleware() {
    return async (req, res, next) => {
      try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader) {
          return res.status(401).json({ error: 'Authorization header required' });
        }
        
        let authData;
        
        if (authHeader.startsWith('Bearer ')) {
          // JWT token
          const token = authHeader.substring(7);
          authData = await this.verifyToken(token);
        } else if (authHeader.startsWith('ApiKey ')) {
          // API key
          const apiKey = authHeader.substring(7);
          authData = await this.verifyApiKey(apiKey);
        } else {
          return res.status(401).json({ error: 'Invalid authorization format' });
        }
        
        // Add auth data to request
        req.user = authData.user;
        req.permissions = authData.permissions;
        req.sessionId = authData.sessionId;
        
        next();
      } catch (error) {
        logger.error('Auth middleware error:', error);
        return res.status(401).json({ error: error.message });
      }
    };
  }

  /**
   * Middleware for permission checking
   */
  requirePermission(permission) {
    return (req, res, next) => {
      if (!req.permissions) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      
      if (!this.hasPermission(req.permissions, permission)) {
        return res.status(403).json({ 
          error: 'Insufficient permissions',
          required: permission
        });
      }
      
      next();
    };
  }

  /**
   * Middleware for tenant isolation
   */
  tenantMiddleware() {
    return (req, res, next) => {
      if (!req.user?.tenant_id) {
        return res.status(400).json({ error: 'Invalid tenant context' });
      }
      
      // Add tenant filter to all queries
      req.tenantId = req.user.tenant_id;
      
      next();
    };
  }

  /**
   * Helper methods
   */
  
  generateToken(user) {
    const payload = {
      userId: user.id,
      email: user.email,
      tenantId: user.tenant_id,
      role: user.role
    };
    
    return jwt.sign(payload, this.jwtSecret, { 
      expiresIn: this.jwtExpiry,
      issuer: 'traversion',
      audience: 'traversion-api'
    });
  }
  
  hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
  
  hashApiKey(apiKey) {
    return crypto.createHash('sha256').update(apiKey).digest('hex');
  }
  
  async getUserById(userId) {
    const result = await this.storage.pool.query(
      'SELECT * FROM traversion.users WHERE id = $1 AND active = true',
      [userId]
    );
    return result.rows[0];
  }
  
  async createSession(userId, token, ipAddress, userAgent) {
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    
    await this.storage.pool.query(`
      INSERT INTO traversion.auth_sessions (user_id, token_hash, ip_address, user_agent, expires_at)
      VALUES ($1, $2, $3, $4, $5)
    `, [userId, tokenHash, ipAddress, userAgent, expiresAt]);
  }
  
  async logAudit(userId, tenantId, action, resource, ipAddress, userAgent, success, details = {}) {
    await this.storage.pool.query(`
      INSERT INTO traversion.auth_audit (user_id, tenant_id, action, resource, ip_address, user_agent, success, details)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [userId, tenantId, action, resource, ipAddress, userAgent, success, details]);
  }
  
  /**
   * Logout user
   */
  async logout(token) {
    const tokenHash = this.hashToken(token);
    
    await this.storage.pool.query(
      'UPDATE traversion.auth_sessions SET active = false WHERE token_hash = $1',
      [tokenHash]
    );
    
    this.emit('user:logout', { tokenHash });
  }
  
  /**
   * Get user statistics
   */
  async getUserStats(tenantId = null) {
    let query = `
      SELECT 
        COUNT(*) as total_users,
        COUNT(*) FILTER (WHERE active = true) as active_users,
        COUNT(*) FILTER (WHERE last_login > NOW() - INTERVAL '24 hours') as daily_active,
        COUNT(*) FILTER (WHERE last_login > NOW() - INTERVAL '7 days') as weekly_active
      FROM traversion.users
    `;
    
    const params = [];
    if (tenantId) {
      query += ' WHERE tenant_id = $1';
      params.push(tenantId);
    }
    
    const result = await this.storage.pool.query(query, params);
    return result.rows[0];
  }
}

export default AuthService;