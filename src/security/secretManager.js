/**
 * Secret Manager
 *
 * Handles secure storage and retrieval of sensitive configuration
 * Supports multiple secret backends and rotation
 */

import crypto from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import logger from '../utils/logger.js';

class SecretManager {
  constructor(options = {}) {
    this.backend = options.backend || process.env.SECRET_BACKEND || 'env';
    this.keyFile = options.keyFile || process.env.SECRET_KEY_FILE || './.traversion/secrets/key';
    this.secretsFile = options.secretsFile || './.traversion/secrets/secrets.enc';
    this.algorithm = 'aes-256-gcm';
    this.secrets = new Map();
    this.rotationCallbacks = new Map();

    this.initializeBackend();
  }

  initializeBackend() {
    switch (this.backend) {
      case 'env':
        this.loadFromEnvironment();
        break;
      case 'file':
        this.loadFromFile();
        break;
      case 'vault':
        this.initializeVault();
        break;
      case 'aws':
        this.initializeAwsSecretsManager();
        break;
      default:
        logger.warn(`Unknown secret backend: ${this.backend}, using environment`);
        this.loadFromEnvironment();
    }
  }

  /**
   * Load secrets from environment variables
   */
  loadFromEnvironment() {
    const secretKeys = [
      'JWT_SECRET',
      'SESSION_SECRET',
      'DB_PASSWORD',
      'REDIS_PASSWORD',
      'GITHUB_TOKEN',
      'GITHUB_WEBHOOK_SECRET',
      'SLACK_TOKEN',
      'SLACK_WEBHOOK_URL',
      'DATADOG_API_KEY',
      'DATADOG_APP_KEY'
    ];

    for (const key of secretKeys) {
      if (process.env[key]) {
        this.secrets.set(key, process.env[key]);
      }
    }

    logger.info('Secrets loaded from environment', {
      count: this.secrets.size,
      backend: 'env'
    });
  }

  /**
   * Load secrets from encrypted file
   */
  loadFromFile() {
    try {
      if (!existsSync(this.secretsFile)) {
        logger.warn('Secrets file not found, initializing empty');
        this.saveToFile();
        return;
      }

      const key = this.getEncryptionKey();
      const encrypted = readFileSync(this.secretsFile, 'utf8');
      const decrypted = this.decrypt(encrypted, key);
      const secrets = JSON.parse(decrypted);

      for (const [name, value] of Object.entries(secrets)) {
        this.secrets.set(name, value);
      }

      logger.info('Secrets loaded from file', {
        count: this.secrets.size,
        backend: 'file'
      });
    } catch (error) {
      logger.error('Failed to load secrets from file', { error: error.message });
      throw new Error('Secret loading failed');
    }
  }

  /**
   * Save secrets to encrypted file
   */
  saveToFile() {
    try {
      const dir = path.dirname(this.secretsFile);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const key = this.getEncryptionKey();
      const secrets = Object.fromEntries(this.secrets);
      const encrypted = this.encrypt(JSON.stringify(secrets), key);
      writeFileSync(this.secretsFile, encrypted, 'utf8');

      logger.info('Secrets saved to file', {
        count: this.secrets.size
      });
    } catch (error) {
      logger.error('Failed to save secrets to file', { error: error.message });
      throw error;
    }
  }

  /**
   * Get or generate encryption key
   */
  getEncryptionKey() {
    const dir = path.dirname(this.keyFile);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    if (!existsSync(this.keyFile)) {
      const key = crypto.randomBytes(32);
      writeFileSync(this.keyFile, key);
      logger.info('Generated new encryption key');
    }

    return readFileSync(this.keyFile);
  }

  /**
   * Encrypt data
   */
  encrypt(text, key) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return JSON.stringify({
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      encrypted
    });
  }

  /**
   * Decrypt data
   */
  decrypt(encryptedData, key) {
    const { iv, authTag, encrypted } = JSON.parse(encryptedData);

    const decipher = crypto.createDecipheriv(
      this.algorithm,
      key,
      Buffer.from(iv, 'hex')
    );

    decipher.setAuthTag(Buffer.from(authTag, 'hex'));

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Get a secret value
   */
  get(name, defaultValue = null) {
    const value = this.secrets.get(name);

    if (!value && defaultValue === null) {
      logger.warn(`Secret not found: ${name}`);
    }

    return value || defaultValue;
  }

  /**
   * Set a secret value
   */
  set(name, value) {
    const oldValue = this.secrets.get(name);
    this.secrets.set(name, value);

    if (this.backend === 'file') {
      this.saveToFile();
    }

    // Trigger rotation callbacks if value changed
    if (oldValue && oldValue !== value) {
      const callback = this.rotationCallbacks.get(name);
      if (callback) {
        callback(value, oldValue);
      }
    }

    logger.info(`Secret updated: ${name}`);
  }

  /**
   * Check if a secret exists
   */
  has(name) {
    return this.secrets.has(name);
  }

  /**
   * Delete a secret
   */
  delete(name) {
    const deleted = this.secrets.delete(name);

    if (deleted && this.backend === 'file') {
      this.saveToFile();
    }

    return deleted;
  }

  /**
   * Register callback for secret rotation
   */
  onRotation(name, callback) {
    this.rotationCallbacks.set(name, callback);
  }

  /**
   * Rotate a secret
   */
  async rotate(name, generator = null) {
    const newValue = generator ? await generator() : crypto.randomBytes(32).toString('hex');
    const oldValue = this.get(name);

    this.set(name, newValue);

    logger.info(`Secret rotated: ${name}`);

    return {
      name,
      rotated: true,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Validate all required secrets are present
   */
  validate(required = []) {
    const missing = [];

    for (const name of required) {
      if (!this.has(name)) {
        missing.push(name);
      }
    }

    if (missing.length > 0) {
      throw new Error(`Missing required secrets: ${missing.join(', ')}`);
    }

    return true;
  }

  /**
   * Initialize HashiCorp Vault backend
   */
  initializeVault() {
    // Placeholder for Vault integration
    logger.warn('Vault backend not yet implemented, falling back to environment');
    this.loadFromEnvironment();
  }

  /**
   * Initialize AWS Secrets Manager backend
   */
  initializeAwsSecretsManager() {
    // Placeholder for AWS Secrets Manager integration
    logger.warn('AWS Secrets Manager backend not yet implemented, falling back to environment');
    this.loadFromEnvironment();
  }

  /**
   * Export secrets (without values) for audit
   */
  export() {
    const secrets = {};

    for (const [name] of this.secrets) {
      secrets[name] = '***';
    }

    return {
      backend: this.backend,
      count: this.secrets.size,
      secrets
    };
  }
}

// Create singleton instance
const secretManager = new SecretManager();

// Validate required secrets in production
if (process.env.NODE_ENV === 'production') {
  try {
    secretManager.validate(['JWT_SECRET']);
  } catch (error) {
    logger.error('Secret validation failed', { error: error.message });
  }
}

export default secretManager;
export { SecretManager };