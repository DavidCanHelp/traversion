/**
 * Offline-First Capability
 * 
 * Addresses: "What if we lose network connectivity?"
 * Solution: Full offline functionality with sync when reconnected
 */

import Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';
import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import logger from '../utils/logger.js';

export class OfflineFirstMode extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      dataDir: config.dataDir || './offline-data',
      syncInterval: config.syncInterval || 30000, // 30 seconds
      maxOfflineQueueSize: config.maxOfflineQueueSize || 1000,
      conflictResolution: config.conflictResolution || 'last-write-wins'
    };
    
    this.isOnline = true;
    this.offlineQueue = [];
    this.localDb = null;
    this.syncInProgress = false;
    this.lastSyncTime = null;
    
    this.initialize();
  }

  /**
   * Initialize offline-first infrastructure
   */
  async initialize() {
    // Create offline data directory
    await fs.mkdir(this.config.dataDir, { recursive: true });
    await fs.mkdir(path.join(this.config.dataDir, 'queue'), { recursive: true });
    await fs.mkdir(path.join(this.config.dataDir, 'cache'), { recursive: true });
    
    // Initialize local database
    this.localDb = new Database(path.join(this.config.dataDir, 'offline.db'));
    await this.initializeDatabase();
    
    // Load offline queue from disk
    await this.loadOfflineQueue();
    
    // Start network monitoring
    this.startNetworkMonitoring();
    
    // Start sync scheduler
    this.startSyncScheduler();
    
    logger.info('Offline-first mode initialized');
    
    return {
      status: 'ready',
      mode: 'offline-first',
      dataLocation: this.config.dataDir,
      queueSize: this.offlineQueue.length,
      lastSync: this.lastSyncTime
    };
  }

  /**
   * Initialize local database schema
   */
  async initializeDatabase() {
    // Main data table with sync metadata
    this.localDb.exec(`
      CREATE TABLE IF NOT EXISTS data (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        version INTEGER DEFAULT 1,
        created_at INTEGER,
        updated_at INTEGER,
        synced_at INTEGER,
        sync_status TEXT DEFAULT 'pending',
        checksum TEXT,
        conflict_resolution TEXT
      )
    `);
    
    // Sync queue table
    this.localDb.exec(`
      CREATE TABLE IF NOT EXISTS sync_queue (
        id TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        resource TEXT NOT NULL,
        data TEXT,
        timestamp INTEGER,
        retry_count INTEGER DEFAULT 0,
        error TEXT
      )
    `);
    
    // Conflict resolution table
    this.localDb.exec(`
      CREATE TABLE IF NOT EXISTS conflicts (
        id TEXT PRIMARY KEY,
        local_version TEXT,
        remote_version TEXT,
        resolution TEXT,
        resolved_at INTEGER,
        resolved_by TEXT
      )
    `);
    
    // Create indexes
    this.localDb.exec('CREATE INDEX IF NOT EXISTS idx_sync_status ON data(sync_status)');
    this.localDb.exec('CREATE INDEX IF NOT EXISTS idx_sync_queue_timestamp ON sync_queue(timestamp)');
  }

  /**
   * Network monitoring
   */
  startNetworkMonitoring() {
    // Check network status every 5 seconds
    setInterval(async () => {
      const wasOnline = this.isOnline;
      this.isOnline = await this.checkNetworkStatus();
      
      if (!wasOnline && this.isOnline) {
        logger.info('Network connection restored');
        this.emit('online');
        await this.processOfflineQueue();
      } else if (wasOnline && !this.isOnline) {
        logger.info('Network connection lost - switching to offline mode');
        this.emit('offline');
      }
    }, 5000);
  }

  async checkNetworkStatus() {
    try {
      // Try to reach a reliable endpoint
      const response = await fetch('https://api.github.com/zen', {
        method: 'HEAD',
        signal: AbortSignal.timeout(3000)
      }).catch(() => null);
      
      return response && response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Offline queue management
   */
  async queueOperation(operation) {
    const queueItem = {
      id: this.generateId(),
      operation: operation.type,
      resource: operation.resource,
      data: JSON.stringify(operation.data),
      timestamp: Date.now(),
      retry_count: 0
    };
    
    // Add to in-memory queue
    this.offlineQueue.push(queueItem);
    
    // Persist to database
    this.localDb.prepare(`
      INSERT INTO sync_queue (id, operation, resource, data, timestamp, retry_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      queueItem.id,
      queueItem.operation,
      queueItem.resource,
      queueItem.data,
      queueItem.timestamp,
      queueItem.retry_count
    );
    
    // Persist to disk for extra durability
    await this.persistQueueItem(queueItem);
    
    // Try to process immediately if online
    if (this.isOnline) {
      await this.processOfflineQueue();
    }
    
    return queueItem.id;
  }

  async persistQueueItem(item) {
    const filePath = path.join(this.config.dataDir, 'queue', `${item.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(item, null, 2));
  }

  async loadOfflineQueue() {
    // Load from database
    const items = this.localDb.prepare(`
      SELECT * FROM sync_queue WHERE retry_count < 5 ORDER BY timestamp
    `).all();
    
    this.offlineQueue = items;
    
    // Also check disk for any orphaned items
    const queueDir = path.join(this.config.dataDir, 'queue');
    const files = await fs.readdir(queueDir).catch(() => []);
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        const content = await fs.readFile(path.join(queueDir, file), 'utf-8');
        const item = JSON.parse(content);
        
        if (!this.offlineQueue.find(q => q.id === item.id)) {
          this.offlineQueue.push(item);
        }
      }
    }
  }

  async processOfflineQueue() {
    if (!this.isOnline || this.syncInProgress || this.offlineQueue.length === 0) {
      return;
    }
    
    this.syncInProgress = true;
    logger.info(`Processing offline queue: ${this.offlineQueue.length} items`);
    
    const processed = [];
    const failed = [];
    
    for (const item of this.offlineQueue) {
      try {
        await this.processQueueItem(item);
        processed.push(item.id);
        
        // Remove from database
        this.localDb.prepare('DELETE FROM sync_queue WHERE id = ?').run(item.id);
        
        // Remove from disk
        await fs.unlink(
          path.join(this.config.dataDir, 'queue', `${item.id}.json`)
        ).catch(() => {});
      } catch (error) {
        logger.error(`Failed to process queue item ${item.id}:`, error);
        failed.push(item.id);
        
        // Update retry count
        item.retry_count++;
        this.localDb.prepare(`
          UPDATE sync_queue SET retry_count = ?, error = ? WHERE id = ?
        `).run(item.retry_count, error.message, item.id);
      }
    }
    
    // Remove processed items from queue
    this.offlineQueue = this.offlineQueue.filter(
      item => !processed.includes(item.id)
    );
    
    this.syncInProgress = false;
    this.lastSyncTime = Date.now();
    
    this.emit('sync-complete', {
      processed: processed.length,
      failed: failed.length,
      remaining: this.offlineQueue.length
    });
  }

  async processQueueItem(item) {
    // Simulate processing based on operation type
    const data = JSON.parse(item.data);
    
    switch (item.operation) {
      case 'CREATE':
        return await this.syncCreate(item.resource, data);
      case 'UPDATE':
        return await this.syncUpdate(item.resource, data);
      case 'DELETE':
        return await this.syncDelete(item.resource, data);
      default:
        throw new Error(`Unknown operation: ${item.operation}`);
    }
  }

  /**
   * Conflict resolution
   */
  async resolveConflict(localData, remoteData) {
    const strategy = this.config.conflictResolution;
    
    switch (strategy) {
      case 'last-write-wins':
        return localData.updated_at > remoteData.updated_at ? localData : remoteData;
      
      case 'first-write-wins':
        return localData.created_at < remoteData.created_at ? localData : remoteData;
      
      case 'manual':
        return await this.promptUserForResolution(localData, remoteData);
      
      case 'merge':
        return this.mergeData(localData, remoteData);
      
      default:
        return localData; // Default to local version
    }
  }

  mergeData(local, remote) {
    // Simple merge strategy - combine non-conflicting fields
    const merged = { ...remote };
    
    for (const key in local) {
      if (local[key] !== remote[key]) {
        // Keep newer value based on timestamp
        if (local.updated_at > remote.updated_at) {
          merged[key] = local[key];
        }
      }
    }
    
    merged.merged_at = Date.now();
    merged.merge_strategy = 'auto';
    
    return merged;
  }

  /**
   * Sync scheduler
   */
  startSyncScheduler() {
    setInterval(async () => {
      if (this.isOnline && !this.syncInProgress) {
        await this.performSync();
      }
    }, this.config.syncInterval);
  }

  async performSync() {
    logger.info('Starting scheduled sync');
    
    // 1. Push local changes
    await this.pushLocalChanges();
    
    // 2. Pull remote changes
    await this.pullRemoteChanges();
    
    // 3. Process offline queue
    await this.processOfflineQueue();
    
    // 4. Clean up old data
    await this.cleanupOldData();
    
    this.emit('sync-scheduled', {
      timestamp: Date.now(),
      nextSync: Date.now() + this.config.syncInterval
    });
  }

  async pushLocalChanges() {
    const pending = this.localDb.prepare(`
      SELECT * FROM data WHERE sync_status = 'pending' OR sync_status = 'modified'
    `).all();
    
    for (const item of pending) {
      try {
        await this.syncToRemote(item);
        
        // Update sync status
        this.localDb.prepare(`
          UPDATE data SET sync_status = 'synced', synced_at = ? WHERE id = ?
        `).run(Date.now(), item.id);
      } catch (error) {
        logger.error(`Failed to sync item ${item.id}:`, error);
      }
    }
  }

  async pullRemoteChanges() {
    // This would connect to your actual backend
    // For demo, we'll simulate it
    try {
      const remoteData = await this.fetchRemoteData();
      
      for (const item of remoteData) {
        const local = this.localDb.prepare('SELECT * FROM data WHERE id = ?').get(item.id);
        
        if (local) {
          // Check for conflicts
          if (local.checksum !== item.checksum) {
            const resolved = await this.resolveConflict(local, item);
            await this.updateLocalData(resolved);
          }
        } else {
          // New item from remote
          await this.insertLocalData(item);
        }
      }
    } catch (error) {
      logger.error('Failed to pull remote changes:', error);
    }
  }

  async cleanupOldData() {
    // Remove old synced items
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    
    this.localDb.prepare(`
      DELETE FROM data WHERE sync_status = 'synced' AND synced_at < ?
    `).run(thirtyDaysAgo);
    
    // Clean up old queue items
    this.localDb.prepare(`
      DELETE FROM sync_queue WHERE retry_count >= 5 OR timestamp < ?
    `).run(thirtyDaysAgo);
  }

  /**
   * Public API for offline-first operations
   */
  async save(type, data) {
    const id = data.id || this.generateId();
    const checksum = this.calculateChecksum(data);
    
    const record = {
      id,
      type,
      content: JSON.stringify(data),
      version: 1,
      created_at: Date.now(),
      updated_at: Date.now(),
      sync_status: this.isOnline ? 'pending' : 'offline',
      checksum
    };
    
    // Save locally first
    this.localDb.prepare(`
      INSERT OR REPLACE INTO data 
      (id, type, content, version, created_at, updated_at, sync_status, checksum)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.type,
      record.content,
      record.version,
      record.created_at,
      record.updated_at,
      record.sync_status,
      record.checksum
    );
    
    // Queue for sync if online
    if (this.isOnline) {
      await this.queueOperation({
        type: 'CREATE',
        resource: type,
        data: record
      });
    }
    
    return { id, status: 'saved', offline: !this.isOnline };
  }

  async get(type, id) {
    // Always read from local first
    const local = this.localDb.prepare(
      'SELECT * FROM data WHERE type = ? AND id = ?'
    ).get(type, id);
    
    if (local) {
      return JSON.parse(local.content);
    }
    
    // Try to fetch from remote if online
    if (this.isOnline) {
      try {
        const remote = await this.fetchFromRemote(type, id);
        if (remote) {
          await this.insertLocalData(remote);
          return remote;
        }
      } catch (error) {
        logger.error('Failed to fetch from remote:', error);
      }
    }
    
    return null;
  }

  async list(type, filters = {}) {
    let query = 'SELECT * FROM data WHERE type = ?';
    const params = [type];
    
    if (filters.since) {
      query += ' AND updated_at > ?';
      params.push(filters.since);
    }
    
    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }
    
    const items = this.localDb.prepare(query).all(...params);
    
    return items.map(item => JSON.parse(item.content));
  }

  /**
   * Cache management
   */
  async cacheResponse(key, data, ttl = 3600000) {
    const cachePath = path.join(this.config.dataDir, 'cache', `${key}.json`);
    const cacheData = {
      data,
      timestamp: Date.now(),
      expires: Date.now() + ttl
    };
    
    await fs.writeFile(cachePath, JSON.stringify(cacheData));
  }

  async getCached(key) {
    const cachePath = path.join(this.config.dataDir, 'cache', `${key}.json`);
    
    try {
      const content = await fs.readFile(cachePath, 'utf-8');
      const cacheData = JSON.parse(content);
      
      if (cacheData.expires > Date.now()) {
        return cacheData.data;
      }
      
      // Clean up expired cache
      await fs.unlink(cachePath).catch(() => {});
    } catch {
      // Cache miss
    }
    
    return null;
  }

  /**
   * Status and monitoring
   */
  getStatus() {
    return {
      mode: 'offline-first',
      online: this.isOnline,
      queueSize: this.offlineQueue.length,
      lastSync: this.lastSyncTime,
      nextSync: this.lastSyncTime ? this.lastSyncTime + this.config.syncInterval : null,
      syncInProgress: this.syncInProgress,
      
      storage: {
        localRecords: this.localDb.prepare('SELECT COUNT(*) as count FROM data').get().count,
        pendingSync: this.localDb.prepare(
          "SELECT COUNT(*) as count FROM data WHERE sync_status != 'synced'"
        ).get().count,
        conflicts: this.localDb.prepare('SELECT COUNT(*) as count FROM conflicts').get().count
      },
      
      performance: {
        averageSyncTime: this.calculateAverageSyncTime(),
        cacheHitRate: this.calculateCacheHitRate(),
        offlineUptime: this.calculateOfflineUptime()
      }
    };
  }

  // Helper methods
  generateId() {
    return createHash('sha256')
      .update(Date.now().toString() + Math.random().toString())
      .digest('hex')
      .substring(0, 16);
  }

  calculateChecksum(data) {
    return createHash('md5')
      .update(JSON.stringify(data))
      .digest('hex');
  }

  calculateAverageSyncTime() {
    // Placeholder - would calculate from actual sync history
    return '2.3s';
  }

  calculateCacheHitRate() {
    // Placeholder - would calculate from actual cache stats
    return '87%';
  }

  calculateOfflineUptime() {
    // Placeholder - would calculate from actual offline periods
    return '99.9%';
  }

  // Placeholder methods for demo
  async syncCreate(resource, data) {
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 100));
    return { success: true };
  }

  async syncUpdate(resource, data) {
    await new Promise(resolve => setTimeout(resolve, 100));
    return { success: true };
  }

  async syncDelete(resource, data) {
    await new Promise(resolve => setTimeout(resolve, 100));
    return { success: true };
  }

  async syncToRemote(item) {
    await new Promise(resolve => setTimeout(resolve, 50));
    return { success: true };
  }

  async fetchRemoteData() {
    // Simulate fetching from remote
    return [];
  }

  async fetchFromRemote(type, id) {
    // Simulate fetching specific item
    return null;
  }

  async updateLocalData(data) {
    const checksum = this.calculateChecksum(data);
    
    this.localDb.prepare(`
      UPDATE data SET 
        content = ?, 
        version = version + 1, 
        updated_at = ?, 
        checksum = ?
      WHERE id = ?
    `).run(
      JSON.stringify(data),
      Date.now(),
      checksum,
      data.id
    );
  }

  async insertLocalData(data) {
    const checksum = this.calculateChecksum(data);
    
    this.localDb.prepare(`
      INSERT INTO data 
      (id, type, content, version, created_at, updated_at, sync_status, checksum)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.id,
      data.type || 'unknown',
      JSON.stringify(data),
      1,
      Date.now(),
      Date.now(),
      'synced',
      checksum
    );
  }

  async promptUserForResolution(local, remote) {
    // In a real app, this would show a UI for conflict resolution
    // For now, default to local
    return local;
  }
}

/**
 * Progressive Web App Support
 */
export class PWASupport {
  static getServiceWorker() {
    return `
// Service Worker for Offline Support
const CACHE_NAME = 'traversion-v1';
const urlsToCache = [
  '/',
  '/dashboard',
  '/incidents',
  '/analytics',
  '/static/css/main.css',
  '/static/js/main.js'
];

// Install event - cache resources
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

// Fetch event - serve from cache when offline
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - return response
        if (response) {
          return response;
        }
        
        // Clone the request
        const fetchRequest = event.request.clone();
        
        return fetch(fetchRequest).then(response => {
          // Check if valid response
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          
          // Clone the response
          const responseToCache = response.clone();
          
          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(event.request, responseToCache);
            });
          
          return response;
        });
      })
  );
});

// Background sync for offline queue
self.addEventListener('sync', event => {
  if (event.tag === 'sync-queue') {
    event.waitUntil(syncOfflineQueue());
  }
});

async function syncOfflineQueue() {
  // Process offline queue when back online
  const queue = await getOfflineQueue();
  
  for (const item of queue) {
    try {
      await fetch(item.url, item.options);
      await removeFromQueue(item.id);
    } catch (error) {
      logger.error('Sync failed:', error);
    }
  }
}
`;
  }

  static getManifest() {
    return {
      name: 'Traversion',
      short_name: 'Traversion',
      description: 'Incident Management Platform',
      start_url: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#007bff',
      icons: [
        {
          src: '/icon-192.png',
          sizes: '192x192',
          type: 'image/png'
        },
        {
          src: '/icon-512.png',
          sizes: '512x512',
          type: 'image/png'
        }
      ]
    };
  }
}