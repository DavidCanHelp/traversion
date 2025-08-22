import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { VersionStore } from '../src/engine/versionStore.js';
import { GitIntegration } from '../src/integrations/git.js';
import { Logger } from '../src/utils/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Traversion Core Tests', () => {
  let testDir;
  let store;
  
  beforeEach(() => {
    // Create a temporary test directory
    testDir = path.join(__dirname, '.test-traversion');
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });
  
  afterEach(() => {
    // Clean up
    if (store) {
      store.close();
    }
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
  
  describe('VersionStore', () => {
    it('should initialize database correctly', () => {
      const dbPath = path.join(testDir, 'test.db');
      store = new VersionStore(dbPath);
      
      expect(fs.existsSync(dbPath)).toBe(true);
    });
    
    it('should save and retrieve versions', () => {
      const dbPath = path.join(testDir, 'test.db');
      store = new VersionStore(dbPath);
      
      const content = 'console.log("Hello World");';
      const filePath = 'test.js';
      
      const versionId = store.saveVersion(filePath, content, {
        vibeTags: ['test', 'debug']
      });
      
      expect(versionId).toBeGreaterThan(0);
      
      const version = store.getVersion(versionId);
      expect(version).toBeDefined();
      expect(version.file_path).toBe(filePath);
      expect(version.content).toBe(content);
    });
    
    it('should detect duplicate versions', () => {
      const dbPath = path.join(testDir, 'test.db');
      store = new VersionStore(dbPath);
      
      const content = 'const x = 42;';
      const filePath = 'duplicate.js';
      
      const v1 = store.saveVersion(filePath, content);
      const v2 = store.saveVersion(filePath, content);
      
      expect(v1).toBe(v2);
    });
    
    it('should calculate similarity correctly', () => {
      const dbPath = path.join(testDir, 'test.db');
      store = new VersionStore(dbPath);
      
      const similarity1 = store.calculateSimilarity('hello world', 'hello world');
      expect(similarity1).toBe(1);
      
      const similarity2 = store.calculateSimilarity('hello world', 'hello');
      expect(similarity2).toBeGreaterThan(0.4);
      expect(similarity2).toBeLessThan(1);
      
      const similarity3 = store.calculateSimilarity('abc', 'xyz');
      expect(similarity3).toBeLessThan(0.5);
    });
    
    it('should compare versions', () => {
      const dbPath = path.join(testDir, 'test.db');
      store = new VersionStore(dbPath);
      
      const v1 = store.saveVersion('compare.js', 'const a = 1;');
      const v2 = store.saveVersion('compare.js', 'const a = 2;', { force: true });
      
      const comparison = store.compareVersions(v1, v2);
      
      expect(comparison).toBeDefined();
      expect(comparison.changes).toBeDefined();
      expect(comparison.similarity).toBeGreaterThan(0.5);
      expect(comparison.versionA.id).toBe(v1);
      expect(comparison.versionB.id).toBe(v2);
    });
    
    it('should handle timeline queries', () => {
      const dbPath = path.join(testDir, 'test.db');
      store = new VersionStore(dbPath);
      
      store.saveVersion('file1.js', 'content1');
      store.saveVersion('file2.js', 'content2');
      store.saveVersion('file1.js', 'content1-modified', { force: true });
      
      const timeline = store.getTimeline();
      expect(timeline.length).toBeGreaterThanOrEqual(3);
      
      const file1Timeline = store.getTimeline('file1.js');
      expect(file1Timeline.every(v => v.file_path === 'file1.js')).toBe(true);
    });
    
    it('should handle vibe tag searches', () => {
      const dbPath = path.join(testDir, 'test.db');
      store = new VersionStore(dbPath);
      
      store.saveVersion('debug.js', 'console.log("test");', {
        vibeTags: ['debug', 'testing']
      });
      
      store.saveVersion('prod.js', 'const app = express();', {
        vibeTags: ['production', 'server']
      });
      
      const debugResults = store.searchByVibe('debug');
      expect(debugResults.length).toBeGreaterThan(0);
      expect(debugResults[0].file_path).toBe('debug.js');
    });
  });
  
  describe('GitIntegration', () => {
    it('should detect non-git repositories', () => {
      const git = new GitIntegration(testDir);
      expect(git.isGitRepo).toBe(false);
    });
    
    it('should handle git operations gracefully in non-git repos', () => {
      const git = new GitIntegration(testDir);
      
      expect(git.getCurrentBranch()).toBe('main');
      expect(git.getCurrentCommit()).toBeNull();
      expect(git.getFileStatus('any-file.js')).toBe('untracked');
      expect(git.getUncommittedFiles()).toEqual([]);
    });
    
    it('should enrich metadata correctly', () => {
      const git = new GitIntegration(testDir);
      const metadata = { vibeTags: ['test'] };
      
      const enriched = git.enrichVersionMetadata(metadata, 'test.js');
      
      expect(enriched.vibeTags).toEqual(['test']);
      expect(enriched.git).toBeDefined();
      expect(enriched.git.branch).toBe('main');
    });
  });
  
  describe('Logger', () => {
    it('should create log files', () => {
      const logDir = path.join(testDir, 'logs');
      const logger = new Logger({
        logDir: logDir,
        logToFile: true,
        colorize: false
      });
      
      logger.info('Test message');
      logger.error('Error message');
      
      const files = fs.readdirSync(logDir);
      expect(files.length).toBeGreaterThan(0);
      expect(files.some(f => f.includes('traversion'))).toBe(true);
      expect(files.some(f => f.includes('error'))).toBe(true);
    });
    
    it('should respect log levels', () => {
      const logger = new Logger({
        logLevel: 'error',
        logToFile: false
      });
      
      // These should not throw errors
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warning message');
      logger.error('Error message');
    });
    
    it('should measure performance', () => {
      const logger = new Logger({ logToFile: false });
      
      const timer = logger.startTimer('test-operation');
      expect(timer.label).toBe('test-operation');
      expect(timer.start).toBeDefined();
      
      // Simulate some work
      const delay = 50;
      const start = Date.now();
      while (Date.now() - start < delay) {
        // Busy wait
      }
      
      const duration = logger.endTimer(timer);
      expect(duration).toBeGreaterThanOrEqual(delay - 5);
      expect(duration).toBeLessThan(delay + 100);
    });
  });
  
  describe('Vibe Tag Detection', () => {
    it('should detect common code patterns', () => {
      const detectVibeTags = (content, filePath) => {
        const tags = [];
        
        if (content.includes('async') || content.includes('await')) tags.push('async');
        if (content.includes('TODO') || content.includes('FIXME')) tags.push('wip');
        if (content.includes('console.log') || content.includes('print')) tags.push('debug');
        if (content.length < 100) tags.push('minimal');
        if (content.length > 1000) tags.push('complex');
        if (content.includes('🔥') || content.includes('✨')) tags.push('vibing');
        
        const ext = path.extname(filePath);
        if (ext === '.css') tags.push('styling');
        if (ext === '.test.js' || ext === '.spec.js') tags.push('testing');
        
        return tags;
      };
      
      const asyncCode = 'async function test() { await fetch(); }';
      expect(detectVibeTags(asyncCode, 'test.js')).toContain('async');
      expect(detectVibeTags(asyncCode, 'test.js')).toContain('minimal');
      
      const debugCode = 'console.log("debug"); // TODO: fix this';
      expect(detectVibeTags(debugCode, 'debug.js')).toContain('debug');
      expect(detectVibeTags(debugCode, 'debug.js')).toContain('wip');
      
      const emojiCode = '// This is 🔥 code!';
      expect(detectVibeTags(emojiCode, 'vibe.js')).toContain('vibing');
      
      const cssCode = '.class { color: red; }';
      expect(detectVibeTags(cssCode, 'style.css')).toContain('styling');
      
      const testCode = 'describe("test", () => {});';
      expect(detectVibeTags(testCode, 'app.test.js')).toContain('testing');
    });
  });
});

// Export for running with node
export default describe;