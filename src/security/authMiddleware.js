import jwt from 'jsonwebtoken';
import { InputSanitizer } from './inputSanitizer.js';
import logger from '../utils/logger.js';

/**
 * Secure Authentication and Authorization Middleware
 * Prevents unauthorized access and ensures proper tenant isolation
 */

export class AuthMiddleware {
  constructor(options = {}) {
    this.jwtSecret = options.jwtSecret || process.env.JWT_SECRET;
    this.sessionTimeout = options.sessionTimeout || 3600000; // 1 hour
    this.rateLimitStore = new Map();
    
    if (!this.jwtSecret) {
      throw new Error('JWT_SECRET is required for authentication');
    }
  }

  /**
   * Verify JWT token and extract user information
   */
  verifyToken(req, res, next) {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ 
          error: 'Authentication required',
          code: 'MISSING_TOKEN'
        });
      }

      const token = authHeader.substring(7); // Remove 'Bearer ' prefix
      
      try {
        const decoded = jwt.verify(token, this.jwtSecret);
        
        // Validate token structure
        if (!decoded.userId || !decoded.tenantId || !decoded.role) {
          throw new Error('Invalid token structure');
        }

        // Sanitize user data
        req.user = {
          userId: InputSanitizer.sanitizeTenantId(decoded.userId),
          tenantId: InputSanitizer.sanitizeTenantId(decoded.tenantId),
          role: InputSanitizer.sanitizeSQLIdentifier(decoded.role),
          permissions: decoded.permissions || [],
          iat: decoded.iat,
          exp: decoded.exp
        };

        // Check token expiration
        const now = Math.floor(Date.now() / 1000);
        if (decoded.exp && decoded.exp < now) {
          return res.status(401).json({
            error: 'Token expired',
            code: 'TOKEN_EXPIRED'
          });
        }

        logger.info('User authenticated', { 
          userId: req.user.userId, 
          tenantId: req.user.tenantId,
          role: req.user.role 
        });

        next();
      } catch (error) {
        logger.warn('Invalid token provided', { error: error.message });
        return res.status(401).json({
          error: 'Invalid token',
          code: 'INVALID_TOKEN'
        });
      }
    } catch (error) {
      logger.error('Authentication middleware error', { error: error.message });
      return res.status(500).json({
        error: 'Authentication error',
        code: 'AUTH_ERROR'
      });
    }
  }

  /**
   * Check if user has required permission
   */
  requirePermission(permission) {
    return (req, res, next) => {
      try {
        if (!req.user) {
          return res.status(401).json({
            error: 'Authentication required',
            code: 'NOT_AUTHENTICATED'
          });
        }

        const hasPermission = req.user.permissions.includes(permission) || 
                            req.user.permissions.includes('admin:all');

        if (!hasPermission) {
          logger.warn('Permission denied', { 
            userId: req.user.userId,
            requiredPermission: permission,
            userPermissions: req.user.permissions
          });

          return res.status(403).json({
            error: 'Insufficient permissions',
            code: 'PERMISSION_DENIED',
            required: permission
          });
        }

        next();
      } catch (error) {
        logger.error('Permission check error', { error: error.message });
        return res.status(500).json({
          error: 'Permission check failed',
          code: 'PERMISSION_ERROR'
        });
      }
    };
  }

  /**
   * Ensure tenant isolation - user can only access their tenant's data
   */
  enforceTenantIsolation(req, res, next) {
    try {
      if (!req.user || !req.user.tenantId) {
        return res.status(401).json({
          error: 'Authentication required',
          code: 'NOT_AUTHENTICATED'
        });
      }

      // Extract tenant ID from request (URL params, query, or body)
      let requestedTenantId = null;

      if (req.params.tenantId) {
        requestedTenantId = req.params.tenantId;
      } else if (req.query.tenantId) {
        requestedTenantId = req.query.tenantId;
      } else if (req.body && req.body.tenantId) {
        requestedTenantId = req.body.tenantId;
      }

      // If no tenant ID in request, use user's tenant ID
      if (!requestedTenantId) {
        req.tenantId = req.user.tenantId;
        next();
        return;
      }

      // Sanitize requested tenant ID
      try {
        requestedTenantId = InputSanitizer.sanitizeTenantId(requestedTenantId);
      } catch (error) {
        return res.status(400).json({
          error: 'Invalid tenant ID format',
          code: 'INVALID_TENANT_ID'
        });
      }

      // Check if user can access requested tenant
      const isSystemAdmin = req.user.permissions.includes('system:admin');
      const canAccessTenant = req.user.tenantId === requestedTenantId || isSystemAdmin;

      if (!canAccessTenant) {
        logger.warn('Tenant isolation violation attempt', {
          userId: req.user.userId,
          userTenantId: req.user.tenantId,
          requestedTenantId
        });

        return res.status(403).json({
          error: 'Access denied to tenant data',
          code: 'TENANT_ACCESS_DENIED'
        });
      }

      req.tenantId = requestedTenantId;
      next();
    } catch (error) {
      logger.error('Tenant isolation error', { error: error.message });
      return res.status(500).json({
        error: 'Tenant isolation check failed',
        code: 'TENANT_ERROR'
      });
    }
  }

  /**
   * Rate limiting middleware
   */
  rateLimit(options = {}) {
    const windowMs = options.windowMs || 900000; // 15 minutes
    const maxRequests = options.max || 1000;
    const keyGenerator = options.keyGenerator || ((req) => {
      const ip = req.ip || req.connection.remoteAddress;
      const userId = req.user?.userId || 'anonymous';
      return `${ip}:${userId}`;
    });

    return (req, res, next) => {
      try {
        const key = InputSanitizer.sanitizeRateLimitKey(keyGenerator(req));
        const now = Date.now();
        const windowStart = now - windowMs;

        // Get or create rate limit data for this key
        if (!this.rateLimitStore.has(key)) {
          this.rateLimitStore.set(key, []);
        }

        const requests = this.rateLimitStore.get(key);
        
        // Remove requests outside the current window
        const validRequests = requests.filter(timestamp => timestamp > windowStart);
        this.rateLimitStore.set(key, validRequests);

        // Check if limit exceeded
        if (validRequests.length >= maxRequests) {
          const resetTime = new Date(Math.min(...validRequests) + windowMs);
          
          logger.warn('Rate limit exceeded', { 
            key, 
            requestCount: validRequests.length, 
            limit: maxRequests 
          });

          return res.status(429).json({
            error: 'Rate limit exceeded',
            code: 'RATE_LIMIT_EXCEEDED',
            limit: maxRequests,
            window: windowMs,
            resetTime: resetTime.toISOString()
          });
        }

        // Add current request
        validRequests.push(now);
        this.rateLimitStore.set(key, validRequests);

        // Add rate limit headers
        res.set({
          'X-RateLimit-Limit': maxRequests,
          'X-RateLimit-Remaining': Math.max(0, maxRequests - validRequests.length),
          'X-RateLimit-Reset': new Date(now + windowMs).toISOString()
        });

        next();
      } catch (error) {
        logger.error('Rate limiting error', { error: error.message });
        // Don't block request on rate limiting errors
        next();
      }
    };
  }

  /**
   * Request sanitization middleware
   */
  sanitizeRequest(req, res, next) {
    try {
      // Sanitize common parameters
      if (req.params.id && req.params.id.match(/^[0-9a-f-]+$/i)) {
        req.params.id = InputSanitizer.sanitizeTenantId(req.params.id);
      }

      if (req.query.limit) {
        req.query.limit = InputSanitizer.sanitizeInteger(req.query.limit, 1, 1000);
      }

      if (req.query.offset) {
        req.query.offset = InputSanitizer.sanitizeInteger(req.query.offset, 0);
      }

      if (req.body && typeof req.body === 'object') {
        // Sanitize common body fields
        if (req.body.filePath) {
          req.body.filePath = InputSanitizer.sanitizeFilePath(req.body.filePath);
        }

        if (req.body.commitHash) {
          req.body.commitHash = InputSanitizer.sanitizeCommitHash(req.body.commitHash);
        }

        if (req.body.tenantId) {
          req.body.tenantId = InputSanitizer.sanitizeTenantId(req.body.tenantId);
        }
      }

      next();
    } catch (error) {
      logger.warn('Request sanitization failed', { error: error.message });
      return res.status(400).json({
        error: 'Invalid request parameters',
        code: 'INVALID_PARAMETERS',
        details: error.message
      });
    }
  }

  /**
   * Security headers middleware
   */
  securityHeaders(req, res, next) {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
      'Permissions-Policy': 'geolocation=(), microphone=(), camera=()'
    });
    next();
  }

  /**
   * Error sanitization middleware
   */
  sanitizeErrors(err, req, res, next) {
    // Don't expose internal errors in production
    const isProduction = process.env.NODE_ENV === 'production';
    
    logger.error('Request error', {
      error: err.message,
      stack: err.stack,
      userId: req.user?.userId,
      tenantId: req.user?.tenantId,
      path: req.path
    });

    const sanitizedError = {
      error: isProduction ? 'Internal server error' : err.message,
      code: err.code || 'INTERNAL_ERROR'
    };

    if (!isProduction && err.stack) {
      sanitizedError.stack = err.stack;
    }

    res.status(err.status || 500).json(sanitizedError);
  }

  /**
   * Cleanup rate limit store periodically
   */
  startCleanupTimer() {
    setInterval(() => {
      const now = Date.now();
      const oneHourAgo = now - 3600000;

      for (const [key, requests] of this.rateLimitStore.entries()) {
        const validRequests = requests.filter(timestamp => timestamp > oneHourAgo);
        
        if (validRequests.length === 0) {
          this.rateLimitStore.delete(key);
        } else {
          this.rateLimitStore.set(key, validRequests);
        }
      }
    }, 300000); // Cleanup every 5 minutes
  }
}