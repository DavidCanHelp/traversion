import { spawn } from 'child_process';
import path from 'path';
import logger from '../utils/logger.js';
import { InputSanitizer } from './inputSanitizer.js';

/**
 * Secure Git Integration with command injection protection
 * Replaces the vulnerable execSync-based implementation
 */
export class SecureGitIntegration {
  constructor(repoPath = '.') {
    this.repoPath = path.resolve(repoPath);
    this.isGitRepo = false;
    this.initializeRepo();
  }

  async initializeRepo() {
    this.isGitRepo = await this.checkIfGitRepo();
    
    if (this.isGitRepo) {
      logger.info('Secure Git integration enabled', { repoPath: this.repoPath });
    } else {
      logger.info('Not a git repository, git integration disabled', { repoPath: this.repoPath });
    }
  }

  /**
   * Execute git command securely using spawn instead of execSync
   */
  async executeGitCommand(args, options = {}) {
    return new Promise((resolve, reject) => {
      // Validate and sanitize arguments
      const sanitizedArgs = args.map(arg => {
        if (typeof arg !== 'string') {
          throw new Error('All git arguments must be strings');
        }
        return InputSanitizer.sanitizeShellArg(arg);
      });

      const gitProcess = spawn('git', sanitizedArgs, {
        cwd: this.repoPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: options.timeout || 30000, // 30 second timeout
        ...options
      });

      let stdout = '';
      let stderr = '';

      gitProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      gitProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      gitProcess.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          const error = new Error(`Git command failed: ${stderr || 'Unknown error'}`);
          error.code = code;
          error.stderr = stderr;
          reject(error);
        }
      });

      gitProcess.on('error', (error) => {
        reject(new Error(`Failed to execute git command: ${error.message}`));
      });

      // Handle timeout
      gitProcess.on('timeout', () => {
        gitProcess.kill('SIGKILL');
        reject(new Error('Git command timed out'));
      });
    });
  }

  async checkIfGitRepo() {
    try {
      await this.executeGitCommand(['rev-parse', '--git-dir']);
      return true;
    } catch {
      return false;
    }
  }

  async getCurrentBranch() {
    if (!this.isGitRepo) return 'main';

    try {
      const branch = await this.executeGitCommand(['branch', '--show-current']);
      return branch || 'main';
    } catch (error) {
      logger.error('Failed to get current branch', { error: error.message });
      return 'main';
    }
  }

  async getCurrentCommit() {
    if (!this.isGitRepo) return null;

    try {
      const commit = await this.executeGitCommand(['rev-parse', 'HEAD']);
      return InputSanitizer.sanitizeCommitHash(commit);
    } catch (error) {
      logger.error('Failed to get current commit', { error: error.message });
      return null;
    }
  }

  async getFileStatus(filePath) {
    if (!this.isGitRepo) return 'untracked';

    try {
      const sanitizedPath = InputSanitizer.sanitizeFilePath(filePath);
      const relativePath = path.relative(this.repoPath, sanitizedPath);
      
      const status = await this.executeGitCommand([
        'status', '--porcelain', '--', relativePath
      ]);

      if (!status) return 'clean';

      const statusCode = status.substring(0, 2);

      if (statusCode.includes('?')) return 'untracked';
      if (statusCode.includes('M')) return 'modified';
      if (statusCode.includes('A')) return 'added';
      if (statusCode.includes('D')) return 'deleted';
      if (statusCode.includes('R')) return 'renamed';

      return 'unknown';
    } catch (error) {
      logger.error('Failed to get file status', { error: error.message, filePath });
      return 'unknown';
    }
  }

  async getFileDiff(filePath) {
    if (!this.isGitRepo) return null;

    try {
      const sanitizedPath = InputSanitizer.sanitizeFilePath(filePath);
      const relativePath = path.relative(this.repoPath, sanitizedPath);
      
      const diff = await this.executeGitCommand([
        'diff', 'HEAD', '--', relativePath
      ]);

      return diff || null;
    } catch (error) {
      logger.error('Failed to get file diff', { error: error.message, filePath });
      return null;
    }
  }

  async getFileHistory(filePath, limit = 10) {
    if (!this.isGitRepo) return [];

    try {
      const sanitizedPath = InputSanitizer.sanitizeFilePath(filePath);
      const sanitizedLimit = InputSanitizer.sanitizeInteger(limit, 1, 100);
      const relativePath = path.relative(this.repoPath, sanitizedPath);
      
      const log = await this.executeGitCommand([
        'log', 
        '--pretty=format:%H|%ai|%an|%s', 
        `-${sanitizedLimit}`, 
        '--', 
        relativePath
      ]);

      if (!log) return [];

      return log.split('\n').map(line => {
        const [hash, date, author, message] = line.split('|');
        return { 
          hash: InputSanitizer.sanitizeCommitHash(hash), 
          date, 
          author: InputSanitizer.sanitizeHTML(author), 
          message: InputSanitizer.sanitizeHTML(message) 
        };
      });
    } catch (error) {
      logger.error('Failed to get file history', { error: error.message, filePath });
      return [];
    }
  }

  async getLastCommitForFile(filePath) {
    if (!this.isGitRepo) return null;

    try {
      const sanitizedPath = InputSanitizer.sanitizeFilePath(filePath);
      const relativePath = path.relative(this.repoPath, sanitizedPath);
      
      const commit = await this.executeGitCommand([
        'log', 
        '-1', 
        '--pretty=format:%H|%ai|%an|%s', 
        '--', 
        relativePath
      ]);

      if (!commit) return null;

      const [hash, date, author, message] = commit.split('|');
      return { 
        hash: InputSanitizer.sanitizeCommitHash(hash), 
        date, 
        author: InputSanitizer.sanitizeHTML(author), 
        message: InputSanitizer.sanitizeHTML(message) 
      };
    } catch (error) {
      logger.error('Failed to get last commit for file', { error: error.message, filePath });
      return null;
    }
  }

  async getUncommittedFiles() {
    if (!this.isGitRepo) return [];

    try {
      const status = await this.executeGitCommand(['status', '--porcelain']);

      if (!status) return [];

      return status.split('\n')
        .filter(line => line.trim())
        .map(line => {
          const statusCode = line.substring(0, 2);
          const filePath = InputSanitizer.sanitizeFilePath(line.substring(3));

          let changeType = 'unknown';
          if (statusCode.includes('?')) changeType = 'untracked';
          else if (statusCode.includes('M')) changeType = 'modified';
          else if (statusCode.includes('A')) changeType = 'added';
          else if (statusCode.includes('D')) changeType = 'deleted';
          else if (statusCode.includes('R')) changeType = 'renamed';

          return { filePath, changeType, statusCode };
        });
    } catch (error) {
      logger.error('Failed to get uncommitted files', { error: error.message });
      return [];
    }
  }

  async getRemoteUrl() {
    if (!this.isGitRepo) return null;

    try {
      const url = await this.executeGitCommand(['remote', 'get-url', 'origin']);
      return InputSanitizer.sanitizeURL(url);
    } catch (error) {
      logger.debug('No remote URL found', { error: error.message });
      return null;
    }
  }

  async getCommitsInTimeframe(since, until) {
    if (!this.isGitRepo) return [];

    try {
      const sanitizedSince = InputSanitizer.sanitizeISODate(since);
      const sanitizedUntil = InputSanitizer.sanitizeISODate(until);

      const log = await this.executeGitCommand([
        'log',
        '--pretty=format:%H|%ai|%an|%ae|%s',
        `--since=${sanitizedSince}`,
        `--until=${sanitizedUntil}`
      ]);

      if (!log) return [];

      return log.split('\n').map(line => {
        const [hash, date, author_name, author_email, message] = line.split('|');
        return {
          hash: InputSanitizer.sanitizeCommitHash(hash),
          date,
          author_name: InputSanitizer.sanitizeHTML(author_name),
          author_email: InputSanitizer.sanitizeHTML(author_email),
          message: InputSanitizer.sanitizeHTML(message)
        };
      });
    } catch (error) {
      logger.error('Failed to get commits in timeframe', { error: error.message });
      return [];
    }
  }

  async getCommitFiles(commitHash) {
    if (!this.isGitRepo) return [];

    try {
      const sanitizedHash = InputSanitizer.sanitizeCommitHash(commitHash);
      
      const files = await this.executeGitCommand([
        'show',
        '--name-status',
        '--pretty=format:',
        sanitizedHash
      ]);

      if (!files) return [];

      return files.split('\n')
        .filter(line => line.trim())
        .map(line => {
          const [status, filePath] = line.split('\t');
          return {
            file: InputSanitizer.sanitizeFilePath(filePath),
            status,
            changes: 0 // Would need additional call to get line counts
          };
        });
    } catch (error) {
      logger.error('Failed to get commit files', { error: error.message, commitHash });
      return [];
    }
  }

  async enrichVersionMetadata(metadata, filePath) {
    if (!this.isGitRepo) return metadata;

    try {
      const gitData = {
        branch: await this.getCurrentBranch(),
        commit: await this.getCurrentCommit(),
        fileStatus: await this.getFileStatus(filePath),
        lastCommit: await this.getLastCommitForFile(filePath)
      };

      return {
        ...metadata,
        git: gitData
      };
    } catch (error) {
      logger.error('Failed to enrich metadata with git data', { error: error.message });
      return metadata;
    }
  }
}

export default SecureGitIntegration;