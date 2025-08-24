/**
 * Error Handler Test Suite
 */

import { jest } from '@jest/globals';
import {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  errorHandler,
  asyncHandler,
  formatValidationErrors,
  retryOperation
} from '../../src/utils/errorHandler.js';

describe('Error Handler', () => {
  describe('Custom Error Classes', () => {
    test('AppError creates error with correct properties', () => {
      const error = new AppError('Test error', 500);
      
      expect(error.message).toBe('Test error');
      expect(error.statusCode).toBe(500);
      expect(error.isOperational).toBe(true);
      expect(error.timestamp).toBeDefined();
      expect(error.stack).toBeDefined();
    });
    
    test('ValidationError creates 400 error', () => {
      const error = new ValidationError('Invalid input', 'email');
      
      expect(error.statusCode).toBe(400);
      expect(error.field).toBe('email');
      expect(error.type).toBe('ValidationError');
    });
    
    test('AuthenticationError creates 401 error', () => {
      const error = new AuthenticationError();
      
      expect(error.statusCode).toBe(401);
      expect(error.message).toBe('Authentication failed');
      expect(error.type).toBe('AuthenticationError');
    });
    
    test('AuthorizationError creates 403 error', () => {
      const error = new AuthorizationError();
      
      expect(error.statusCode).toBe(403);
      expect(error.message).toBe('Access denied');
      expect(error.type).toBe('AuthorizationError');
    });
    
    test('NotFoundError creates 404 error', () => {
      const error = new NotFoundError('User');
      
      expect(error.statusCode).toBe(404);
      expect(error.message).toBe('User not found');
      expect(error.type).toBe('NotFoundError');
    });
    
    test('ConflictError creates 409 error', () => {
      const error = new ConflictError('Resource already exists');
      
      expect(error.statusCode).toBe(409);
      expect(error.message).toBe('Resource already exists');
      expect(error.type).toBe('ConflictError');
    });
    
    test('RateLimitError creates 429 error', () => {
      const error = new RateLimitError();
      
      expect(error.statusCode).toBe(429);
      expect(error.message).toBe('Too many requests');
      expect(error.type).toBe('RateLimitError');
    });
  });
  
  describe('Error Handler Middleware', () => {
    let req, res, next;
    
    beforeEach(() => {
      req = {
        path: '/test',
        method: 'GET',
        ip: '127.0.0.1',
        user: { id: 'user123' }
      };
      
      res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      
      next = jest.fn();
    });
    
    test('handles AppError correctly', () => {
      const error = new AppError('Test error', 400);
      
      errorHandler(error, req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.objectContaining({
          message: 'Test error',
          statusCode: 400,
          timestamp: expect.any(String)
        })
      });
    });
    
    test('converts non-AppError to AppError', () => {
      const error = new Error('Regular error');
      
      errorHandler(error, req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.objectContaining({
          message: 'Internal server error',
          statusCode: 500
        })
      });
    });
    
    test('includes stack trace in development', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      
      const error = new AppError('Dev error', 400);
      
      errorHandler(error, req, res, next);
      
      expect(res.json).toHaveBeenCalledWith({
        error: expect.objectContaining({
          stack: expect.any(String)
        })
      });
      
      process.env.NODE_ENV = originalEnv;
    });
  });
  
  describe('Async Handler', () => {
    test('wraps async functions correctly', async () => {
      const asyncFunc = jest.fn().mockResolvedValue('success');
      const wrapped = asyncHandler(asyncFunc);
      
      const req = {};
      const res = {};
      const next = jest.fn();
      
      await wrapped(req, res, next);
      
      expect(asyncFunc).toHaveBeenCalledWith(req, res, next);
      expect(next).not.toHaveBeenCalled();
    });
    
    test('catches and forwards errors', async () => {
      const error = new Error('Async error');
      const asyncFunc = jest.fn().mockRejectedValue(error);
      const wrapped = asyncHandler(asyncFunc);
      
      const req = {};
      const res = {};
      const next = jest.fn();
      
      await wrapped(req, res, next);
      
      expect(next).toHaveBeenCalledWith(error);
    });
  });
  
  describe('Format Validation Errors', () => {
    test('formats array of errors', () => {
      const errors = [
        { path: ['user', 'email'], message: 'Invalid email' },
        { path: ['user', 'age'], message: 'Must be a number' }
      ];
      
      const formatted = formatValidationErrors(errors);
      
      expect(formatted).toEqual([
        { field: 'user.email', message: 'Invalid email' },
        { field: 'user.age', message: 'Must be a number' }
      ]);
    });
    
    test('formats object of errors', () => {
      const errors = {
        email: 'Invalid email',
        age: 'Must be a number'
      };
      
      const formatted = formatValidationErrors(errors);
      
      expect(formatted).toEqual([
        { field: 'email', message: 'Invalid email' },
        { field: 'age', message: 'Must be a number' }
      ]);
    });
  });
  
  describe('Retry Operation', () => {
    test('retries failed operations', async () => {
      let attempts = 0;
      const operation = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Temporary failure');
        }
        return 'success';
      });
      
      const result = await retryOperation(operation, 3, 10);
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
    });
    
    test('throws after max retries', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Permanent failure'));
      
      await expect(retryOperation(operation, 2, 10)).rejects.toThrow('Permanent failure');
      expect(operation).toHaveBeenCalledTimes(2);
    });
    
    test('succeeds on first try', async () => {
      const operation = jest.fn().mockResolvedValue('immediate success');
      
      const result = await retryOperation(operation, 3, 10);
      
      expect(result).toBe('immediate success');
      expect(operation).toHaveBeenCalledTimes(1);
    });
  });
});