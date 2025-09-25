import rateLimit from 'express-rate-limit';
import Database from 'better-sqlite3';

/**
 * Rate Limiting Middleware
 *
 * Provides various rate limiting strategies for different endpoints
 */
class RateLimiter {
  constructor() {
    this.db = new Database('./.traversion/database.db');
    this.initializeRateLimitTables();
  }

  initializeRateLimitTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rate_limit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip_address TEXT,
        endpoint TEXT,
        user_id TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        blocked BOOLEAN DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_rate_limit_ip_endpoint
        ON rate_limit_logs(ip_address, endpoint, timestamp);
    `);
  }

  /**
   * General API rate limiter
   */
  general() {
    return rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // Limit each IP to 100 requests per windowMs
      message: {
        error: 'Too many requests from this IP, please try again later.',
        retryAfter: '15 minutes'
      },
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res) => {
        // Log blocked request
        this.logRequest(req, true);
        res.status(429).json({
          error: 'Too many requests from this IP, please try again later.',
          retryAfter: '15 minutes'
        });
      },
      onLimitReached: (req) => {
        console.warn(`Rate limit reached for IP: ${req.ip} on ${req.path}`);
      }
    });
  }

  /**
   * Strict rate limiter for authentication endpoints
   */
  auth() {
    return rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 5, // Limit to 5 auth attempts per 15 minutes
      message: {
        error: 'Too many authentication attempts, please try again later.',
        retryAfter: '15 minutes'
      },
      standardHeaders: true,
      legacyHeaders: false,
      skipSuccessfulRequests: true, // Don't count successful requests
      handler: (req, res) => {
        this.logRequest(req, true);
        res.status(429).json({
          error: 'Too many authentication attempts, please try again later.',
          retryAfter: '15 minutes'
        });
      }
    });
  }

  /**
   * Moderate rate limiter for incident analysis (CPU intensive)
   */
  analysis() {
    return rateLimit({
      windowMs: 10 * 60 * 1000, // 10 minutes
      max: 20, // 20 analysis requests per 10 minutes
      message: {
        error: 'Too many analysis requests, please try again later.',
        retryAfter: '10 minutes'
      },
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res) => {
        this.logRequest(req, true);
        res.status(429).json({
          error: 'Analysis rate limit exceeded. Please try again later.',
          retryAfter: '10 minutes'
        });
      }
    });
  }

  /**
   * Lenient rate limiter for timeline/read operations
   */
  read() {
    return rateLimit({
      windowMs: 5 * 60 * 1000, // 5 minutes
      max: 60, // 60 requests per 5 minutes
      message: {
        error: 'Too many requests, please slow down.',
        retryAfter: '5 minutes'
      },
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res) => {
        this.logRequest(req, true);
        res.status(429).json({
          error: 'Read rate limit exceeded. Please slow down.',
          retryAfter: '5 minutes'
        });
      }
    });
  }

  /**
   * Custom rate limiter with user-based limits
   */
  userBased(options = {}) {
    const {
      windowMs = 15 * 60 * 1000,
      maxAnonymous = 10,
      maxAuthenticated = 100,
      maxAdmin = 1000
    } = options;

    return rateLimit({
      windowMs,
      max: (req) => {
        if (!req.user) return maxAnonymous;
        if (req.user.role === 'admin') return maxAdmin;
        return maxAuthenticated;
      },
      message: (req) => ({
        error: 'Rate limit exceeded for your user level.',
        retryAfter: `${Math.ceil(windowMs / 60000)} minutes`,
        userType: req.user ? req.user.role : 'anonymous'
      }),
      keyGenerator: (req) => {
        // Use user ID if authenticated, otherwise IP
        return req.user ? `user_${req.user.id}` : `ip_${req.ip}`;
      },
      handler: (req, res, next, options) => {
        this.logRequest(req, true);
        res.status(429).json(options.message(req));
      }
    });
  }

  /**
   * Burst protection for high-frequency endpoints
   */
  burst() {
    return rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 10, // 10 requests per minute max
      message: {
        error: 'Too many requests in a short time. Please slow down.',
        retryAfter: '1 minute'
      },
      standardHeaders: true,
      legacyHeaders: false
    });
  }

  /**
   * Progressive rate limiter - increases limits over time for good actors
   */
  progressive() {
    return rateLimit({
      windowMs: 15 * 60 * 1000,
      max: (req) => {
        // Check user's history
        const history = this.getUserHistory(req);

        // Base limit
        let limit = 50;

        // Increase limits for users with good history
        if (history.requestCount > 1000 && history.blockedRate < 0.01) {
          limit = 200; // Trusted user
        } else if (history.requestCount > 100 && history.blockedRate < 0.05) {
          limit = 100; // Regular user
        }

        return limit;
      },
      keyGenerator: (req) => req.user ? `user_${req.user.id}` : `ip_${req.ip}`,
      handler: (req, res) => {
        this.logRequest(req, true);
        res.status(429).json({
          error: 'Rate limit exceeded. Build trust by making valid requests.',
          retryAfter: '15 minutes'
        });
      }
    });
  }

  /**
   * Log request for monitoring
   */
  logRequest(req, blocked = false) {
    try {
      this.db.prepare(`
        INSERT INTO rate_limit_logs (ip_address, endpoint, user_id, blocked)
        VALUES (?, ?, ?, ?)
      `).run(
        req.ip,
        req.path,
        req.user?.id || null,
        blocked ? 1 : 0
      );
    } catch (error) {
      console.error('Error logging rate limit:', error);
    }
  }

  /**
   * Get user's request history for progressive limiting
   */
  getUserHistory(req) {
    try {
      const identifier = req.user ? req.user.id : req.ip;
      const column = req.user ? 'user_id' : 'ip_address';

      const stats = this.db.prepare(`
        SELECT
          COUNT(*) as requestCount,
          SUM(CASE WHEN blocked = 1 THEN 1 ELSE 0 END) as blockedCount,
          (SUM(CASE WHEN blocked = 1 THEN 1 ELSE 0 END) * 1.0 / COUNT(*)) as blockedRate
        FROM rate_limit_logs
        WHERE ${column} = ?
          AND timestamp > datetime('now', '-7 days')
      `).get(identifier);

      return {
        requestCount: stats.requestCount || 0,
        blockedCount: stats.blockedCount || 0,
        blockedRate: stats.blockedRate || 0
      };
    } catch (error) {
      console.error('Error getting user history:', error);
      return { requestCount: 0, blockedCount: 0, blockedRate: 0 };
    }
  }

  /**
   * Get rate limit statistics
   */
  getStats(timeframe = '24 hours') {
    try {
      const stats = this.db.prepare(`
        SELECT
          COUNT(*) as totalRequests,
          SUM(CASE WHEN blocked = 1 THEN 1 ELSE 0 END) as blockedRequests,
          COUNT(DISTINCT ip_address) as uniqueIPs,
          COUNT(DISTINCT user_id) as uniqueUsers,
          endpoint,
          COUNT(*) as endpointCount
        FROM rate_limit_logs
        WHERE timestamp > datetime('now', '-${timeframe}')
        GROUP BY endpoint
        ORDER BY endpointCount DESC
      `).all();

      const summary = this.db.prepare(`
        SELECT
          COUNT(*) as totalRequests,
          SUM(CASE WHEN blocked = 1 THEN 1 ELSE 0 END) as blockedRequests,
          COUNT(DISTINCT ip_address) as uniqueIPs,
          COUNT(DISTINCT user_id) as uniqueUsers
        FROM rate_limit_logs
        WHERE timestamp > datetime('now', '-${timeframe}')
      `).get();

      return {
        summary,
        endpoints: stats
      };
    } catch (error) {
      console.error('Error getting rate limit stats:', error);
      return { summary: {}, endpoints: [] };
    }
  }

  /**
   * Clean up old rate limit logs
   */
  cleanup() {
    try {
      const result = this.db.prepare(`
        DELETE FROM rate_limit_logs
        WHERE timestamp < datetime('now', '-30 days')
      `).run();

      console.log(`Cleaned up ${result.changes} old rate limit logs`);
      return result.changes;
    } catch (error) {
      console.error('Error cleaning up rate limit logs:', error);
      return 0;
    }
  }
}

// Create singleton
const rateLimiter = new RateLimiter();

// Schedule cleanup every 24 hours
setInterval(() => {
  rateLimiter.cleanup();
}, 24 * 60 * 60 * 1000);

export default rateLimiter;
export { RateLimiter };