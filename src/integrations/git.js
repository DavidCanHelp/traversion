import { execSync } from 'child_process';
import path from 'path';
import logger from '../utils/logger.js';

export class GitIntegration {
  constructor(repoPath = '.') {
    this.repoPath = path.resolve(repoPath);
    this.isGitRepo = this.checkIfGitRepo();
    
    if (this.isGitRepo) {
      logger.info('Git integration enabled', { repoPath: this.repoPath });
    } else {
      logger.info('Not a git repository, git integration disabled', { repoPath: this.repoPath });
    }
  }
  
  checkIfGitRepo() {
    try {
      execSync('git rev-parse --git-dir', { 
        cwd: this.repoPath,
        stdio: 'pipe'
      });
      return true;
    } catch {
      return false;
    }
  }
  
  getCurrentBranch() {
    if (!this.isGitRepo) return 'main';
    
    try {
      const branch = execSync('git branch --show-current', {
        cwd: this.repoPath,
        encoding: 'utf-8'
      }).trim();
      
      return branch || 'main';
    } catch (error) {
      logger.error('Failed to get current branch', { error: error.message });
      return 'main';
    }
  }
  
  getCurrentCommit() {
    if (!this.isGitRepo) return null;
    
    try {
      const commit = execSync('git rev-parse HEAD', {
        cwd: this.repoPath,
        encoding: 'utf-8'
      }).trim();
      
      return commit;
    } catch (error) {
      logger.error('Failed to get current commit', { error: error.message });
      return null;
    }
  }
  
  getFileStatus(filePath) {
    if (!this.isGitRepo) return 'untracked';
    
    try {
      const relativePath = path.relative(this.repoPath, filePath);
      const status = execSync(`git status --porcelain "${relativePath}"`, {
        cwd: this.repoPath,
        encoding: 'utf-8'
      }).trim();
      
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
  
  getFileDiff(filePath) {
    if (!this.isGitRepo) return null;
    
    try {
      const relativePath = path.relative(this.repoPath, filePath);
      const diff = execSync(`git diff HEAD -- "${relativePath}"`, {
        cwd: this.repoPath,
        encoding: 'utf-8'
      });
      
      return diff || null;
    } catch (error) {
      logger.error('Failed to get file diff', { error: error.message, filePath });
      return null;
    }
  }
  
  getFileHistory(filePath, limit = 10) {
    if (!this.isGitRepo) return [];
    
    try {
      const relativePath = path.relative(this.repoPath, filePath);
      const log = execSync(
        `git log --pretty=format:'%H|%ai|%an|%s' -${limit} -- "${relativePath}"`,
        {
          cwd: this.repoPath,
          encoding: 'utf-8'
        }
      );
      
      if (!log) return [];
      
      return log.split('\n').map(line => {
        const [hash, date, author, message] = line.split('|');
        return { hash, date, author, message };
      });
    } catch (error) {
      logger.error('Failed to get file history', { error: error.message, filePath });
      return [];
    }
  }
  
  getLastCommitForFile(filePath) {
    if (!this.isGitRepo) return null;
    
    try {
      const relativePath = path.relative(this.repoPath, filePath);
      const commit = execSync(
        `git log -1 --pretty=format:'%H|%ai|%an|%s' -- "${relativePath}"`,
        {
          cwd: this.repoPath,
          encoding: 'utf-8'
        }
      ).trim();
      
      if (!commit) return null;
      
      const [hash, date, author, message] = commit.split('|');
      return { hash, date, author, message };
    } catch (error) {
      logger.error('Failed to get last commit for file', { error: error.message, filePath });
      return null;
    }
  }
  
  getUncommittedFiles() {
    if (!this.isGitRepo) return [];
    
    try {
      const status = execSync('git status --porcelain', {
        cwd: this.repoPath,
        encoding: 'utf-8'
      });
      
      if (!status) return [];
      
      return status.split('\n')
        .filter(line => line.trim())
        .map(line => {
          const statusCode = line.substring(0, 2);
          const filePath = line.substring(3);
          
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
  
  getRemoteUrl() {
    if (!this.isGitRepo) return null;
    
    try {
      const url = execSync('git remote get-url origin', {
        cwd: this.repoPath,
        encoding: 'utf-8'
      }).trim();
      
      return url;
    } catch (error) {
      logger.debug('No remote URL found', { error: error.message });
      return null;
    }
  }
  
  enrichVersionMetadata(metadata, filePath) {
    if (!this.isGitRepo) return metadata;
    
    return {
      ...metadata,
      git: {
        branch: this.getCurrentBranch(),
        commit: this.getCurrentCommit(),
        fileStatus: this.getFileStatus(filePath),
        lastCommit: this.getLastCommitForFile(filePath)
      }
    };
  }
}

export default GitIntegration;