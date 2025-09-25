import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Load dotenv early
const dotenv = await import('dotenv');
dotenv.config();

/**
 * Centralized Configuration Management
 *
 * Handles all environment-specific configuration with validation,
 * defaults, and type checking for production readiness.
 */
class Config {
  constructor() {
    this.env = process.env.NODE_ENV || 'development';
    this.isProduction = this.env === 'production';
    this.isDevelopment = this.env === 'development';
    this.isTest = this.env === 'test';

    // Load environment-specific config file if exists
    this.loadEnvironmentConfig();

    // Initialize configuration
    this.config = this.buildConfig();

    // Validate configuration
    this.validate();
  }

  /**
   * Load environment-specific configuration file
   */
  loadEnvironmentConfig() {
    const configPath = join(process.cwd(), `.env.${this.env}`);
    if (existsSync(configPath)) {
      dotenv.config({ path: configPath });
    }
  }

  /**
   * Build configuration object with defaults and validation
   */
  buildConfig() {
    return {
      // Application Settings
      app: {
        name: process.env.APP_NAME || 'Traversion',
        version: process.env.APP_VERSION || '1.0.0',
        env: this.env,
        port: this.parsePort(process.env.PORT, 3335),
        apiPort: this.parsePort(process.env.API_PORT, 3333),
        wsPort: this.parsePort(process.env.WS_PORT, 3341),
        host: process.env.HOST || '0.0.0.0',
        baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || 3335}`,
        corsOrigins: this.parseArray(process.env.CORS_ORIGINS, ['http://localhost:3000']),
        trustProxy: this.parseBoolean(process.env.TRUST_PROXY, this.isProduction),
        logLevel: process.env.LOG_LEVEL || (this.isProduction ? 'info' : 'debug')
      },

      // Security Settings
      security: {
        jwtSecret: process.env.JWT_SECRET || this.generateDefaultSecret(),
        jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
        bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '10', 10),
        sessionSecret: process.env.SESSION_SECRET || this.generateDefaultSecret(),
        cookieSecure: this.parseBoolean(process.env.COOKIE_SECURE, this.isProduction),
        cookieMaxAge: parseInt(process.env.COOKIE_MAX_AGE || '86400000', 10), // 24 hours
        rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '900000', 10), // 15 minutes
        rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
        allowedHosts: this.parseArray(process.env.ALLOWED_HOSTS, []),
        csrfEnabled: this.parseBoolean(process.env.CSRF_ENABLED, this.isProduction)
      },

      // Database Settings
      database: {
        type: process.env.DB_TYPE || 'sqlite',
        sqlite: {
          path: process.env.SQLITE_PATH || './.traversion/database.db',
          walMode: this.parseBoolean(process.env.SQLITE_WAL_MODE, true),
          timeout: parseInt(process.env.SQLITE_TIMEOUT || '5000', 10)
        },
        postgres: {
          host: process.env.POSTGRES_HOST || 'localhost',
          port: this.parsePort(process.env.POSTGRES_PORT, 5432),
          database: process.env.POSTGRES_DB || 'traversion',
          user: process.env.POSTGRES_USER || 'traversion',
          password: process.env.POSTGRES_PASSWORD || '',
          ssl: this.parseBoolean(process.env.POSTGRES_SSL, this.isProduction),
          poolMin: parseInt(process.env.POSTGRES_POOL_MIN || '2', 10),
          poolMax: parseInt(process.env.POSTGRES_POOL_MAX || '10', 10),
          connectionTimeout: parseInt(process.env.POSTGRES_CONNECTION_TIMEOUT || '30000', 10)
        },
        redis: {
          enabled: this.parseBoolean(process.env.REDIS_ENABLED, this.isProduction),
          host: process.env.REDIS_HOST || 'localhost',
          port: this.parsePort(process.env.REDIS_PORT, 6379),
          password: process.env.REDIS_PASSWORD || '',
          db: parseInt(process.env.REDIS_DB || '0', 10),
          keyPrefix: process.env.REDIS_KEY_PREFIX || 'traversion:',
          ttl: parseInt(process.env.REDIS_TTL || '3600', 10)
        }
      },

      // GitHub Integration
      github: {
        enabled: this.parseBoolean(process.env.GITHUB_ENABLED, true),
        token: process.env.GITHUB_TOKEN || '',
        appId: process.env.GITHUB_APP_ID || '',
        privateKey: process.env.GITHUB_PRIVATE_KEY || '',
        webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || '',
        baseUrl: process.env.GITHUB_BASE_URL || 'https://api.github.com',
        timeout: parseInt(process.env.GITHUB_TIMEOUT || '30000', 10),
        retryLimit: parseInt(process.env.GITHUB_RETRY_LIMIT || '3', 10)
      },

      // Monitoring Integrations
      monitoring: {
        datadog: {
          enabled: this.parseBoolean(process.env.DATADOG_ENABLED, false),
          apiKey: process.env.DATADOG_API_KEY || '',
          appKey: process.env.DATADOG_APP_KEY || '',
          baseUrl: process.env.DATADOG_BASE_URL || 'https://api.datadoghq.com/api/v1',
          site: process.env.DATADOG_SITE || 'datadoghq.com'
        },
        newrelic: {
          enabled: this.parseBoolean(process.env.NEWRELIC_ENABLED, false),
          apiKey: process.env.NEWRELIC_API_KEY || '',
          accountId: process.env.NEWRELIC_ACCOUNT_ID || '',
          baseUrl: process.env.NEWRELIC_BASE_URL || 'https://api.newrelic.com/v2'
        },
        pagerduty: {
          enabled: this.parseBoolean(process.env.PAGERDUTY_ENABLED, false),
          apiToken: process.env.PAGERDUTY_API_TOKEN || '',
          integrationKey: process.env.PAGERDUTY_INTEGRATION_KEY || ''
        },
        prometheus: {
          enabled: this.parseBoolean(process.env.PROMETHEUS_ENABLED, false),
          endpoint: process.env.PROMETHEUS_ENDPOINT || '',
          username: process.env.PROMETHEUS_USERNAME || '',
          password: process.env.PROMETHEUS_PASSWORD || ''
        }
      },

      // Slack Integration
      slack: {
        enabled: this.parseBoolean(process.env.SLACK_ENABLED, false),
        botToken: process.env.SLACK_BOT_TOKEN || '',
        appToken: process.env.SLACK_APP_TOKEN || '',
        signingSecret: process.env.SLACK_SIGNING_SECRET || '',
        defaultChannel: process.env.SLACK_DEFAULT_CHANNEL || '#incidents'
      },

      // Email Configuration
      email: {
        enabled: this.parseBoolean(process.env.EMAIL_ENABLED, false),
        from: process.env.EMAIL_FROM || 'noreply@traversion.dev',
        smtp: {
          host: process.env.SMTP_HOST || '',
          port: this.parsePort(process.env.SMTP_PORT, 587),
          secure: this.parseBoolean(process.env.SMTP_SECURE, false),
          user: process.env.SMTP_USER || '',
          password: process.env.SMTP_PASSWORD || ''
        }
      },

      // Feature Flags
      features: {
        autoRollback: this.parseBoolean(process.env.FEATURE_AUTO_ROLLBACK, false),
        mlPredictions: this.parseBoolean(process.env.FEATURE_ML_PREDICTIONS, false),
        realtimeTracking: this.parseBoolean(process.env.FEATURE_REALTIME_TRACKING, true),
        feedbackLoop: this.parseBoolean(process.env.FEATURE_FEEDBACK_LOOP, true),
        advancedAnalytics: this.parseBoolean(process.env.FEATURE_ADVANCED_ANALYTICS, false)
      },

      // Deployment Settings
      deployment: {
        autoDetect: this.parseBoolean(process.env.DEPLOYMENT_AUTO_DETECT, true),
        checkInterval: parseInt(process.env.DEPLOYMENT_CHECK_INTERVAL || '5000', 10),
        correlationWindow: parseInt(process.env.DEPLOYMENT_CORRELATION_WINDOW || '300000', 10),
        confidenceThreshold: parseFloat(process.env.DEPLOYMENT_CONFIDENCE_THRESHOLD || '0.7'),
        rollbackThreshold: parseFloat(process.env.DEPLOYMENT_ROLLBACK_THRESHOLD || '0.8')
      },

      // Risk Analysis Settings
      risk: {
        offHoursWeight: parseFloat(process.env.RISK_OFF_HOURS_WEIGHT || '0.2'),
        weekendWeight: parseFloat(process.env.RISK_WEEKEND_WEIGHT || '0.2'),
        configChangeWeight: parseFloat(process.env.RISK_CONFIG_CHANGE_WEIGHT || '0.4'),
        databaseChangeWeight: parseFloat(process.env.RISK_DATABASE_CHANGE_WEIGHT || '0.5'),
        largeChangeWeight: parseFloat(process.env.RISK_LARGE_CHANGE_WEIGHT || '0.3'),
        urgentKeywordWeight: parseFloat(process.env.RISK_URGENT_KEYWORD_WEIGHT || '0.4'),
        learningRate: parseFloat(process.env.RISK_LEARNING_RATE || '0.1'),
        minSampleSize: parseInt(process.env.RISK_MIN_SAMPLE_SIZE || '10', 10)
      },

      // Storage Settings
      storage: {
        dataDir: process.env.DATA_DIR || './.traversion',
        backupDir: process.env.BACKUP_DIR || './.traversion/backups',
        logsDir: process.env.LOGS_DIR || './.traversion/logs',
        maxLogSize: process.env.MAX_LOG_SIZE || '10m',
        maxLogFiles: parseInt(process.env.MAX_LOG_FILES || '30', 10),
        enableCompression: this.parseBoolean(process.env.ENABLE_COMPRESSION, true)
      },

      // Performance Settings
      performance: {
        maxWorkers: parseInt(process.env.MAX_WORKERS || '4', 10),
        requestTimeout: parseInt(process.env.REQUEST_TIMEOUT || '30000', 10),
        shutdownTimeout: parseInt(process.env.SHUTDOWN_TIMEOUT || '10000', 10),
        keepAliveTimeout: parseInt(process.env.KEEP_ALIVE_TIMEOUT || '65000', 10),
        bodyLimit: process.env.BODY_LIMIT || '10mb'
      },

      // Development Settings
      development: {
        hotReload: this.parseBoolean(process.env.HOT_RELOAD, this.isDevelopment),
        debugMode: this.parseBoolean(process.env.DEBUG_MODE, this.isDevelopment),
        mockData: this.parseBoolean(process.env.MOCK_DATA, false),
        verboseErrors: this.parseBoolean(process.env.VERBOSE_ERRORS, !this.isProduction)
      }
    };
  }

  /**
   * Validate configuration
   */
  validate() {
    const errors = [];
    const warnings = [];

    // Critical validations for production
    if (this.isProduction) {
      if (!this.config.security.jwtSecret || this.config.security.jwtSecret.includes('default')) {
        errors.push('JWT_SECRET must be set in production');
      }

      if (!this.config.security.sessionSecret || this.config.security.sessionSecret.includes('default')) {
        errors.push('SESSION_SECRET must be set in production');
      }

      if (this.config.database.type === 'postgres' && !this.config.database.postgres.password) {
        errors.push('POSTGRES_PASSWORD must be set in production');
      }

      if (this.config.github.enabled && !this.config.github.token) {
        warnings.push('GitHub integration enabled but GITHUB_TOKEN not set');
      }

      if (!this.config.security.cookieSecure) {
        warnings.push('Cookies are not set to secure in production');
      }
    }

    // General validations
    if (this.config.app.port === this.config.app.apiPort) {
      errors.push('App port and API port cannot be the same');
    }

    if (this.config.features.autoRollback && !this.config.github.token) {
      warnings.push('Auto-rollback enabled but GitHub token not configured');
    }

    if (this.config.monitoring.datadog.enabled && !this.config.monitoring.datadog.apiKey) {
      warnings.push('DataDog enabled but API key not configured');
    }

    // Log errors and warnings
    errors.forEach(error => console.error('Configuration error:', error));
    warnings.forEach(warning => console.warn('Configuration warning:', warning));

    // Fail fast in production
    if (errors.length > 0 && this.isProduction) {
      throw new Error(`Configuration validation failed: ${errors.join(', ')}`);
    }

    return { errors, warnings };
  }

  /**
   * Parse port number
   */
  parsePort(value, defaultPort) {
    const port = parseInt(value || defaultPort, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      return defaultPort;
    }
    return port;
  }

  /**
   * Parse boolean value
   */
  parseBoolean(value, defaultValue = false) {
    if (value === undefined || value === null) {
      return defaultValue;
    }
    return value === 'true' || value === '1' || value === true;
  }

  /**
   * Parse array from comma-separated string
   */
  parseArray(value, defaultValue = []) {
    if (!value) return defaultValue;
    if (Array.isArray(value)) return value;
    return value.split(',').map(item => item.trim()).filter(Boolean);
  }

  /**
   * Generate default secret for development
   */
  generateDefaultSecret() {
    if (this.isProduction) {
      throw new Error('Cannot use default secret in production');
    }
    return `default_${this.env}_secret_${Date.now()}`;
  }

  /**
   * Get specific configuration section
   */
  get(path) {
    const keys = path.split('.');
    let value = this.config;

    for (const key of keys) {
      value = value[key];
      if (value === undefined) {
        return undefined;
      }
    }

    return value;
  }

  /**
   * Check if a feature is enabled
   */
  isFeatureEnabled(feature) {
    return this.config.features[feature] === true;
  }

  /**
   * Get all configuration (for debugging)
   */
  getAll() {
    if (this.isProduction) {
      // Sanitize sensitive data in production
      const sanitized = JSON.parse(JSON.stringify(this.config));
      this.sanitizeObject(sanitized);
      return sanitized;
    }
    return this.config;
  }

  /**
   * Sanitize sensitive data
   */
  sanitizeObject(obj) {
    const sensitiveKeys = ['password', 'secret', 'token', 'key', 'apiKey', 'privateKey'];

    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive.toLowerCase()))) {
          obj[key] = '***REDACTED***';
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          this.sanitizeObject(obj[key]);
        }
      }
    }
  }

  /**
   * Reload configuration
   */
  reload() {
    console.info('Reloading configuration');
    this.loadEnvironmentConfig();
    this.config = this.buildConfig();
    this.validate();
    console.info('Configuration reloaded');
  }
}

// Create singleton instance
const config = new Config();

// Export configuration
export default config;
export const getConfig = () => config;