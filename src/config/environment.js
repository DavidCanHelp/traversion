import dotenv from 'dotenv';
import logger from '../utils/logger.js';

// Load environment variables
dotenv.config();

/**
 * Environment Configuration and Validation
 *
 * Validates and provides environment variables with defaults
 */
class EnvironmentConfig {
  constructor() {
    this.env = process.env.NODE_ENV || 'development';
    this.isDevelopment = this.env === 'development';
    this.isProduction = this.env === 'production';
    this.isTest = this.env === 'test';

    // Validate and load configuration
    this.config = this.loadConfig();
    this.validateConfig();
  }

  loadConfig() {
    return {
      // Application
      app: {
        name: process.env.APP_NAME || 'Traversion',
        env: this.env,
        port: parseInt(process.env.PORT || '3335'),
        host: process.env.HOST || '0.0.0.0',
        url: process.env.APP_URL || `http://localhost:${process.env.PORT || '3335'}`,
        version: process.env.APP_VERSION || '0.1.0'
      },

      // Database
      database: {
        type: process.env.DB_TYPE || 'sqlite',
        sqlite: {
          path: process.env.SQLITE_PATH || './.traversion/database.db'
        },
        postgres: {
          host: process.env.DB_HOST || 'localhost',
          port: parseInt(process.env.DB_PORT || '5432'),
          database: process.env.DB_NAME || 'traversion',
          user: process.env.DB_USER || 'postgres',
          password: process.env.DB_PASSWORD || '',
          ssl: process.env.DB_SSL === 'true',
          maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '20')
        },
        timescale: {
          enabled: process.env.TIMESCALE_ENABLED === 'true',
          host: process.env.TIMESCALE_HOST || process.env.DB_HOST || 'localhost',
          port: parseInt(process.env.TIMESCALE_PORT || process.env.DB_PORT || '5432'),
          database: process.env.TIMESCALE_DB || 'traversion_metrics'
        }
      },

      // Authentication
      auth: {
        jwtSecret: process.env.JWT_SECRET || (this.isProduction ? null : 'development-secret-change-in-production'),
        jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
        bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '10'),
        sessionSecret: process.env.SESSION_SECRET || process.env.JWT_SECRET,
        apiKeyPrefix: process.env.API_KEY_PREFIX || 'trav_'
      },

      // Redis (for caching and sessions)
      redis: {
        enabled: process.env.REDIS_ENABLED === 'true',
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD || '',
        db: parseInt(process.env.REDIS_DB || '0'),
        keyPrefix: process.env.REDIS_KEY_PREFIX || 'traversion:'
      },

      // Security
      security: {
        corsOrigins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['*'],
        trustedProxies: process.env.TRUSTED_PROXIES ? process.env.TRUSTED_PROXIES.split(',') : [],
        rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 min
        rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
        enableHttps: process.env.ENABLE_HTTPS === 'true',
        sslCertPath: process.env.SSL_CERT_PATH,
        sslKeyPath: process.env.SSL_KEY_PATH
      },

      // Logging
      logging: {
        level: process.env.LOG_LEVEL || 'info',
        toFile: process.env.LOG_TO_FILE !== 'false',
        dir: process.env.LOG_DIR || './.traversion/logs',
        colorize: process.env.NO_COLOR !== 'true',
        jsonFormat: process.env.LOG_JSON === 'true'
      },

      // Git Integration
      git: {
        repoPath: process.env.GIT_REPO_PATH || '.',
        maxCommits: parseInt(process.env.GIT_MAX_COMMITS || '1000'),
        defaultBranch: process.env.GIT_DEFAULT_BRANCH || 'main'
      },

      // External Services
      services: {
        github: {
          enabled: process.env.GITHUB_ENABLED === 'true',
          token: process.env.GITHUB_TOKEN,
          org: process.env.GITHUB_ORG,
          webhookSecret: process.env.GITHUB_WEBHOOK_SECRET
        },
        slack: {
          enabled: process.env.SLACK_ENABLED === 'true',
          token: process.env.SLACK_TOKEN,
          channel: process.env.SLACK_CHANNEL || '#incidents',
          webhookUrl: process.env.SLACK_WEBHOOK_URL
        },
        datadog: {
          enabled: process.env.DATADOG_ENABLED === 'true',
          apiKey: process.env.DATADOG_API_KEY,
          appKey: process.env.DATADOG_APP_KEY,
          site: process.env.DATADOG_SITE || 'datadoghq.com'
        }
      },

      // Features
      features: {
        realtime: process.env.FEATURE_REALTIME !== 'false',
        analytics: process.env.FEATURE_ANALYTICS !== 'false',
        export: process.env.FEATURE_EXPORT !== 'false',
        collaboration: process.env.FEATURE_COLLABORATION === 'true',
        ml: process.env.FEATURE_ML === 'true'
      },

      // Performance
      performance: {
        maxWorkers: parseInt(process.env.MAX_WORKERS || '4'),
        analysisTimeout: parseInt(process.env.ANALYSIS_TIMEOUT || '30000'), // 30s
        cacheEnabled: process.env.CACHE_ENABLED !== 'false',
        cacheTTL: parseInt(process.env.CACHE_TTL || '3600'), // 1 hour
        compressionEnabled: process.env.COMPRESSION_ENABLED !== 'false'
      },

      // Storage
      storage: {
        dataDir: process.env.DATA_DIR || './.traversion',
        backupEnabled: process.env.BACKUP_ENABLED === 'true',
        backupInterval: process.env.BACKUP_INTERVAL || '0 2 * * *', // 2 AM daily
        maxBackups: parseInt(process.env.MAX_BACKUPS || '30')
      }
    };
  }

  validateConfig() {
    const errors = [];

    // Production validations
    if (this.isProduction) {
      if (!this.config.auth.jwtSecret) {
        errors.push('JWT_SECRET is required in production');
      }

      if (this.config.auth.jwtSecret === 'development-secret-change-in-production') {
        errors.push('JWT_SECRET must be changed from default in production');
      }

      if (this.config.database.type === 'sqlite') {
        logger.warn('SQLite is not recommended for production. Consider using PostgreSQL.');
      }

      if (!this.config.security.enableHttps) {
        logger.warn('HTTPS is not enabled. This is strongly recommended for production.');
      }

      if (this.config.security.corsOrigins.includes('*')) {
        logger.warn('CORS is configured to allow all origins. Consider restricting this in production.');
      }
    }

    // Database validation
    if (this.config.database.type === 'postgres') {
      if (!this.config.database.postgres.password && this.isProduction) {
        errors.push('Database password is required in production');
      }
    }

    // Service validations
    if (this.config.services.github.enabled && !this.config.services.github.token) {
      logger.warn('GitHub integration is enabled but GITHUB_TOKEN is not set');
    }

    if (this.config.services.slack.enabled && !this.config.services.slack.token) {
      logger.warn('Slack integration is enabled but SLACK_TOKEN is not set');
    }

    // Port validation
    if (this.config.app.port < 1 || this.config.app.port > 65535) {
      errors.push(`Invalid port number: ${this.config.app.port}`);
    }

    // Handle validation errors
    if (errors.length > 0) {
      logger.error('Environment configuration validation failed:', { errors });
      if (this.isProduction) {
        throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
      }
    }

    // Log configuration summary
    logger.info('Environment configuration loaded', {
      environment: this.env,
      port: this.config.app.port,
      database: this.config.database.type,
      features: Object.entries(this.config.features)
        .filter(([_, enabled]) => enabled)
        .map(([feature]) => feature),
      services: Object.entries(this.config.services)
        .filter(([_, service]) => service.enabled)
        .map(([name]) => name)
    });
  }

  get(path) {
    const keys = path.split('.');
    let value = this.config;

    for (const key of keys) {
      value = value[key];
      if (value === undefined) return null;
    }

    return value;
  }

  isEnabled(feature) {
    return this.config.features[feature] === true;
  }

  getDbConfig() {
    const type = this.config.database.type;

    if (type === 'postgres') {
      return {
        type: 'postgres',
        ...this.config.database.postgres
      };
    }

    return {
      type: 'sqlite',
      ...this.config.database.sqlite
    };
  }

  getRedisConfig() {
    if (!this.config.redis.enabled) return null;

    return {
      host: this.config.redis.host,
      port: this.config.redis.port,
      password: this.config.redis.password,
      db: this.config.redis.db,
      keyPrefix: this.config.redis.keyPrefix
    };
  }

  export() {
    // Export safe configuration (no secrets)
    const safeConfig = JSON.parse(JSON.stringify(this.config));

    // Remove sensitive values
    delete safeConfig.auth.jwtSecret;
    delete safeConfig.auth.sessionSecret;
    delete safeConfig.database.postgres.password;
    delete safeConfig.redis.password;
    delete safeConfig.services.github.token;
    delete safeConfig.services.github.webhookSecret;
    delete safeConfig.services.slack.token;
    delete safeConfig.services.datadog.apiKey;
    delete safeConfig.services.datadog.appKey;

    return safeConfig;
  }
}

// Create singleton instance
const config = new EnvironmentConfig();

export default config;
export { EnvironmentConfig };