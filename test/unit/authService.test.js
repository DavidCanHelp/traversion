import { jest } from '@jest/globals';

// Mock dependencies first
jest.mock('bcrypt');
jest.mock('jsonwebtoken');
jest.mock('crypto');
jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

describe('AuthService', () => {
  let AuthService;
  let authService;
  let mockStorage;
  let mockBcrypt;
  let mockJwt;
  let mockCrypto;

  beforeEach(async () => {
    // Setup mocks
    mockBcrypt = await import('bcrypt');
    mockJwt = await import('jsonwebtoken');
    mockCrypto = await import('crypto');

    mockBcrypt.hash = jest.fn().mockResolvedValue('hashed-password');
    mockBcrypt.compare = jest.fn().mockResolvedValue(true);
    
    mockJwt.sign = jest.fn().mockReturnValue('mock-jwt-token');
    mockJwt.verify = jest.fn().mockReturnValue({ userId: '123', tenantId: '456' });
    
    mockCrypto.randomBytes = jest.fn().mockReturnValue({
      toString: jest.fn().mockReturnValue('random-hex-string')
    });
    
    // Mock storage
    mockStorage = {
      db: {
        prepare: jest.fn().mockReturnValue({
          run: jest.fn().mockReturnValue({ changes: 1 }),
          get: jest.fn().mockReturnValue(null),
          all: jest.fn().mockReturnValue([])
        })
      }
    };
    
    // Import after mocks are set
    const module = await import('../../src/auth/authService.js');
    AuthService = module.default;
    authService = new AuthService(mockStorage);
  });
  
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    test('should initialize with storage', () => {
      expect(authService.storage).toBe(mockStorage);
      expect(authService.jwtSecret).toBeDefined();
      expect(authService.jwtExpiry).toBeDefined();
      expect(authService.saltRounds).toBe(12);
    });

    test('should define permissions and roles', () => {
      expect(authService.permissions).toBeDefined();
      expect(authService.roles).toBeDefined();
      expect(authService.permissions['events:read']).toBeDefined();
      expect(authService.roles['viewer']).toBeDefined();
    });
  });

  describe('initialize', () => {
    test('should create auth tables', async () => {
      authService.createAuthTables = jest.fn().mockResolvedValue();
      authService.createDefaultSuperAdmin = jest.fn().mockResolvedValue();

      await authService.initialize();

      expect(authService.createAuthTables).toHaveBeenCalled();
      expect(authService.createDefaultSuperAdmin).toHaveBeenCalled();
    });

    test('should handle initialization errors', async () => {
      const error = new Error('Initialization failed');
      authService.createAuthTables = jest.fn().mockRejectedValue(error);

      await expect(authService.initialize()).resolves.not.toThrow();
    });
  });

  describe('createTenant', () => {
    test('should create a new tenant', async () => {
      const mockInsert = jest.fn().mockReturnValue({ lastInsertRowid: 123 });
      mockStorage.db.prepare.mockReturnValue({ run: mockInsert });

      const result = await authService.createTenant('acme-corp', 'ACME Corporation');

      expect(result.id).toBe(123);
      expect(result.name).toBe('acme-corp');
      expect(mockInsert).toHaveBeenCalledWith('acme-corp', 'ACME Corporation', null, '{}');
    });

    test('should handle unique constraint violations', async () => {
      const error = new Error('UNIQUE constraint failed');
      error.code = 'SQLITE_CONSTRAINT_UNIQUE';
      mockStorage.db.prepare.mockReturnValue({
        run: jest.fn().mockImplementation(() => { throw error; })
      });

      await expect(authService.createTenant('existing', 'Existing Corp'))
        .rejects.toThrow('Tenant name already exists');
    });
  });

  describe('createUser', () => {
    test('should create a new user', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
        tenantId: '456',
        role: 'viewer'
      };

      const mockInsert = jest.fn().mockReturnValue({ lastInsertRowid: 789 });
      mockStorage.db.prepare.mockReturnValue({ run: mockInsert });

      const result = await authService.createUser(userData);

      expect(result.id).toBe(789);
      expect(result.email).toBe('test@example.com');
      expect(mockBcrypt.hash).toHaveBeenCalledWith('password123', 12);
    });

    test('should validate required fields', async () => {
      const incompleteData = {
        email: 'test@example.com'
        // Missing password, firstName, etc.
      };

      await expect(authService.createUser(incompleteData))
        .rejects.toThrow('Missing required fields');
    });

    test('should validate email format', async () => {
      const invalidData = {
        email: 'invalid-email',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
        tenantId: '456'
      };

      await expect(authService.createUser(invalidData))
        .rejects.toThrow('Invalid email format');
    });

    test('should validate password strength', async () => {
      const weakPasswordData = {
        email: 'test@example.com',
        password: '123',
        firstName: 'Test',
        lastName: 'User',
        tenantId: '456'
      };

      await expect(authService.createUser(weakPasswordData))
        .rejects.toThrow('Password must be at least 8 characters');
    });
  });

  describe('authenticate', () => {
    beforeEach(() => {
      mockStorage.db.prepare.mockReturnValue({
        get: jest.fn().mockReturnValue({
          id: '123',
          email: 'test@example.com',
          password_hash: 'hashed-password',
          tenant_id: '456',
          role: 'viewer',
          is_active: 1
        })
      });
    });

    test('should authenticate valid credentials', async () => {
      mockBcrypt.compare.mockResolvedValue(true);

      const result = await authService.authenticate('test@example.com', 'password123');

      expect(result.success).toBe(true);
      expect(result.token).toBe('mock-jwt-token');
      expect(result.user.email).toBe('test@example.com');
      expect(mockBcrypt.compare).toHaveBeenCalledWith('password123', 'hashed-password');
    });

    test('should reject invalid credentials', async () => {
      mockBcrypt.compare.mockResolvedValue(false);

      const result = await authService.authenticate('test@example.com', 'wrong-password');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid credentials');
    });

    test('should reject non-existent user', async () => {
      mockStorage.db.prepare.mockReturnValue({
        get: jest.fn().mockReturnValue(null)
      });

      const result = await authService.authenticate('nonexistent@example.com', 'password');

      expect(result.success).toBe(false);
      expect(result.error).toBe('User not found');
    });

    test('should reject inactive users', async () => {
      mockStorage.db.prepare.mockReturnValue({
        get: jest.fn().mockReturnValue({
          id: '123',
          email: 'test@example.com',
          is_active: 0
        })
      });

      const result = await authService.authenticate('test@example.com', 'password123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Account is disabled');
    });

    test('should create session and log audit', async () => {
      mockBcrypt.compare.mockResolvedValue(true);
      authService.createSession = jest.fn();
      authService.logAudit = jest.fn();

      await authService.authenticate('test@example.com', 'password123', '127.0.0.1', 'test-agent');

      expect(authService.createSession).toHaveBeenCalledWith('123', 'mock-jwt-token', '127.0.0.1', 'test-agent');
      expect(authService.logAudit).toHaveBeenCalledWith('123', '456', 'login', 'auth', '127.0.0.1', 'test-agent', true);
    });
  });

  describe('verifyToken', () => {
    test('should verify valid JWT token', async () => {
      mockJwt.verify.mockReturnValue({ userId: '123', tenantId: '456' });
      mockStorage.db.prepare.mockReturnValue({
        get: jest.fn().mockReturnValue({
          id: '123',
          email: 'test@example.com',
          tenant_id: '456',
          is_active: 1
        })
      });

      const result = await authService.verifyToken('valid-token');

      expect(result.valid).toBe(true);
      expect(result.user.id).toBe('123');
      expect(mockJwt.verify).toHaveBeenCalledWith('valid-token', authService.jwtSecret);
    });

    test('should reject invalid token', async () => {
      mockJwt.verify.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      const result = await authService.verifyToken('invalid-token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid or expired token');
    });

    test('should reject token for non-existent user', async () => {
      mockJwt.verify.mockReturnValue({ userId: '999', tenantId: '456' });
      mockStorage.db.prepare.mockReturnValue({
        get: jest.fn().mockReturnValue(null)
      });

      const result = await authService.verifyToken('valid-token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('User not found');
    });
  });

  describe('createApiKey', () => {
    test('should create API key', async () => {
      const mockInsert = jest.fn().mockReturnValue({ lastInsertRowid: 999 });
      mockStorage.db.prepare.mockReturnValue({ run: mockInsert });

      const result = await authService.createApiKey('123', 'test-key', ['events:read']);

      expect(result.id).toBe(999);
      expect(result.key).toMatch(/^tk_[a-f0-9]{64}$/);
      expect(result.permissions).toEqual(['events:read']);
    });

    test('should set expiration date', async () => {
      const mockInsert = jest.fn().mockReturnValue({ lastInsertRowid: 999 });
      mockStorage.db.prepare.mockReturnValue({ run: mockInsert });

      const expiryDate = new Date('2024-12-31');
      const result = await authService.createApiKey('123', 'test-key', [], expiryDate);

      expect(result.expires_at).toEqual(expiryDate);
    });
  });

  describe('verifyApiKey', () => {
    test('should verify valid API key', async () => {
      mockStorage.db.prepare.mockReturnValue({
        get: jest.fn().mockReturnValue({
          id: '999',
          user_id: '123',
          permissions: JSON.stringify(['events:read']),
          is_active: 1,
          expires_at: null
        })
      });

      const result = await authService.verifyApiKey('tk_validkey');

      expect(result.valid).toBe(true);
      expect(result.userId).toBe('123');
      expect(result.permissions).toEqual(['events:read']);
    });

    test('should reject expired API key', async () => {
      mockStorage.db.prepare.mockReturnValue({
        get: jest.fn().mockReturnValue({
          id: '999',
          expires_at: '2020-01-01' // Expired
        })
      });

      const result = await authService.verifyApiKey('tk_expiredkey');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('API key expired');
    });

    test('should reject inactive API key', async () => {
      mockStorage.db.prepare.mockReturnValue({
        get: jest.fn().mockReturnValue({
          id: '999',
          is_active: 0
        })
      });

      const result = await authService.verifyApiKey('tk_inactivekey');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('API key disabled');
    });
  });

  describe('middleware functions', () => {
    test('requireAuth should create middleware', () => {
      const middleware = authService.requireAuth();
      expect(typeof middleware).toBe('function');
    });

    test('requirePermission should create middleware', () => {
      const middleware = authService.requirePermission('events:read');
      expect(typeof middleware).toBe('function');
    });

    test('tenantIsolation should create middleware', () => {
      const middleware = authService.tenantIsolation();
      expect(typeof middleware).toBe('function');
    });
  });

  describe('utility methods', () => {
    test('getUserById should retrieve user', async () => {
      const mockUser = { id: '123', email: 'test@example.com' };
      mockStorage.db.prepare.mockReturnValue({
        get: jest.fn().mockReturnValue(mockUser)
      });

      const result = await authService.getUserById('123');

      expect(result).toEqual(mockUser);
    });

    test('createSession should store session', async () => {
      const mockInsert = jest.fn().mockReturnValue({ changes: 1 });
      mockStorage.db.prepare.mockReturnValue({ run: mockInsert });

      await authService.createSession('123', 'token', '127.0.0.1', 'user-agent');

      expect(mockInsert).toHaveBeenCalled();
    });

    test('logAudit should store audit log', async () => {
      const mockInsert = jest.fn().mockReturnValue({ changes: 1 });
      mockStorage.db.prepare.mockReturnValue({ run: mockInsert });

      await authService.logAudit('123', '456', 'login', 'auth', '127.0.0.1', 'user-agent', true);

      expect(mockInsert).toHaveBeenCalled();
    });

    test('logout should invalidate session', async () => {
      const mockUpdate = jest.fn().mockReturnValue({ changes: 1 });
      mockStorage.db.prepare.mockReturnValue({ run: mockUpdate });

      const result = await authService.logout('token');

      expect(result.success).toBe(true);
      expect(mockUpdate).toHaveBeenCalled();
    });

    test('getUserStats should return statistics', async () => {
      mockStorage.db.prepare.mockReturnValue({
        get: jest.fn().mockReturnValue({
          total_users: 10,
          active_users: 8,
          total_sessions: 15
        })
      });

      const result = await authService.getUserStats();

      expect(result.total_users).toBe(10);
      expect(result.active_users).toBe(8);
    });
  });

  describe('error handling', () => {
    test('should handle database errors gracefully', async () => {
      const dbError = new Error('Database connection failed');
      mockStorage.db.prepare.mockImplementation(() => {
        throw dbError;
      });

      const result = await authService.authenticate('test@example.com', 'password');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Authentication failed');
    });
  });
});