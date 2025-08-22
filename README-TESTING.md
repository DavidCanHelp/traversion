# Traversion Testing Guide

This document provides comprehensive information about testing the Traversion production debugging platform.

## Test Suite Overview

The Traversion test suite includes:

- **Unit Tests**: Test individual components in isolation
- **Integration Tests**: Test complete workflows and API endpoints
- **Performance Tests**: Ensure system handles load and concurrent operations
- **Security Tests**: Validate authentication, authorization, and tenant isolation

## Test Structure

```
test/
├── unit/                    # Unit tests
│   ├── causality.test.js   # Causality engine tests
│   ├── storage.test.js     # Storage layer tests
│   └── temporal-query.test.js # TimeQL engine tests
├── integration/            # Integration tests
│   ├── api.test.js         # API endpoint tests
│   └── auth.test.js        # Authentication tests
├── setup.js               # Global test setup
└── README.md              # This file
```

## Prerequisites

### Required Services

1. **PostgreSQL with TimescaleDB**
   ```bash
   # Install TimescaleDB
   # See: https://docs.timescale.com/install/
   ```

2. **Redis**
   ```bash
   # Install Redis
   brew install redis        # macOS
   sudo apt install redis    # Ubuntu
   ```

### Test Database Setup

1. **Create test database**:
   ```bash
   # Run the setup script
   ./scripts/setup-test-db.sh
   
   # Or manually:
   createdb traversion_test
   psql traversion_test -c "CREATE EXTENSION timescaledb"
   psql traversion_test -f init-db/01-schema.sql
   ```

2. **Configure environment variables**:
   ```bash
   export TEST_DB_HOST=localhost
   export TEST_DB_PORT=5432
   export TEST_DB_NAME=traversion_test
   export TEST_DB_USER=traversion
   export TEST_DB_PASSWORD=traversion_secret
   export TEST_REDIS_HOST=localhost
   export TEST_REDIS_PORT=6379
   ```

## Running Tests

### Install Dependencies

```bash
npm install
```

### Run All Tests

```bash
npm test
```

### Run Specific Test Suites

```bash
# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# Specific test files
npm run test:auth          # Authentication tests
npm run test:causality     # Causality engine tests
npm run test:storage       # Storage layer tests
```

### Test Coverage

```bash
# Run tests with coverage report
npm run test:coverage

# View coverage report
open coverage/lcov-report/index.html
```

### Watch Mode

```bash
# Run tests in watch mode for development
npm run test:watch
```

## Test Configuration

### Jest Configuration

Tests are configured in `jest.config.js`:

- **ES Module Support**: Full ES6 module support
- **Test Environment**: Node.js environment
- **Coverage Thresholds**: Minimum 80% line coverage
- **Test Timeout**: 30 seconds for integration tests

### Environment Variables

Test-specific environment variables:

```bash
NODE_ENV=test                    # Test environment
LOG_LEVEL=error                  # Reduce log noise
JWT_SECRET=test-jwt-secret       # Test JWT secret
API_KEY_SECRET=test-api-secret   # Test API key secret
```

## Writing Tests

### Test Structure Example

```javascript
import { describe, it, beforeAll, afterAll, expect } from '@jest/globals';

describe('Component Name', () => {
  beforeAll(async () => {
    // Setup for all tests
  });
  
  afterAll(async () => {
    // Cleanup after all tests
  });
  
  describe('Feature Group', () => {
    it('should do something specific', () => {
      // Test implementation
      expect(result).toBe(expected);
    });
  });
});
```

### Test Utilities

Global test utilities available in all tests:

```javascript
// Generate test data
const event = global.testUtils.createTestEvent({
  eventType: 'custom.test',
  serviceId: 'test-service'
});

const user = global.testUtils.createTestUser({
  email: 'test@example.com',
  role: 'admin'
});

const tenant = global.testUtils.createTestTenant({
  name: 'Test Organization'
});

// Time utilities
const { start, end } = global.testUtils.timeRange(2, 0); // 2 hours ago to now
await global.testUtils.wait(1000); // Wait 1 second
```

### Best Practices

1. **Isolation**: Each test should be independent
2. **Cleanup**: Always clean up test data
3. **Descriptive Names**: Use clear, descriptive test names
4. **Assertions**: Use specific assertions
5. **Async/Await**: Handle promises properly

## Test Categories

### Unit Tests

Test individual components:

```javascript
describe('CausalityEngine', () => {
  it('should detect temporal causality', () => {
    const engine = new CausalityEngine();
    // Test causality detection logic
  });
});
```

### Integration Tests

Test complete workflows:

```javascript
describe('Event Ingestion Flow', () => {
  it('should ingest, process, and store events', async () => {
    // Test complete event flow from API to database
  });
});
```

### Authentication Tests

Test security features:

```javascript
describe('Multi-tenant Isolation', () => {
  it('should prevent cross-tenant data access', async () => {
    // Test tenant isolation
  });
});
```

### Performance Tests

Test system performance:

```javascript
describe('High Volume Processing', () => {
  it('should handle 10k events efficiently', async () => {
    // Test performance under load
  });
});
```

## Continuous Integration

### GitHub Actions

Create `.github/workflows/test.yml`:

```yaml
name: Test Suite

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: timescale/timescaledb:latest-pg14
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      
      redis:
        image: redis:7-alpine
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Setup test database
        run: ./scripts/setup-test-db.sh
        env:
          TEST_DB_HOST: localhost
          TEST_DB_USER: postgres
          TEST_DB_PASSWORD: postgres
      
      - name: Run tests
        run: npm run test:coverage
        env:
          TEST_DB_HOST: localhost
          TEST_DB_USER: postgres
          TEST_DB_PASSWORD: postgres
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
```

## Debugging Tests

### Debug Individual Tests

```bash
# Run specific test with debugging
node --inspect-brk ./node_modules/.bin/jest test/unit/causality.test.js
```

### Debug API Tests

```bash
# Start API server in debug mode
DEBUG=* npm run dev

# Run API tests against running server
npm run test:integration
```

### Troubleshooting

1. **Database Connection Issues**:
   - Verify PostgreSQL is running
   - Check connection parameters
   - Ensure TimescaleDB extension is installed

2. **Redis Connection Issues**:
   - Verify Redis is running
   - Check Redis configuration

3. **Test Timeouts**:
   - Increase Jest timeout in `jest.config.js`
   - Check for hanging promises

4. **Authentication Failures**:
   - Verify JWT secrets are set
   - Check user creation and token generation

## Coverage Goals

- **Overall Coverage**: 80%+ lines, 75%+ functions
- **Critical Components**: 90%+ coverage
  - Authentication service
  - Causality engine
  - Storage layer
- **API Endpoints**: 85%+ coverage

## Performance Benchmarks

Tests should verify these performance targets:

- **Event Ingestion**: 1000+ events/second
- **Query Response**: <500ms for time range queries
- **Causality Detection**: <100ms per event
- **Memory Usage**: <1GB for 100k events
- **Database Operations**: <50ms average

## Security Testing

Security tests verify:

- **Authentication**: JWT and API key validation
- **Authorization**: Role-based access control
- **Tenant Isolation**: Data separation between tenants
- **Input Validation**: SQL injection prevention
- **Rate Limiting**: API abuse prevention

## Monitoring Test Health

Monitor test suite health:

- **Test Duration**: Should remain under 5 minutes
- **Flaky Tests**: Identify and fix unstable tests
- **Coverage Trends**: Track coverage over time
- **Performance Degradation**: Monitor test execution time

## Contributing

When adding new features:

1. Write tests first (TDD approach)
2. Ensure tests pass locally
3. Maintain or improve coverage
4. Update test documentation
5. Add integration tests for new APIs

For questions about testing, see the development team or create an issue in the repository.