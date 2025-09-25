import Database from 'better-sqlite3';
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import crypto from 'crypto';
import logger from '../utils/logger.js';

/**
 * Database Migration System
 *
 * Manages database schema versioning and migrations for production deployments.
 */
export class MigrationRunner {
  constructor(config = {}) {
    this.config = {
      database: config.database || './.traversion/database.db',
      migrationsDir: config.migrationsDir || './migrations',
      tableName: config.tableName || 'schema_migrations',
      ...config
    };

    this.db = null;
    this.migrations = [];
  }

  /**
   * Initialize the migration system
   */
  async initialize() {
    try {
      // Ensure migrations directory exists
      if (!existsSync(this.config.migrationsDir)) {
        mkdirSync(this.config.migrationsDir, { recursive: true });
      }

      // Connect to database
      this.db = new Database(this.config.database);

      // Enable WAL mode for better concurrency
      this.db.pragma('journal_mode = WAL');

      // Create migrations table
      this.createMigrationsTable();

      // Load available migrations
      this.loadMigrations();

      logger.info('Migration system initialized', {
        database: this.config.database,
        migrationsAvailable: this.migrations.length
      });

    } catch (error) {
      logger.error('Failed to initialize migration system', { error: error.message });
      throw error;
    }
  }

  /**
   * Create migrations tracking table
   */
  createMigrationsTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.config.tableName} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        execution_time INTEGER,
        success BOOLEAN DEFAULT 1,
        error_message TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_migrations_version
        ON ${this.config.tableName}(version);
    `);
  }

  /**
   * Load available migrations from directory
   */
  loadMigrations() {
    const files = readdirSync(this.config.migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();

    this.migrations = files.map(file => {
      const filepath = join(this.config.migrationsDir, file);
      const content = readFileSync(filepath, 'utf8');
      const version = this.extractVersion(file);
      const name = this.extractName(file);

      return {
        version,
        name,
        filename: file,
        filepath,
        content,
        checksum: this.calculateChecksum(content)
      };
    });
  }

  /**
   * Extract version from filename (e.g., "001_create_tables.sql" -> "001")
   */
  extractVersion(filename) {
    const match = filename.match(/^(\d+)/);
    return match ? match[1].padStart(3, '0') : '000';
  }

  /**
   * Extract name from filename (e.g., "001_create_tables.sql" -> "create_tables")
   */
  extractName(filename) {
    const base = basename(filename, '.sql');
    const match = base.match(/^\d+[_-](.+)/);
    return match ? match[1] : base;
  }

  /**
   * Calculate checksum for migration content
   */
  calculateChecksum(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Get applied migrations
   */
  getAppliedMigrations() {
    const rows = this.db.prepare(`
      SELECT version, name, checksum, applied_at
      FROM ${this.config.tableName}
      WHERE success = 1
      ORDER BY version
    `).all();

    return rows;
  }

  /**
   * Get pending migrations
   */
  getPendingMigrations() {
    const applied = new Set(this.getAppliedMigrations().map(m => m.version));
    return this.migrations.filter(m => !applied.has(m.version));
  }

  /**
   * Run all pending migrations
   */
  async migrate() {
    const pending = this.getPendingMigrations();

    if (pending.length === 0) {
      logger.info('No pending migrations');
      return { migrated: 0, migrations: [] };
    }

    logger.info(`Running ${pending.length} pending migrations`);

    const migrated = [];
    let count = 0;

    for (const migration of pending) {
      try {
        await this.runMigration(migration);
        migrated.push(migration);
        count++;

        logger.info(`Migration completed: ${migration.version}_${migration.name}`);

      } catch (error) {
        logger.error(`Migration failed: ${migration.version}_${migration.name}`, {
          error: error.message
        });

        // Record failed migration
        this.recordMigration(migration, false, error.message);

        // Stop on first failure
        throw new Error(`Migration ${migration.version} failed: ${error.message}`);
      }
    }

    return { migrated: count, migrations: migrated };
  }

  /**
   * Run a single migration
   */
  async runMigration(migration) {
    const startTime = Date.now();

    logger.info(`Running migration: ${migration.version}_${migration.name}`);

    try {
      // Begin transaction
      this.db.exec('BEGIN TRANSACTION');

      // Execute migration
      this.db.exec(migration.content);

      // Record successful migration
      const executionTime = Date.now() - startTime;
      this.recordMigration(migration, true, null, executionTime);

      // Commit transaction
      this.db.exec('COMMIT');

      logger.info(`Migration applied successfully in ${executionTime}ms`);

    } catch (error) {
      // Rollback transaction
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * Record migration execution
   */
  recordMigration(migration, success, errorMessage = null, executionTime = null) {
    const stmt = this.db.prepare(`
      INSERT INTO ${this.config.tableName}
      (version, name, checksum, success, error_message, execution_time)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      migration.version,
      migration.name,
      migration.checksum,
      success ? 1 : 0,
      errorMessage,
      executionTime
    );
  }

  /**
   * Rollback the last migration
   */
  async rollback() {
    const applied = this.getAppliedMigrations();

    if (applied.length === 0) {
      logger.warn('No migrations to rollback');
      return null;
    }

    const lastMigration = applied[applied.length - 1];
    const migration = this.migrations.find(m => m.version === lastMigration.version);

    if (!migration) {
      throw new Error(`Migration ${lastMigration.version} not found in migrations directory`);
    }

    // Look for down migration
    const downMigrationFile = migration.filename.replace('.sql', '.down.sql');
    const downMigrationPath = join(this.config.migrationsDir, downMigrationFile);

    if (!existsSync(downMigrationPath)) {
      throw new Error(`Down migration not found: ${downMigrationFile}`);
    }

    const downContent = readFileSync(downMigrationPath, 'utf8');

    logger.info(`Rolling back migration: ${migration.version}_${migration.name}`);

    try {
      // Begin transaction
      this.db.exec('BEGIN TRANSACTION');

      // Execute down migration
      this.db.exec(downContent);

      // Remove migration record
      this.db.prepare(`
        DELETE FROM ${this.config.tableName}
        WHERE version = ?
      `).run(migration.version);

      // Commit transaction
      this.db.exec('COMMIT');

      logger.info('Migration rolled back successfully');

      return migration;

    } catch (error) {
      // Rollback transaction
      this.db.exec('ROLLBACK');
      logger.error('Failed to rollback migration', { error: error.message });
      throw error;
    }
  }

  /**
   * Get migration status
   */
  getStatus() {
    const applied = this.getAppliedMigrations();
    const pending = this.getPendingMigrations();

    return {
      current: applied.length > 0 ? applied[applied.length - 1] : null,
      applied: applied.length,
      pending: pending.length,
      total: this.migrations.length,
      migrations: {
        applied,
        pending
      }
    };
  }

  /**
   * Validate migrations
   */
  validate() {
    const errors = [];
    const applied = this.getAppliedMigrations();

    // Check for checksum mismatches
    for (const appliedMigration of applied) {
      const migration = this.migrations.find(m => m.version === appliedMigration.version);

      if (!migration) {
        errors.push(`Applied migration ${appliedMigration.version} not found in migrations directory`);
      } else if (migration.checksum !== appliedMigration.checksum) {
        errors.push(`Checksum mismatch for migration ${appliedMigration.version}`);
      }
    }

    // Check for version gaps
    const versions = this.migrations.map(m => m.version).sort();
    for (let i = 1; i < versions.length; i++) {
      const prev = parseInt(versions[i - 1]);
      const curr = parseInt(versions[i]);

      if (curr - prev > 1) {
        errors.push(`Version gap detected between ${versions[i - 1]} and ${versions[i]}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Create a new migration file
   */
  createMigration(name) {
    // Get next version number
    const lastVersion = this.migrations.length > 0
      ? parseInt(this.migrations[this.migrations.length - 1].version)
      : 0;

    const version = (lastVersion + 1).toString().padStart(3, '0');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `${version}_${name}.sql`;
    const filepath = join(this.config.migrationsDir, filename);

    const template = `-- Migration: ${version}_${name}
-- Created: ${new Date().toISOString()}
-- Description: ${name.replace(/_/g, ' ')}

-- Add your migration SQL here
`;

    const downTemplate = `-- Down Migration: ${version}_${name}
-- Created: ${new Date().toISOString()}
-- Description: Rollback ${name.replace(/_/g, ' ')}

-- Add your rollback SQL here
`;

    // Write migration files
    const fs = require('fs');
    fs.writeFileSync(filepath, template);
    fs.writeFileSync(filepath.replace('.sql', '.down.sql'), downTemplate);

    logger.info(`Created migration: ${filename}`);

    return {
      version,
      name,
      filename,
      filepath
    };
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

/**
 * Migration CLI interface
 */
export class MigrationCLI {
  constructor() {
    this.runner = new MigrationRunner();
  }

  async run(command, ...args) {
    try {
      await this.runner.initialize();

      switch (command) {
        case 'migrate':
          return await this.migrate();

        case 'rollback':
          return await this.rollback();

        case 'status':
          return await this.status();

        case 'create':
          return await this.create(args[0]);

        case 'validate':
          return await this.validate();

        default:
          throw new Error(`Unknown command: ${command}`);
      }

    } finally {
      this.runner.close();
    }
  }

  async migrate() {
    const result = await this.runner.migrate();
    console.log(`✓ ${result.migrated} migrations applied`);

    if (result.migrated > 0) {
      result.migrations.forEach(m => {
        console.log(`  - ${m.version}_${m.name}`);
      });
    }

    return result;
  }

  async rollback() {
    const migration = await this.runner.rollback();

    if (migration) {
      console.log(`✓ Rolled back migration: ${migration.version}_${migration.name}`);
    } else {
      console.log('No migrations to rollback');
    }

    return migration;
  }

  async status() {
    const status = this.runner.getStatus();

    console.log('\nMigration Status');
    console.log('================');
    console.log(`Current version: ${status.current ? status.current.version : 'none'}`);
    console.log(`Applied: ${status.applied}`);
    console.log(`Pending: ${status.pending}`);
    console.log(`Total: ${status.total}`);

    if (status.pending > 0) {
      console.log('\nPending migrations:');
      status.migrations.pending.forEach(m => {
        console.log(`  - ${m.version}_${m.name}`);
      });
    }

    return status;
  }

  async create(name) {
    if (!name) {
      throw new Error('Migration name is required');
    }

    const migration = this.runner.createMigration(name);
    console.log(`✓ Created migration: ${migration.filename}`);

    return migration;
  }

  async validate() {
    const result = this.runner.validate();

    if (result.valid) {
      console.log('✓ All migrations are valid');
    } else {
      console.log('✗ Migration validation failed:');
      result.errors.forEach(error => {
        console.log(`  - ${error}`);
      });
    }

    return result;
  }
}

export default MigrationRunner;