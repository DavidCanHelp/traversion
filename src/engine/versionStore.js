import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import * as diff from 'diff';
import path from 'path';
import logger from '../utils/logger.js';

export class VersionStore {
  constructor(dbPath = '.traversion/versions.db') {
    try {
      this.db = new Database(dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      this.initDB();
      this.sessions = new Map();
      this.currentSessionId = this.createSession();
      logger.info('VersionStore initialized', { dbPath });
    } catch (error) {
      logger.error('Failed to initialize VersionStore', { error: error.message, dbPath });
      throw error;
    }
  }

  initDB() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        end_time DATETIME,
        description TEXT,
        vibe TEXT
      );

      CREATE TABLE IF NOT EXISTS versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER,
        file_path TEXT NOT NULL,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        event_type TEXT,
        output TEXT,
        error TEXT,
        performance_metrics TEXT,
        vibe_tags TEXT,
        branch_id TEXT,
        parent_version_id INTEGER,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS branches (
        id TEXT PRIMARY KEY,
        name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        parent_branch_id TEXT,
        diverged_at_version_id INTEGER,
        description TEXT,
        vibe TEXT
      );

      CREATE TABLE IF NOT EXISTS comparisons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version_a_id INTEGER,
        version_b_id INTEGER,
        diff_data TEXT,
        similarity_score REAL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (version_a_id) REFERENCES versions(id),
        FOREIGN KEY (version_b_id) REFERENCES versions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_versions_timestamp ON versions(timestamp);
      CREATE INDEX IF NOT EXISTS idx_versions_file ON versions(file_path);
      CREATE INDEX IF NOT EXISTS idx_versions_session ON versions(session_id);
      CREATE INDEX IF NOT EXISTS idx_versions_hash ON versions(content_hash);
    `);
  }

  createSession(description = 'Vibe coding session') {
    const result = this.db.prepare(
      'INSERT INTO sessions (description) VALUES (?)'
    ).run(description);
    return result.lastInsertRowid;
  }

  saveVersion(filePath, content, metadata = {}) {
    const timer = logger.startTimer('saveVersion');
    
    try {
      const contentHash = this.hashContent(content);
      
      // Check if this exact version already exists
      const existing = this.db.prepare(
        'SELECT id FROM versions WHERE content_hash = ? AND file_path = ? ORDER BY timestamp DESC LIMIT 1'
      ).get(contentHash, filePath);

      if (existing && !metadata.force) {
        logger.debug('Version already exists, skipping save', { filePath, versionId: existing.id });
        return existing.id;
      }

    const stmt = this.db.prepare(`
      INSERT INTO versions (
        session_id, file_path, content, content_hash,
        event_type, output, error, performance_metrics,
        vibe_tags, branch_id, parent_version_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

      const result = stmt.run(
        this.currentSessionId,
        filePath,
        content,
        contentHash,
        metadata.eventType || 'save',
        metadata.output || null,
        metadata.error || null,
        JSON.stringify(metadata.performance || {}),
        JSON.stringify(metadata.vibeTags || []),
        metadata.branchId || 'main',
        metadata.parentVersionId || this.getLatestVersion(filePath)?.id || null
      );

      logger.endTimer(timer);
      logger.debug('Version saved', { filePath, versionId: result.lastInsertRowid });
      return result.lastInsertRowid;
    } catch (error) {
      logger.error('Failed to save version', { error: error.message, filePath });
      throw error;
    }
  }

  getVersion(versionId) {
    return this.db.prepare('SELECT * FROM versions WHERE id = ?').get(versionId);
  }

  getLatestVersion(filePath) {
    return this.db.prepare(
      'SELECT * FROM versions WHERE file_path = ? ORDER BY timestamp DESC LIMIT 1'
    ).get(filePath);
  }

  getVersionsInTimeRange(startTime, endTime, filePath = null) {
    let query = 'SELECT * FROM versions WHERE timestamp BETWEEN ? AND ?';
    const params = [startTime, endTime];
    
    if (filePath) {
      query += ' AND file_path = ?';
      params.push(filePath);
    }
    
    query += ' ORDER BY timestamp ASC';
    return this.db.prepare(query).all(...params);
  }

  getSessionVersions(sessionId = this.currentSessionId) {
    return this.db.prepare(
      'SELECT * FROM versions WHERE session_id = ? ORDER BY timestamp ASC'
    ).all(sessionId);
  }

  getSessionCount() {
    const result = this.db.prepare('SELECT COUNT(*) as count FROM sessions').get();
    return result.count;
  }

  createBranch(name, description = '', parentVersionId = null) {
    const branchId = this.generateBranchId();
    
    this.db.prepare(`
      INSERT INTO branches (id, name, description, diverged_at_version_id)
      VALUES (?, ?, ?, ?)
    `).run(branchId, name, description, parentVersionId);
    
    return branchId;
  }

  compareVersions(versionAId, versionBId) {
    try {
      const versionA = this.getVersion(versionAId);
      const versionB = this.getVersion(versionBId);
      
      if (!versionA || !versionB) {
        logger.warn('Version not found for comparison', { versionAId, versionBId });
        throw new Error('Version not found');
      }

    const changes = diff.diffLines(versionA.content, versionB.content);
    const similarity = this.calculateSimilarity(versionA.content, versionB.content);
    
    const stmt = this.db.prepare(`
      INSERT INTO comparisons (version_a_id, version_b_id, diff_data, similarity_score)
      VALUES (?, ?, ?, ?)
    `);
    
      stmt.run(versionAId, versionBId, JSON.stringify(changes), similarity);
      
      logger.debug('Versions compared', { versionAId, versionBId, similarity });
      
      return {
        changes,
        similarity,
        versionA,
        versionB
      };
    } catch (error) {
      logger.error('Failed to compare versions', { error: error.message, versionAId, versionBId });
      throw error;
    }
  }

  searchByVibe(vibeDescription) {
    // This is where we'd integrate AI for vibe matching
    // For now, simple tag matching
    return this.db.prepare(`
      SELECT * FROM versions 
      WHERE vibe_tags LIKE ? 
      ORDER BY timestamp DESC 
      LIMIT 20
    `).all(`%${vibeDescription}%`);
  }

  findSimilarVersions(versionId, threshold = 0.8) {
    const version = this.getVersion(versionId);
    if (!version) return [];

    const allVersions = this.db.prepare(
      'SELECT * FROM versions WHERE file_path = ? AND id != ?'
    ).all(version.file_path, versionId);

    return allVersions
      .map(v => ({
        ...v,
        similarity: this.calculateSimilarity(version.content, v.content)
      }))
      .filter(v => v.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity);
  }

  getTimeline(filePath = null) {
    let query = `
      SELECT v.*, s.description as session_description
      FROM versions v
      JOIN sessions s ON v.session_id = s.id
    `;
    
    if (filePath) {
      query += ' WHERE v.file_path = ?';
    }
    
    query += ' ORDER BY v.timestamp ASC';
    
    return filePath 
      ? this.db.prepare(query).all(filePath)
      : this.db.prepare(query).all();
  }

  // Helper methods
  hashContent(content) {
    return createHash('sha256').update(content).digest('hex');
  }

  generateBranchId() {
    return `branch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  calculateSimilarity(textA, textB) {
    const changes = diff.diffChars(textA, textB);
    const totalLength = Math.max(textA.length, textB.length);
    const changedLength = changes
      .filter(change => change.added || change.removed)
      .reduce((sum, change) => sum + change.value.length, 0);
    
    return 1 - (changedLength / totalLength);
  }

  // Cleanup
  close() {
    try {
      this.db.close();
      logger.info('VersionStore closed');
    } catch (error) {
      logger.error('Error closing VersionStore', { error: error.message });
    }
  }
}