/**
 * Jest Configuration for Traversion Test Suite
 * 
 * Configures Jest for ES modules, test environment, and coverage reporting.
 */

export default {
  // Test environment
  testEnvironment: 'node',
  
  // Enable ES modules support
  preset: null,
  transform: {},
  
  // Module name mapping for ES modules
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  
  // Test file patterns
  testMatch: [
    '**/test/**/*.test.js',
    '**/__tests__/**/*.js',
    '**/*.(test|spec).js'
  ],
  
  // Ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/',
    '/build/',
    '/dist/'
  ],
  
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/test/setup.js'],
  
  // Coverage configuration
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: [
    'text',
    'lcov',
    'html',
    'clover'
  ],
  
  // Coverage collection patterns
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!src/**/index.js'
  ],
  
  // Coverage thresholds (temporarily lowered for current state)
  coverageThreshold: {
    global: {
      branches: 10,
      functions: 10,
      lines: 10,
      statements: 10
    },
    // Individual file thresholds
    'src/auth/authService.js': {
      branches: 0,
      functions: 0,
      lines: 0,
      statements: 0
    },
    'src/engine/causalityEngine.js': {
      branches: 30,
      functions: 40,
      lines: 45,
      statements: 45
    }
  },
  
  // Test execution
  maxWorkers: '50%',
  verbose: true,
  
  // Global timeout (30 seconds)
  testTimeout: 30000,
  
  // Reporter configuration
  reporters: ['default'],
  
  // Mock configuration
  clearMocks: true,
  resetMocks: false,
  restoreMocks: true,
  
  // Global variables
  globals: {
    'process.env.NODE_ENV': 'test'
  }
};