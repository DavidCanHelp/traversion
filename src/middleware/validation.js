import Joi from 'joi';
import { body, param, query, validationResult } from 'express-validator';
import validator from 'validator';

/**
 * Input Validation Middleware
 *
 * Provides comprehensive validation for API inputs using Joi and express-validator
 */
class ValidationMiddleware {
  constructor() {
    // Common validation patterns
    this.patterns = {
      username: /^[a-zA-Z0-9_-]{3,30}$/,
      password: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{8,}$/,
      commitHash: /^[a-f0-9]{7,40}$/i,
      incidentId: /^inc_\d+$/,
      apiKey: /^trav_[a-zA-Z0-9]{32,}$/
    };

    // Common Joi schemas
    this.schemas = {
      user: Joi.object({
        username: Joi.string()
          .pattern(this.patterns.username)
          .required()
          .messages({
            'string.pattern.base': 'Username must be 3-30 characters, letters, numbers, underscore, hyphen only'
          }),
        email: Joi.string()
          .email()
          .required()
          .messages({
            'string.email': 'Please provide a valid email address'
          }),
        password: Joi.string()
          .pattern(this.patterns.password)
          .required()
          .messages({
            'string.pattern.base': 'Password must be at least 8 characters with uppercase, lowercase, and number'
          })
      }),

      login: Joi.object({
        username: Joi.string()
          .required()
          .messages({
            'any.required': 'Username or email is required'
          }),
        password: Joi.string()
          .min(1)
          .required()
          .messages({
            'any.required': 'Password is required'
          })
      }),

      incident: Joi.object({
        time: Joi.string()
          .isoDate()
          .optional()
          .messages({
            'string.isoDate': 'Time must be a valid ISO 8601 date'
          }),
        hours: Joi.number()
          .integer()
          .min(1)
          .max(720) // Max 30 days
          .optional()
          .default(24)
          .messages({
            'number.min': 'Hours must be at least 1',
            'number.max': 'Hours cannot exceed 720 (30 days)'
          }),
        files: Joi.array()
          .items(Joi.string().max(500))
          .max(50)
          .optional()
          .messages({
            'array.max': 'Cannot specify more than 50 files'
          })
      }),

      apiKey: Joi.object({
        name: Joi.string()
          .max(100)
          .optional()
          .default('Default')
          .messages({
            'string.max': 'API key name cannot exceed 100 characters'
          })
      }),

      pagination: Joi.object({
        page: Joi.number()
          .integer()
          .min(1)
          .optional()
          .default(1),
        limit: Joi.number()
          .integer()
          .min(1)
          .max(100)
          .optional()
          .default(20),
        sortBy: Joi.string()
          .valid('created_at', 'updated_at', 'name', 'date')
          .optional()
          .default('created_at'),
        sortOrder: Joi.string()
          .valid('asc', 'desc')
          .optional()
          .default('desc')
      })
    };
  }

  /**
   * Generic Joi validation middleware
   */
  validateBody(schema) {
    return async (req, res, next) => {
      try {
        const validated = await schema.validateAsync(req.body, {
          abortEarly: false,
          stripUnknown: true,
          convert: true
        });

        req.body = validated;
        next();
      } catch (error) {
        const errors = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          value: detail.context?.value
        }));

        res.status(400).json({
          error: 'Validation failed',
          details: errors
        });
      }
    };
  }

  /**
   * Generic query validation
   */
  validateQuery(schema) {
    return async (req, res, next) => {
      try {
        const validated = await schema.validateAsync(req.query, {
          abortEarly: false,
          stripUnknown: true,
          convert: true
        });

        req.query = validated;
        next();
      } catch (error) {
        const errors = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          value: detail.context?.value
        }));

        res.status(400).json({
          error: 'Query validation failed',
          details: errors
        });
      }
    };
  }

  /**
   * Express-validator based validation
   */
  handleValidationErrors() {
    return (req, res, next) => {
      const errors = validationResult(req);

      if (!errors.isEmpty()) {
        const formattedErrors = errors.array().map(error => ({
          field: error.param,
          message: error.msg,
          value: error.value
        }));

        return res.status(400).json({
          error: 'Validation failed',
          details: formattedErrors
        });
      }

      next();
    };
  }

  /**
   * Sanitize and validate HTML input
   */
  sanitizeHtml() {
    return (req, res, next) => {
      const sanitizeObject = (obj) => {
        for (const key in obj) {
          if (typeof obj[key] === 'string') {
            // Remove HTML tags, escape special characters
            obj[key] = validator.escape(validator.stripLow(obj[key]));
          } else if (typeof obj[key] === 'object' && obj[key] !== null) {
            sanitizeObject(obj[key]);
          }
        }
      };

      if (req.body) sanitizeObject(req.body);
      if (req.query) sanitizeObject(req.query);

      next();
    };
  }

  /**
   * Validate file upload
   */
  validateFileUpload(options = {}) {
    const {
      maxSize = 10 * 1024 * 1024, // 10MB
      allowedTypes = ['image/jpeg', 'image/png', 'text/plain', 'application/json'],
      required = false
    } = options;

    return (req, res, next) => {
      if (!req.files || req.files.length === 0) {
        if (required) {
          return res.status(400).json({ error: 'File upload is required' });
        }
        return next();
      }

      const errors = [];

      req.files.forEach((file, index) => {
        // Check file size
        if (file.size > maxSize) {
          errors.push({
            field: `file[${index}]`,
            message: `File size exceeds ${maxSize / 1024 / 1024}MB limit`
          });
        }

        // Check file type
        if (!allowedTypes.includes(file.mimetype)) {
          errors.push({
            field: `file[${index}]`,
            message: `File type ${file.mimetype} is not allowed`
          });
        }

        // Check filename
        if (!/^[a-zA-Z0-9._-]+$/.test(file.originalname)) {
          errors.push({
            field: `file[${index}]`,
            message: 'Filename contains invalid characters'
          });
        }
      });

      if (errors.length > 0) {
        return res.status(400).json({
          error: 'File validation failed',
          details: errors
        });
      }

      next();
    };
  }

  /**
   * Pre-defined validation chains
   */
  get authValidation() {
    return {
      register: [
        this.validateBody(this.schemas.user),
        this.sanitizeHtml()
      ],

      login: [
        this.validateBody(this.schemas.login),
        this.sanitizeHtml()
      ],

      apiKey: [
        this.validateBody(this.schemas.apiKey),
        this.sanitizeHtml()
      ]
    };
  }

  get apiValidation() {
    return {
      incident: [
        this.validateBody(this.schemas.incident),
        this.sanitizeHtml()
      ],

      pagination: [
        this.validateQuery(this.schemas.pagination)
      ],

      commitHash: [
        param('hash')
          .matches(this.patterns.commitHash)
          .withMessage('Invalid commit hash format'),
        this.handleValidationErrors()
      ],

      incidentId: [
        param('id')
          .matches(this.patterns.incidentId)
          .withMessage('Invalid incident ID format'),
        this.handleValidationErrors()
      ]
    };
  }

  /**
   * Custom validation for specific business rules
   */
  validateIncidentTimeRange() {
    return (req, res, next) => {
      const { time, hours } = req.body;

      if (time) {
        const incidentTime = new Date(time);
        const now = new Date();
        const maxPastTime = new Date(now.getTime() - (365 * 24 * 60 * 60 * 1000)); // 1 year ago

        if (incidentTime > now) {
          return res.status(400).json({
            error: 'Incident time cannot be in the future'
          });
        }

        if (incidentTime < maxPastTime) {
          return res.status(400).json({
            error: 'Incident time cannot be more than 1 year ago'
          });
        }
      }

      if (hours && hours > 168) { // 1 week
        return res.status(400).json({
          error: 'Analysis window cannot exceed 168 hours (1 week)'
        });
      }

      next();
    };
  }

  /**
   * Validate user permissions for resource access
   */
  validateResourceAccess() {
    return (req, res, next) => {
      // Check if user is trying to access their own resources
      // or has admin privileges
      if (req.params.userId && req.params.userId !== req.user?.id) {
        if (req.user?.role !== 'admin') {
          return res.status(403).json({
            error: 'Access denied: Cannot access other users resources'
          });
        }
      }

      next();
    };
  }

  /**
   * Validate API key format
   */
  validateApiKeyFormat() {
    return (req, res, next) => {
      const apiKey = req.headers['x-api-key'] || req.query.api_key;

      if (apiKey && !this.patterns.apiKey.test(apiKey)) {
        return res.status(400).json({
          error: 'Invalid API key format'
        });
      }

      next();
    };
  }

  /**
   * Validate JSON payload size and structure
   */
  validateJsonPayload(maxDepth = 10, maxSize = 1024 * 1024) {
    return (req, res, next) => {
      // Check payload size
      const contentLength = req.headers['content-length'];
      if (contentLength && parseInt(contentLength) > maxSize) {
        return res.status(413).json({
          error: `Payload too large. Maximum size: ${maxSize / 1024}KB`
        });
      }

      // Check JSON depth
      const checkDepth = (obj, depth = 0) => {
        if (depth > maxDepth) return false;
        if (typeof obj !== 'object' || obj === null) return true;

        return Object.values(obj).every(value =>
          checkDepth(value, depth + 1)
        );
      };

      if (req.body && typeof req.body === 'object') {
        if (!checkDepth(req.body)) {
          return res.status(400).json({
            error: `JSON nesting too deep. Maximum depth: ${maxDepth}`
          });
        }
      }

      next();
    };
  }

  /**
   * Rate limiting based on input complexity
   */
  validateInputComplexity() {
    return (req, res, next) => {
      let complexity = 0;

      const calculateComplexity = (obj) => {
        if (typeof obj === 'string') return obj.length / 100;
        if (typeof obj === 'number') return 1;
        if (Array.isArray(obj)) return obj.reduce((sum, item) => sum + calculateComplexity(item), 0);
        if (typeof obj === 'object' && obj !== null) {
          return Object.values(obj).reduce((sum, value) => sum + calculateComplexity(value), 0);
        }
        return 0;
      };

      if (req.body) complexity += calculateComplexity(req.body);
      if (req.query) complexity += calculateComplexity(req.query);

      if (complexity > 1000) {
        return res.status(400).json({
          error: 'Input too complex. Please simplify your request.'
        });
      }

      // Store complexity for monitoring
      req.inputComplexity = complexity;
      next();
    };
  }

  /**
   * Custom validation for security headers
   */
  validateSecurityHeaders() {
    return (req, res, next) => {
      const suspicious = [];

      // Check for suspicious user agents
      const userAgent = req.headers['user-agent'];
      if (!userAgent || userAgent.length < 10 || /bot|crawler|spider/i.test(userAgent)) {
        suspicious.push('suspicious_user_agent');
      }

      // Check for missing common headers
      if (!req.headers['accept']) {
        suspicious.push('missing_accept_header');
      }

      // Check for suspicious referrers
      const referer = req.headers['referer'];
      if (referer && !validator.isURL(referer)) {
        suspicious.push('invalid_referer');
      }

      req.securityFlags = suspicious;
      next();
    };
  }
}

// Create singleton
const validation = new ValidationMiddleware();

export default validation;
export { ValidationMiddleware };