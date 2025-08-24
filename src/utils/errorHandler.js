/**
 * Centralized Error Handler
 * 
 * Provides consistent error handling across the application
 */

import { logger } from './logger.js';

export class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.timestamp = new Date().toISOString();
    
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message, field = null) {
    super(message, 400);
    this.field = field;
    this.type = 'ValidationError';
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed') {
    super(message, 401);
    this.type = 'AuthenticationError';
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403);
    this.type = 'AuthorizationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404);
    this.type = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message) {
    super(message, 409);
    this.type = 'ConflictError';
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429);
    this.type = 'RateLimitError';
  }
}

/**
 * Global error handler for Express
 */
export const errorHandler = (err, req, res, next) => {
  let error = err;
  
  // Convert non-AppError instances to AppError
  if (!(error instanceof AppError)) {
    const message = error.message || 'Internal server error';
    error = new AppError(message, 500, false);
  }
  
  // Log error
  logger.error({
    message: error.message,
    statusCode: error.statusCode,
    stack: error.stack,
    path: req.path,
    method: req.method,
    ip: req.ip,
    userId: req.user?.id
  });
  
  // Send error response
  res.status(error.statusCode).json({
    error: {
      message: error.isOperational ? error.message : 'Internal server error',
      type: error.type || 'Error',
      statusCode: error.statusCode,
      timestamp: error.timestamp,
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    }
  });
};

/**
 * Async error wrapper for route handlers
 */
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Process unhandled rejections and exceptions
 */
export const setupGlobalErrorHandlers = () => {
  process.on('unhandledRejection', (reason, promise) => {
    logger.error({
      message: 'Unhandled Rejection',
      reason: reason,
      promise: promise
    });
    
    // Optionally exit process in production
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  });
  
  process.on('uncaughtException', (error) => {
    logger.error({
      message: 'Uncaught Exception',
      error: error.message,
      stack: error.stack
    });
    
    // Exit process after logging
    process.exit(1);
  });
};

/**
 * Format validation errors from libraries like Joi
 */
export const formatValidationErrors = (errors) => {
  if (Array.isArray(errors)) {
    return errors.map(err => ({
      field: err.path?.join('.') || err.field,
      message: err.message
    }));
  }
  
  return Object.entries(errors).map(([field, message]) => ({
    field,
    message
  }));
};

/**
 * Retry mechanism for transient failures
 */
export const retryOperation = async (operation, maxRetries = 3, delay = 1000) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      
      logger.warn(`Operation failed, retrying (${i + 1}/${maxRetries})...`);
      await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
    }
  }
};

export default {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  errorHandler,
  asyncHandler,
  setupGlobalErrorHandlers,
  formatValidationErrors,
  retryOperation
};