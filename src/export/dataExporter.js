/**
 * Data Exporter for Traversion Production Platform
 * 
 * Handles real-time data export, streaming exports, and API-based data access.
 * Supports multiple formats and destinations with rate limiting and filtering.
 */

import { EventEmitter } from 'events';
import { Transform, pipeline } from 'stream';
import { createWriteStream } from 'fs';
import path from 'path';

class DataExporter extends EventEmitter {
  constructor(storage, options = {}) {
    super();
    
    this.storage = storage;
    this.options = {
      defaultLimit: options.defaultLimit || 10000,
      maxLimit: options.maxLimit || 100000,
      rateLimitRpm: options.rateLimitRpm || 60, // requests per minute
      streamChunkSize: options.streamChunkSize || 1000,
      exportDir: options.exportDir || './exports',
      allowedFormats: options.allowedFormats || ['json', 'csv', 'ndjson', 'xml'],
      compressionFormats: options.compressionFormats || ['gzip', 'brotli'],
      maxConcurrentExports: options.maxConcurrentExports || 5,
      ...options
    };
    
    this.activeExports = new Map();
    this.rateLimiter = new Map(); // Track requests per tenant
    
    // Clean up rate limiter every minute
    setInterval(() => {
      this._cleanupRateLimiter();
    }, 60000);
  }
  
  // Main export method - supports various export types
  async exportData(tenantId, query, options = {}) {
    const exportId = `export_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Check rate limits
    if (!this._checkRateLimit(tenantId)) {
      throw new Error('Rate limit exceeded. Please wait before making another request.');
    }
    
    // Validate and prepare export options
    const exportOptions = this._validateExportOptions({
      id: exportId,
      tenantId,
      query,
      format: options.format || 'json',
      compression: options.compression || null,
      limit: Math.min(options.limit || this.options.defaultLimit, this.options.maxLimit),
      offset: options.offset || 0,
      sortBy: options.sortBy || 'timestamp',
      sortOrder: options.sortOrder || 'DESC',
      filters: options.filters || {},
      fields: options.fields || null, // null = all fields
      streaming: options.streaming || false,
      destination: options.destination || 'response', // 'response', 'file', 'webhook'
      webhookUrl: options.webhookUrl || null,
      filename: options.filename || `export_${exportId}`,
      includeMetadata: options.includeMetadata !== false,
      ...options
    });
    
    try {
      this.activeExports.set(exportId, {
        status: 'running',
        startedAt: new Date(),
        progress: 0,
        options: exportOptions
      });
      
      this.emit('export:started', { id: exportId, options: exportOptions });
      
      let result;
      
      if (exportOptions.streaming) {
        result = await this._streamingExport(exportOptions);
      } else {
        result = await this._batchExport(exportOptions);
      }
      
      this.activeExports.set(exportId, {
        status: 'completed',
        startedAt: this.activeExports.get(exportId).startedAt,
        completedAt: new Date(),
        result,
        options: exportOptions
      });
      
      this.emit('export:completed', { id: exportId, result });
      
      return result;
      
    } catch (error) {
      this.activeExports.set(exportId, {
        status: 'failed',
        startedAt: this.activeExports.get(exportId).startedAt,
        failedAt: new Date(),
        error: error.message,
        options: exportOptions
      });
      
      this.emit('export:failed', { id: exportId, error });
      throw error;
    }
  }
  
  _validateExportOptions(options) {
    // Validate format
    if (!this.options.allowedFormats.includes(options.format)) {
      throw new Error(`Unsupported format: ${options.format}. Allowed: ${this.options.allowedFormats.join(', ')}`);
    }
    
    // Validate compression
    if (options.compression && !this.options.compressionFormats.includes(options.compression)) {
      throw new Error(`Unsupported compression: ${options.compression}`);
    }
    
    // Validate webhook URL
    if (options.destination === 'webhook' && !options.webhookUrl) {
      throw new Error('Webhook URL required for webhook destination');
    }
    
    // Validate query structure
    if (!options.query || typeof options.query !== 'object') {
      throw new Error('Query object is required');
    }
    
    return options;
  }
  
  async _batchExport(options) {
    const { tenantId, query, limit, offset, format } = options;
    
    // Build SQL query
    const sqlQuery = this._buildSQLQuery(query, { tenantId, limit, offset, ...options });
    
    // Execute query
    const result = await this.storage.query(sqlQuery.sql, sqlQuery.params);
    
    // Process and format results
    let processedData = this._processResults(result.rows, options);
    
    // Apply field selection
    if (options.fields) {
      processedData = this._selectFields(processedData, options.fields);
    }
    
    // Format data
    const formattedData = await this._formatData(processedData, format, options);
    
    // Handle destination
    switch (options.destination) {
      case 'response':
        return {
          data: formattedData,
          metadata: this._createMetadata(processedData, options),
          exportId: options.id
        };
        
      case 'file':
        const filepath = await this._saveToFile(formattedData, options);
        return {
          filepath,
          metadata: this._createMetadata(processedData, options),
          exportId: options.id
        };
        
      case 'webhook':
        await this._sendToWebhook(formattedData, options);
        return {
          webhookUrl: options.webhookUrl,
          sent: true,
          metadata: this._createMetadata(processedData, options),
          exportId: options.id
        };
        
      default:
        throw new Error(`Unsupported destination: ${options.destination}`);
    }
  }
  
  async _streamingExport(options) {
    const { tenantId, query, format } = options;
    
    return new Promise((resolve, reject) => {
      const exportStream = this.createExportStream(tenantId, query, {
        ...options,
        onComplete: (stats) => resolve({
          stream: true,
          stats,
          exportId: options.id
        }),
        onError: reject
      });
      
      // Handle different streaming destinations
      if (options.destination === 'file') {
        const filepath = path.join(this.options.exportDir, `${options.filename}.${format}`);
        const fileStream = createWriteStream(filepath);
        
        pipeline(exportStream, fileStream, (error) => {
          if (error) reject(error);
        });
      }
    });
  }
  
  // Create readable stream for large exports
  createExportStream(tenantId, query, options = {}) {
    const chunkSize = options.chunkSize || this.options.streamChunkSize;
    const format = options.format || 'ndjson';
    
    let offset = 0;
    let hasMore = true;
    let isFirstChunk = true;
    
    const exportStream = new Transform({
      objectMode: false,
      async transform(chunk, encoding, callback) {
        try {
          if (!hasMore) {
            this.push(null); // End stream
            return callback();
          }
          
          // Build query for this chunk
          const sqlQuery = this._buildSQLQuery(query, {
            tenantId,
            limit: chunkSize,
            offset,
            ...options
          });
          
          // Execute query
          const result = await this.storage.query(sqlQuery.sql, sqlQuery.params);
          
          if (result.rows.length === 0) {
            hasMore = false;
            
            // Close format-specific structures
            if (format === 'json' && !isFirstChunk) {
              this.push(']');
            }
            
            this.push(null); // End stream
            
            if (options.onComplete) {
              options.onComplete({
                totalRecords: offset,
                format
              });
            }
            
            return callback();
          }
          
          // Process results
          let processedData = this._processResults(result.rows, options);
          
          // Apply field selection
          if (options.fields) {
            processedData = this._selectFields(processedData, options.fields);
          }
          
          // Format for streaming
          const formattedChunk = this._formatStreamingChunk(
            processedData, 
            format, 
            isFirstChunk,
            result.rows.length < chunkSize // is last chunk
          );
          
          this.push(formattedChunk);
          
          offset += result.rows.length;
          isFirstChunk = false;
          
          if (result.rows.length < chunkSize) {
            hasMore = false;
          }
          
          callback();
          
        } catch (error) {
          if (options.onError) {
            options.onError(error);
          }
          callback(error);
        }
      }.bind(this),
    });
    
    // Start the stream
    exportStream.write('start');
    
    return exportStream;
  }
  
  _buildSQLQuery(query, options) {
    const { tenantId, limit, offset, sortBy, sortOrder } = options;
    
    // Base query building
    let sql = '';
    const params = [];
    let paramIndex = 1;
    
    // Handle different query types
    if (query.table) {
      // Table-based query
      sql = `SELECT * FROM ${query.table}`;
      
      // Add WHERE conditions
      const conditions = [`tenant_id = $${paramIndex++}`];
      params.push(tenantId);
      
      // Add time range
      if (query.startTime) {
        conditions.push(`timestamp >= $${paramIndex++}`);
        params.push(new Date(query.startTime));
      }
      
      if (query.endTime) {
        conditions.push(`timestamp <= $${paramIndex++}`);
        params.push(new Date(query.endTime));
      }
      
      // Add custom filters
      if (query.filters) {
        for (const [field, value] of Object.entries(query.filters)) {
          if (Array.isArray(value)) {
            // IN clause
            const placeholders = value.map(() => `$${paramIndex++}`).join(',');
            conditions.push(`${field} IN (${placeholders})`);
            params.push(...value);
          } else if (typeof value === 'object' && value.operator) {
            // Complex operator
            conditions.push(`${field} ${value.operator} $${paramIndex++}`);
            params.push(value.value);
          } else {
            // Simple equality
            conditions.push(`${field} = $${paramIndex++}`);
            params.push(value);
          }
        }
      }
      
      sql += ' WHERE ' + conditions.join(' AND ');
      
    } else if (query.timeql) {
      // TimeQL query - convert to SQL
      sql = this._convertTimeQLToSQL(query.timeql, tenantId);
      
    } else if (query.sql) {
      // Raw SQL query (with tenant injection for security)
      sql = query.sql;
      if (!sql.toLowerCase().includes('tenant_id')) {
        // Inject tenant filter for security
        const whereIndex = sql.toLowerCase().indexOf('where');
        if (whereIndex > -1) {
          sql = sql.slice(0, whereIndex + 5) + ` tenant_id = $${paramIndex++} AND ` + sql.slice(whereIndex + 5);
        } else {
          sql += ` WHERE tenant_id = $${paramIndex++}`;
        }
        params.push(tenantId);
      }
    }
    
    // Add sorting
    if (sortBy) {
      sql += ` ORDER BY ${sortBy} ${sortOrder}`;
    }
    
    // Add pagination
    sql += ` LIMIT ${limit} OFFSET ${offset}`;
    
    return { sql, params };
  }
  
  _convertTimeQLToSQL(timeql, tenantId) {
    // Basic TimeQL to SQL conversion
    // This would integrate with the TemporalQueryEngine
    
    // For now, return a placeholder - this would be implemented
    // to work with the existing TimeQL engine
    return `
      SELECT * FROM events 
      WHERE tenant_id = '${tenantId}' 
      AND timestamp >= NOW() - INTERVAL '1 hour'
      ORDER BY timestamp DESC
    `;
  }
  
  _processResults(rows, options) {
    // Apply any data transformations
    return rows.map(row => {
      // Convert dates to ISO strings
      const processed = { ...row };
      
      for (const [key, value] of Object.entries(processed)) {
        if (value instanceof Date) {
          processed[key] = value.toISOString();
        } else if (typeof value === 'object' && value !== null) {
          // Stringify JSON objects
          processed[key] = JSON.stringify(value);
        }
      }
      
      return processed;
    });
  }
  
  _selectFields(data, fields) {
    return data.map(row => {
      const selected = {};
      for (const field of fields) {
        if (row.hasOwnProperty(field)) {
          selected[field] = row[field];
        }
      }
      return selected;
    });
  }
  
  async _formatData(data, format, options) {
    switch (format.toLowerCase()) {
      case 'json':
        return this._formatJSON(data, options);
      case 'csv':
        return this._formatCSV(data, options);
      case 'ndjson':
        return this._formatNDJSON(data, options);
      case 'xml':
        return this._formatXML(data, options);
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }
  
  _formatJSON(data, options) {
    const output = {
      exportId: options.id,
      timestamp: new Date().toISOString(),
      totalRecords: data.length,
      data
    };
    
    if (options.includeMetadata) {
      output.metadata = this._createMetadata(data, options);
    }
    
    return JSON.stringify(output, null, options.pretty ? 2 : 0);
  }
  
  _formatCSV(data, options) {
    if (data.length === 0) {
      return '';
    }
    
    // Get headers
    const headers = Object.keys(data[0]);
    let csv = headers.join(',') + '\n';
    
    // Add rows
    for (const row of data) {
      const values = headers.map(header => {
        const value = row[header];
        if (value === null || value === undefined) {
          return '';
        }
        
        const stringValue = String(value);
        // Escape CSV
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      });
      csv += values.join(',') + '\n';
    }
    
    return csv;
  }
  
  _formatNDJSON(data, options) {
    return data.map(row => JSON.stringify(row)).join('\n');
  }
  
  _formatXML(data, options) {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<export>\n';
    xml += `  <metadata>\n`;
    xml += `    <exportId>${options.id}</exportId>\n`;
    xml += `    <timestamp>${new Date().toISOString()}</timestamp>\n`;
    xml += `    <totalRecords>${data.length}</totalRecords>\n`;
    xml += `  </metadata>\n`;
    xml += '  <data>\n';
    
    for (const row of data) {
      xml += '    <record>\n';
      for (const [key, value] of Object.entries(row)) {
        const escapedValue = String(value || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;');
        xml += `      <${key}>${escapedValue}</${key}>\n`;
      }
      xml += '    </record>\n';
    }
    
    xml += '  </data>\n';
    xml += '</export>';
    
    return xml;
  }
  
  _formatStreamingChunk(data, format, isFirst, isLast) {
    switch (format.toLowerCase()) {
      case 'json':
        let chunk = '';
        if (isFirst) {
          chunk += '{"data":[';
        }
        chunk += data.map(row => JSON.stringify(row)).join(',');
        if (!isLast) {
          chunk += ',';
        } else {
          chunk += ']}';
        }
        return chunk;
        
      case 'ndjson':
        return data.map(row => JSON.stringify(row)).join('\n') + (isLast ? '' : '\n');
        
      case 'csv':
        if (isFirst && data.length > 0) {
          // Add headers
          const headers = Object.keys(data[0]);
          return headers.join(',') + '\n' + this._formatCSV(data, {}).split('\n').slice(1).join('\n');
        }
        return this._formatCSV(data, {}).split('\n').slice(1).join('\n');
        
      default:
        return JSON.stringify(data);
    }
  }
  
  async _saveToFile(data, options) {
    const { filename, format, compression } = options;
    const filepath = path.join(this.options.exportDir, `${filename}.${format}`);
    
    // Ensure export directory exists
    await fs.mkdir(path.dirname(filepath), { recursive: true });
    
    if (compression) {
      const compressedPath = `${filepath}.${compression}`;
      await this._compressAndSave(data, compressedPath, compression);
      return compressedPath;
    } else {
      await fs.writeFile(filepath, data, 'utf8');
      return filepath;
    }
  }
  
  async _compressAndSave(data, filepath, compression) {
    const fs = await import('fs/promises');
    const zlib = await import('zlib');
    
    let compressedData;
    
    switch (compression) {
      case 'gzip':
        compressedData = zlib.gzipSync(data);
        break;
      case 'brotli':
        compressedData = zlib.brotliCompressSync(data);
        break;
      default:
        throw new Error(`Unsupported compression: ${compression}`);
    }
    
    await fs.writeFile(filepath, compressedData);
  }
  
  async _sendToWebhook(data, options) {
    const response = await fetch(options.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Export-ID': options.id,
        'User-Agent': 'Traversion-Exporter/1.0'
      },
      body: JSON.stringify({
        exportId: options.id,
        timestamp: new Date().toISOString(),
        format: options.format,
        data: JSON.parse(data)
      })
    });
    
    if (!response.ok) {
      throw new Error(`Webhook failed: ${response.status} ${response.statusText}`);
    }
  }
  
  _createMetadata(data, options) {
    return {
      exportId: options.id,
      tenantId: options.tenantId,
      format: options.format,
      recordCount: data.length,
      exportedAt: new Date().toISOString(),
      query: options.query,
      filters: options.filters,
      fields: options.fields
    };
  }
  
  // Rate limiting
  _checkRateLimit(tenantId) {
    const now = Date.now();
    const windowStart = now - 60000; // 1 minute window
    
    if (!this.rateLimiter.has(tenantId)) {
      this.rateLimiter.set(tenantId, []);
    }
    
    const requests = this.rateLimiter.get(tenantId);
    
    // Remove old requests
    const recentRequests = requests.filter(time => time > windowStart);
    
    // Check limit
    if (recentRequests.length >= this.options.rateLimitRpm) {
      return false;
    }
    
    // Add current request
    recentRequests.push(now);
    this.rateLimiter.set(tenantId, recentRequests);
    
    return true;
  }
  
  _cleanupRateLimiter() {
    const now = Date.now();
    const windowStart = now - 60000;
    
    for (const [tenantId, requests] of this.rateLimiter.entries()) {
      const recentRequests = requests.filter(time => time > windowStart);
      
      if (recentRequests.length === 0) {
        this.rateLimiter.delete(tenantId);
      } else {
        this.rateLimiter.set(tenantId, recentRequests);
      }
    }
  }
  
  // Status and management methods
  async getExportStatus(exportId) {
    return this.activeExports.get(exportId) || null;
  }
  
  async cancelExport(exportId) {
    const exportInfo = this.activeExports.get(exportId);
    if (!exportInfo || exportInfo.status !== 'running') {
      return false;
    }
    
    // Mark as cancelled
    exportInfo.status = 'cancelled';
    exportInfo.cancelledAt = new Date();
    
    this.emit('export:cancelled', { id: exportId });
    return true;
  }
  
  getActiveExports() {
    return Array.from(this.activeExports.entries()).map(([id, info]) => ({
      id,
      ...info
    }));
  }
  
  async shutdown() {
    // Wait for active exports to complete or cancel them
    const activeExportIds = Array.from(this.activeExports.keys());
    
    for (const exportId of activeExportIds) {
      await this.cancelExport(exportId);
    }
    
    this.removeAllListeners();
  }
}

export default DataExporter;