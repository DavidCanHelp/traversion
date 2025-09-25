import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import Database from 'better-sqlite3';

/**
 * Authentication Middleware
 *
 * Provides JWT-based authentication and authorization for API endpoints
 */
class AuthMiddleware {
  constructor(config = {}) {
    this.jwtSecret = config.jwtSecret || process.env.JWT_SECRET || 'development-secret-change-in-production';
    this.jwtExpiresIn = config.jwtExpiresIn || '24h';
    this.bcryptRounds = config.bcryptRounds || 10;

    // Initialize database
    this.db = new Database('./.traversion/database.db');
    this.initializeUserTable();
  }

  initializeUserTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME,
        is_active BOOLEAN DEFAULT 1,
        metadata TEXT
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        name TEXT,
        last_used DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        is_active BOOLEAN DEFAULT 1,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        is_active BOOLEAN DEFAULT 1,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
    `);
  }

  /**
   * Register a new user
   */
  async register(username, email, password, role = 'user') {
    try {
      // Check if user exists
      const existingUser = this.db.prepare(
        'SELECT id FROM users WHERE username = ? OR email = ?'
      ).get(username, email);

      if (existingUser) {
        throw new Error('User already exists');
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, this.bcryptRounds);

      // Create user
      const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      this.db.prepare(`
        INSERT INTO users (id, username, email, password_hash, role)
        VALUES (?, ?, ?, ?, ?)
      `).run(userId, username, email, passwordHash, role);

      return {
        id: userId,
        username,
        email,
        role
      };
    } catch (error) {
      console.error('Registration error:', error);
      throw error;
    }
  }

  /**
   * Login user and generate JWT
   */
  async login(username, password) {
    try {
      // Find user
      const user = this.db.prepare(`
        SELECT id, username, email, password_hash, role, is_active
        FROM users
        WHERE username = ? OR email = ?
      `).get(username, username);

      if (!user) {
        throw new Error('Invalid credentials');
      }

      if (!user.is_active) {
        throw new Error('Account is disabled');
      }

      // Verify password
      const isValid = await bcrypt.compare(password, user.password_hash);
      if (!isValid) {
        throw new Error('Invalid credentials');
      }

      // Update last login
      this.db.prepare(`
        UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?
      `).run(user.id);

      // Generate JWT
      const token = jwt.sign(
        {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role
        },
        this.jwtSecret,
        { expiresIn: this.jwtExpiresIn }
      );

      // Store session
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const tokenHash = await bcrypt.hash(token, 5); // Light hashing for sessions

      this.db.prepare(`
        INSERT INTO sessions (id, user_id, token_hash, expires_at)
        VALUES (?, ?, ?, datetime('now', '+1 day'))
      `).run(sessionId, user.id, tokenHash);

      return {
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role
        }
      };
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  }

  /**
   * Verify JWT token
   */
  verifyToken(token) {
    try {
      return jwt.verify(token, this.jwtSecret);
    } catch (error) {
      throw new Error('Invalid token');
    }
  }

  /**
   * Middleware to require authentication
   */
  requireAuth() {
    return (req, res, next) => {
      try {
        // Check for token in header
        const authHeader = req.headers.authorization;
        if (!authHeader) {
          return res.status(401).json({ error: 'No token provided' });
        }

        // Extract token
        const token = authHeader.startsWith('Bearer ')
          ? authHeader.slice(7)
          : authHeader;

        // Verify token
        const decoded = this.verifyToken(token);

        // Check if user still exists and is active
        const user = this.db.prepare(`
          SELECT id, username, role, is_active
          FROM users
          WHERE id = ?
        `).get(decoded.id);

        if (!user || !user.is_active) {
          return res.status(401).json({ error: 'User account not found or disabled' });
        }

        // Attach user to request
        req.user = {
          id: user.id,
          username: user.username,
          role: user.role
        };

        next();
      } catch (error) {
        return res.status(401).json({ error: error.message });
      }
    };
  }

  /**
   * Middleware to require specific role
   */
  requireRole(role) {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      if (req.user.role !== role && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      next();
    };
  }

  /**
   * Optional authentication - doesn't fail if no token
   */
  optionalAuth() {
    return (req, res, next) => {
      try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
          return next();
        }

        const token = authHeader.startsWith('Bearer ')
          ? authHeader.slice(7)
          : authHeader;

        const decoded = this.verifyToken(token);

        const user = this.db.prepare(`
          SELECT id, username, role, is_active
          FROM users
          WHERE id = ?
        `).get(decoded.id);

        if (user && user.is_active) {
          req.user = {
            id: user.id,
            username: user.username,
            role: user.role
          };
        }
      } catch (error) {
        // Ignore errors for optional auth
      }

      next();
    };
  }

  /**
   * Generate API key for user
   */
  async generateApiKey(userId, name = 'Default') {
    try {
      // Generate random API key
      const apiKey = `trav_${Math.random().toString(36).substr(2)}${Math.random().toString(36).substr(2)}`;

      // Hash it for storage
      const keyHash = await bcrypt.hash(apiKey, this.bcryptRounds);

      // Store in database
      const keyId = `apikey_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      this.db.prepare(`
        INSERT INTO api_keys (id, user_id, key_hash, name)
        VALUES (?, ?, ?, ?)
      `).run(keyId, userId, keyHash, name);

      return {
        id: keyId,
        apiKey, // Return the actual key only once
        name
      };
    } catch (error) {
      console.error('API key generation error:', error);
      throw error;
    }
  }

  /**
   * Verify API key
   */
  async verifyApiKey(apiKey) {
    try {
      // Get all active API keys
      const keys = this.db.prepare(`
        SELECT ak.id, ak.key_hash, ak.user_id, u.username, u.role
        FROM api_keys ak
        JOIN users u ON ak.user_id = u.id
        WHERE ak.is_active = 1 AND u.is_active = 1
      `).all();

      // Check each key
      for (const key of keys) {
        const isValid = await bcrypt.compare(apiKey, key.key_hash);
        if (isValid) {
          // Update last used
          this.db.prepare(`
            UPDATE api_keys SET last_used = CURRENT_TIMESTAMP WHERE id = ?
          `).run(key.id);

          return {
            id: key.user_id,
            username: key.username,
            role: key.role
          };
        }
      }

      return null;
    } catch (error) {
      console.error('API key verification error:', error);
      return null;
    }
  }

  /**
   * Middleware for API key authentication
   */
  requireApiKey() {
    return async (req, res, next) => {
      try {
        const apiKey = req.headers['x-api-key'] || req.query.api_key;

        if (!apiKey) {
          return res.status(401).json({ error: 'API key required' });
        }

        const user = await this.verifyApiKey(apiKey);

        if (!user) {
          return res.status(401).json({ error: 'Invalid API key' });
        }

        req.user = user;
        next();
      } catch (error) {
        return res.status(401).json({ error: error.message });
      }
    };
  }

  /**
   * Logout user (invalidate session)
   */
  async logout(token) {
    try {
      const tokenHash = await bcrypt.hash(token, 5);

      this.db.prepare(`
        UPDATE sessions
        SET is_active = 0
        WHERE token_hash = ?
      `).run(tokenHash);

      return { message: 'Logged out successfully' };
    } catch (error) {
      console.error('Logout error:', error);
      throw error;
    }
  }

  /**
   * Clean up expired sessions
   */
  cleanupSessions() {
    this.db.prepare(`
      UPDATE sessions
      SET is_active = 0
      WHERE expires_at < datetime('now')
    `).run();
  }
}

// Create singleton instance
const auth = new AuthMiddleware();

export default auth;
export { AuthMiddleware };