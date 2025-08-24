import chokidar from 'chokidar';
import { readFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { VersionStore } from '../engine/versionStore.js';
import { WebSocketServer } from 'ws';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import logger from '../utils/logger.js';
import { SecureGitIntegration } from '../security/secureGitIntegration.js';
import smartTagger from '../utils/smartTagger.js';
import WebRTCSignalingServer from '../collaboration/webrtc-server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class TraversionWatcher {
  constructor(watchPath = '.', options = {}) {
    this.watchPath = path.resolve(watchPath);
    this.options = {
      ignore: [
        '**/node_modules/**',
        '**/.git/**',
        '**/.traversion/**',
        '**/dist/**',
        '**/build/**',
        '**/*.log',
        ...options.ignore || []
      ],
      extensions: options.extensions || ['.js', '.jsx', '.ts', '.tsx', '.py', '.go', '.rs', '.css', '.html'],
      port: options.port || 3333,
      ...options
    };

    // Ensure .traversion directory exists
    const traversionDir = path.join(this.watchPath, '.traversion');
    if (!existsSync(traversionDir)) {
      mkdirSync(traversionDir, { recursive: true });
    }

    this.store = new VersionStore(path.join(traversionDir, 'versions.db'));
    this.git = new SecureGitIntegration(this.watchPath);
    this.clients = new Set();
    this.recentVersions = [];
    this.spinner = null;
    this.webrtcServer = null;
  }

  start() {
    logger.info(chalk.cyan.bold('\n⚡ Traversion - Time Machine for Vibe Coders ⚡\n'));
    logger.info(chalk.gray(`Watching: ${this.watchPath}`));
    logger.info(chalk.gray(`Port: ${this.options.port}`));
    logger.info(chalk.gray(`Extensions: ${this.options.extensions.join(', ')}\n`));

    logger.info('Starting Traversion', {
      watchPath: this.watchPath,
      port: this.options.port,
      extensions: this.options.extensions
    });

    this.startWatcher();
    this.startServer();
    this.startWebSocketServer();
    this.startWebRTCServer();

    logger.info(chalk.green('✨ Traversion is ready! Your code journey is being recorded...\n'));
    logger.info(chalk.cyan(`🌐 Open http://localhost:${this.options.port} to see your timeline\n`));
    logger.info(chalk.magenta(`🎥 WebRTC collaboration on port ${this.options.port + 2}\n`));
    
    logger.info('Traversion started successfully');
  }

  startWatcher() {
    const watcher = chokidar.watch(this.watchPath, {
      ignored: this.options.ignore,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 100
      }
    });

    watcher
      .on('change', (filePath) => this.handleFileChange(filePath))
      .on('add', (filePath) => this.handleFileAdd(filePath))
      .on('unlink', (filePath) => this.handleFileDelete(filePath))
      .on('error', error => {
        logger.error('Watcher error', { error: error.message });
        logger.error(chalk.red('Watcher error:', error));
      });
  }

  async handleFileChange(filePath) {
    if (!this.shouldTrackFile(filePath)) return;

    const relativePath = path.relative(this.watchPath, filePath);
    
    try {
      const content = readFileSync(filePath, 'utf-8');
      // Use smart tagger for enhanced tag detection
      const smartTags = smartTagger.analyzeCode(content, relativePath);
      const basicTags = this.detectVibeTags(content, relativePath);
      const vibeTags = [...new Set([...smartTags, ...basicTags])];
      
      let metadata = {
        eventType: 'change',
        vibeTags: vibeTags.slice(0, 20) // Limit to 20 most relevant tags
      };
      
      // Enrich with git metadata
      metadata = await this.git.enrichVersionMetadata(metadata, filePath);
      
      const versionId = this.store.saveVersion(relativePath, content, metadata);

      const version = this.store.getVersion(versionId);
      this.recentVersions.unshift(version);
      this.recentVersions = this.recentVersions.slice(0, 50);

      logger.info(
        chalk.green('📸'),
        chalk.white(relativePath),
        chalk.gray(`[v${versionId}]`),
        chalk.dim(new Date().toLocaleTimeString())
      );
      
      logger.logFileChange(relativePath, versionId, {
        vibeTags: vibeTags,
        eventType: 'change'
      });

      this.broadcast({
        type: 'version',
        data: version
      });

    } catch (error) {
      logger.error(`Error capturing ${relativePath}`, { error: error.message });
      logger.error(chalk.red(`Error capturing ${relativePath}:`, error.message));
    }
  }

  handleFileAdd(filePath) {
    if (!this.shouldTrackFile(filePath)) return;

    const relativePath = path.relative(this.watchPath, filePath);
    logger.info(chalk.blue('➕'), chalk.white(relativePath), chalk.gray('[new file]'));
    
    this.handleFileChange(filePath);
  }

  handleFileDelete(filePath) {
    const relativePath = path.relative(this.watchPath, filePath);
    logger.info(chalk.red('🗑️'), chalk.white(relativePath), chalk.gray('[deleted]'));
    
    this.broadcast({
      type: 'delete',
      data: { filePath: relativePath }
    });
  }

  shouldTrackFile(filePath) {
    const ext = path.extname(filePath);
    return this.options.extensions.includes(ext);
  }

  detectVibeTags(content, filePath) {
    const tags = [];
    
    // Detect code patterns
    if (content.includes('async') || content.includes('await')) tags.push('async');
    if (content.includes('TODO') || content.includes('FIXME')) tags.push('wip');
    if (content.includes('console.log') || content.includes('print')) tags.push('debug');
    if (content.length < 100) tags.push('minimal');
    if (content.length > 1000) tags.push('complex');
    if (content.includes('🔥') || content.includes('✨')) tags.push('vibing');
    
    // Detect file type vibes
    const ext = path.extname(filePath);
    if (ext === '.css') tags.push('styling');
    if (ext === '.test.js' || ext === '.spec.js') tags.push('testing');
    
    return tags;
  }

  startServer() {
    const app = express();
    this.app = app; // Store reference for WebRTC endpoints
    
    // Request logging middleware
    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        logger.logApiRequest(req.method, req.path, res.statusCode, duration);
      });
      next();
    });
    
    app.use(express.json());
    app.use(express.static(path.join(__dirname, '../../public')));

    // API endpoints
    app.get('/api/timeline', (req, res) => {
      const timeline = this.store.getTimeline();
      res.json(timeline);
    });

    app.get('/api/versions/:file', (req, res) => {
      const versions = this.store.getSessionVersions();
      res.json(versions.filter(v => v.file_path === req.params.file));
    });

    app.get('/api/version/:id', (req, res) => {
      const version = this.store.getVersion(req.params.id);
      res.json(version);
    });

    app.post('/api/compare', (req, res) => {
      const { versionAId, versionBId } = req.body;
      const comparison = this.store.compareVersions(versionAId, versionBId);
      res.json(comparison);
    });

    app.post('/api/search-vibe', (req, res) => {
      const { vibe } = req.body;
      const results = this.store.searchByVibe(vibe);
      res.json(results);
    });

    app.get('/api/recent', (req, res) => {
      res.json(this.recentVersions);
    });

    // Export endpoints
    app.get('/api/export/json', (req, res) => {
      const timeline = this.store.getTimeline();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="traversion-export-${Date.now()}.json"`);
      res.json({
        exportedAt: new Date().toISOString(),
        versions: timeline,
        stats: {
          totalVersions: timeline.length,
          files: [...new Set(timeline.map(v => v.file_path))],
          timeRange: timeline.length > 0 ? {
            start: timeline[0].timestamp,
            end: timeline[timeline.length - 1].timestamp
          } : null
        }
      });
    });

    app.get('/api/export/csv', (req, res) => {
      const timeline = this.store.getTimeline();
      const csv = [
        'ID,File Path,Timestamp,Event Type,Vibe Tags,Content Hash',
        ...timeline.map(v => 
          `${v.id},"${v.file_path}","${v.timestamp}","${v.event_type}","${v.vibe_tags}","${v.content_hash}"`
        )
      ].join('\n');
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="traversion-export-${Date.now()}.csv"`);
      res.send(csv);
    });

    // Git status endpoint
    app.get('/api/git/status', async (req, res) => {
      if (!this.git.isGitRepo) {
        return res.json({ isGitRepo: false });
      }
      
      try {
        const [branch, commit, uncommittedFiles, remoteUrl] = await Promise.all([
          this.git.getCurrentBranch(),
          this.git.getCurrentCommit(),
          this.git.getUncommittedFiles(),
          this.git.getRemoteUrl()
        ]);
        
        res.json({
          isGitRepo: true,
          branch,
          commit,
          uncommittedFiles,
          remoteUrl
        });
      } catch (error) {
        logger.error('Git status error', { error: error.message });
        res.status(500).json({ error: 'Failed to get git status' });
      }
    });
    
    app.get('/api/git/history/:file', async (req, res) => {
      try {
        const filePath = path.join(this.watchPath, req.params.file);
        const history = await this.git.getFileHistory(filePath);
        res.json(history);
      } catch (error) {
        logger.error('Git history error', { error: error.message });
        res.status(500).json({ error: 'Failed to get file history' });
      }
    });
    
    // Stats endpoint
    app.get('/api/stats', (req, res) => {
      const timeline = this.store.getTimeline();
      const files = [...new Set(timeline.map(v => v.file_path))];
      const vibeTags = timeline.flatMap(v => {
        try {
          return JSON.parse(v.vibe_tags || '[]');
        } catch {
          return [];
        }
      });
      const tagCounts = vibeTags.reduce((acc, tag) => {
        acc[tag] = (acc[tag] || 0) + 1;
        return acc;
      }, {});

      res.json({
        totalVersions: timeline.length,
        totalFiles: files.length,
        files: files,
        vibeTags: tagCounts,
        sessionsCount: this.store.getSessionCount(),
        averageVersionsPerFile: timeline.length / (files.length || 1),
        timeRange: timeline.length > 0 ? {
          start: timeline[0].timestamp,
          end: timeline[timeline.length - 1].timestamp
        } : null
      });
    });

    // Rollback endpoint
    app.post('/api/rollback/:versionId', (req, res) => {
      try {
        const version = this.store.getVersion(req.params.versionId);
        if (!version) {
          return res.status(404).json({ error: 'Version not found' });
        }
        
        const fullPath = path.join(this.watchPath, version.file_path);
        require('fs').writeFileSync(fullPath, version.content, 'utf-8');
        
        res.json({ 
          success: true, 
          message: `Rolled back ${version.file_path} to version ${version.id}`,
          version 
        });
      } catch (error) {
        logger.error('Rollback failed', { error: error.message, versionId: req.params.versionId });
        res.status(500).json({ error: error.message });
      }
    });

    app.listen(this.options.port);
  }

  startWebSocketServer() {
    const wss = new WebSocketServer({ port: this.options.port + 1 });
    
    wss.on('connection', (ws) => {
      this.clients.add(ws);
      logger.logWebSocketEvent('connection', this.clients.size);
      
      // Send initial state
      ws.send(JSON.stringify({
        type: 'init',
        data: {
          timeline: this.store.getTimeline(),
          recent: this.recentVersions
        }
      }));

      ws.on('close', () => {
        this.clients.delete(ws);
        logger.logWebSocketEvent('disconnection', this.clients.size);
      });
    });
  }

  broadcast(message) {
    const data = JSON.stringify(message);
    this.clients.forEach(client => {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(data);
      }
    });
  }

  startWebRTCServer() {
    this.webrtcServer = new WebRTCSignalingServer(this.options.port + 2);
    this.webrtcServer.start();
    
    // API endpoints for collaboration info
    const app = this.app; // Store express app reference
    if (app) {
      app.get('/api/collaboration/rooms', (req, res) => {
        res.json(this.webrtcServer.getAllRooms());
      });
      
      app.get('/api/collaboration/room/:roomId', (req, res) => {
        const info = this.webrtcServer.getRoomInfo(req.params.roomId);
        if (info) {
          res.json(info);
        } else {
          res.status(404).json({ error: 'Room not found' });
        }
      });
    }
  }
  
  stop() {
    logger.info('Stopping Traversion');
    this.store.close();
    this.clients.clear();
    
    if (this.webrtcServer) {
      this.webrtcServer.stop();
    }
    
    logger.info(chalk.yellow('\n👋 Traversion stopped. Your journey is saved!\n'));
    logger.info('Traversion stopped successfully');
  }
}

// CLI
const watcher = new TraversionWatcher(process.argv[2] || '.');
watcher.start();

process.on('SIGINT', () => {
  watcher.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  watcher.stop();
  process.exit(0);
});