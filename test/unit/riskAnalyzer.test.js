/**
 * Risk Analyzer Test Suite
 */

import { jest } from '@jest/globals';
import { RiskAnalyzer } from '../../src/utils/riskAnalyzer.js';

describe('Risk Analyzer', () => {
  let analyzer;
  
  beforeEach(() => {
    analyzer = new RiskAnalyzer();
  });
  
  describe('Commit Risk Calculation', () => {
    test('calculates low risk for normal commit', () => {
      const commit = {
        date: new Date('2024-01-15T10:30:00Z'),
        message: 'Add user profile feature',
        filesChanged: ['src/components/UserProfile.js'],
        linesChanged: { additions: 50, deletions: 10 }
      };
      
      const result = analyzer.calculateCommitRisk(commit);
      
      expect(result.score).toBeLessThan(0.3);
      expect(result.level).toBe('LOW');
      expect(result.factors).toHaveLength(0);
    });
    
    test('calculates high risk for critical commit', () => {
      const commit = {
        date: new Date('2024-01-13T23:30:00Z'), // Saturday night
        message: 'HOTFIX: Critical security patch',
        filesChanged: [
          'config/production.env',
          'src/auth/authentication.js',
          'database/migrations/001_users.sql'
        ],
        linesChanged: { additions: 800, deletions: 500 }
      };
      
      const result = analyzer.calculateCommitRisk(commit);
      
      expect(result.score).toBeGreaterThan(0.7);
      expect(result.level).toBe('HIGH');
      expect(result.factors).toContain('Weekend deployment');
      expect(result.factors).toContain('Late night deployment');
      expect(result.factors).toContain('Large changes (1300 lines)');
      expect(result.factors).toContain('Urgent/hotfix commit');
    });
    
    test('boosts risk for affected files', () => {
      const commit = {
        date: new Date('2024-01-15T10:30:00Z'),
        message: 'Update user service',
        filesChanged: ['src/services/userService.js'],
        linesChanged: { additions: 20, deletions: 5 }
      };
      
      const options = {
        affectedFiles: ['userService.js']
      };
      
      const result = analyzer.calculateCommitRisk(commit, options);
      
      expect(result.score).toBeGreaterThan(0.3);
      expect(result.factors).toContain('Modifies incident-related files');
    });
  });
  
  describe('Timing Risk', () => {
    test('identifies weekend risk', () => {
      const saturdayDate = new Date('2024-01-13T14:00:00Z');
      const risk = analyzer.calculateTimingRisk(saturdayDate);
      
      expect(risk).toBeGreaterThanOrEqual(0.4);
    });
    
    test('identifies off-hours risk', () => {
      const lateNightDate = new Date('2024-01-15T02:00:00Z');
      const risk = analyzer.calculateTimingRisk(lateNightDate);
      
      expect(risk).toBeGreaterThanOrEqual(0.6);
    });
    
    test('identifies Friday afternoon risk', () => {
      const fridayAfternoon = new Date('2024-01-12T16:00:00Z');
      const risk = analyzer.calculateTimingRisk(fridayAfternoon);
      
      expect(risk).toBeGreaterThanOrEqual(0.2);
    });
    
    test('low risk for business hours', () => {
      const businessHours = new Date('2024-01-15T14:00:00Z'); // Monday 2pm
      const risk = analyzer.calculateTimingRisk(businessHours);
      
      expect(risk).toBe(0);
    });
  });
  
  describe('Change Size Risk', () => {
    test('calculates risk based on line changes', () => {
      expect(analyzer.calculateChangeSizeRisk({ additions: 10, deletions: 5 })).toBe(0.1);
      expect(analyzer.calculateChangeSizeRisk({ additions: 30, deletions: 25 })).toBe(0.2);
      expect(analyzer.calculateChangeSizeRisk({ additions: 60, deletions: 50 })).toBe(0.3);
      expect(analyzer.calculateChangeSizeRisk({ additions: 150, deletions: 100 })).toBe(0.5);
      expect(analyzer.calculateChangeSizeRisk({ additions: 400, deletions: 200 })).toBe(0.7);
      expect(analyzer.calculateChangeSizeRisk({ additions: 800, deletions: 300 })).toBe(0.9);
    });
  });
  
  describe('File Type Risk', () => {
    test('identifies high risk files', () => {
      const files = [
        { file: '.env.production' },
        { file: 'src/auth/jwt.js' },
        { file: 'database/schema.sql' }
      ];
      
      const risk = analyzer.calculateFileTypeRisk(files);
      
      expect(risk).toBeGreaterThanOrEqual(0.8);
    });
    
    test('identifies medium risk files', () => {
      const files = [
        { file: 'package.json' },
        { file: 'docker-compose.yml' }
      ];
      
      const risk = analyzer.calculateFileTypeRisk(files);
      
      expect(risk).toBeGreaterThanOrEqual(0.5);
    });
    
    test('increases risk for many files', () => {
      const manyFiles = Array(25).fill({ file: 'src/file.js' });
      const risk = analyzer.calculateFileTypeRisk(manyFiles);
      
      expect(risk).toBeGreaterThanOrEqual(0.2);
    });
  });
  
  describe('Message Risk', () => {
    test('identifies urgent messages', () => {
      expect(analyzer.calculateMessageRisk('HOTFIX: Critical bug')).toBeGreaterThanOrEqual(0.7);
      expect(analyzer.calculateMessageRisk('emergency: rollback needed')).toBeGreaterThanOrEqual(0.7);
      expect(analyzer.calculateMessageRisk('urgent security patch')).toBeGreaterThanOrEqual(0.7);
    });
    
    test('identifies vague messages', () => {
      expect(analyzer.calculateMessageRisk('fix')).toBeGreaterThanOrEqual(0.3);
      expect(analyzer.calculateMessageRisk('update stuff')).toBeGreaterThanOrEqual(0.3);
      expect(analyzer.calculateMessageRisk('changes')).toBeGreaterThanOrEqual(0.3);
    });
    
    test('identifies very short messages', () => {
      expect(analyzer.calculateMessageRisk('test')).toBeGreaterThanOrEqual(0.2);
      expect(analyzer.calculateMessageRisk('ok')).toBeGreaterThanOrEqual(0.2);
    });
    
    test('low risk for descriptive messages', () => {
      const message = 'feat: Add user authentication with JWT tokens and refresh mechanism';
      expect(analyzer.calculateMessageRisk(message)).toBeLessThan(0.2);
    });
  });
  
  describe('Pull Request Risk Analysis', () => {
    test('analyzes PR with multiple commits', () => {
      const pullRequest = {
        commits: [
          {
            date: new Date('2024-01-15T10:00:00Z'),
            message: 'Add feature',
            filesChanged: ['src/feature.js'],
            linesChanged: { additions: 100, deletions: 20 }
          },
          {
            date: new Date('2024-01-15T23:00:00Z'),
            message: 'Fix critical bug',
            filesChanged: ['src/auth/security.js'],
            linesChanged: { additions: 50, deletions: 30 }
          }
        ],
        files: Array(15).fill({ file: 'src/file.js' })
      };
      
      const result = analyzer.analyzePullRequestRisk(pullRequest);
      
      expect(result.score).toBeDefined();
      expect(result.level).toBeDefined();
      expect(result.fileCount).toBe(15);
      expect(result.commitCount).toBe(2);
      expect(result.recommendations).toBeInstanceOf(Array);
    });
    
    test('generates appropriate recommendations', () => {
      const pullRequest = {
        commits: [
          {
            date: new Date('2024-01-15T10:00:00Z'),
            message: 'Update authentication system',
            filesChanged: ['src/auth/login.js', 'src/auth/jwt.js'],
            linesChanged: { additions: 500, deletions: 300 }
          }
        ],
        files: ['src/auth/login.js', 'src/auth/jwt.js']
      };
      
      const result = analyzer.analyzePullRequestRisk(pullRequest);
      
      const securityRec = result.recommendations.find(r => 
        r.message.includes('Security')
      );
      
      expect(securityRec).toBeDefined();
      expect(securityRec.priority).toBe('HIGH');
    });
  });
  
  describe('Risk Level Classification', () => {
    test('classifies risk levels correctly', () => {
      expect(analyzer.getRiskLevel(0.9)).toBe('HIGH');
      expect(analyzer.getRiskLevel(0.7)).toBe('HIGH');
      expect(analyzer.getRiskLevel(0.5)).toBe('MEDIUM');
      expect(analyzer.getRiskLevel(0.4)).toBe('MEDIUM');
      expect(analyzer.getRiskLevel(0.3)).toBe('LOW');
      expect(analyzer.getRiskLevel(0.2)).toBe('LOW');
      expect(analyzer.getRiskLevel(0.1)).toBe('MINIMAL');
    });
  });
  
  describe('Risk Factor Identification', () => {
    test('identifies all relevant risk factors', () => {
      const commit = {
        date: new Date('2024-01-13T02:00:00Z'), // Saturday 2am
        message: 'hotfix: emergency database migration',
        filesChanged: [
          'database/migrations/users.sql',
          'config/production.env',
          '.env.production'
        ],
        linesChanged: { additions: 600, deletions: 400 }
      };
      
      const result = analyzer.calculateCommitRisk(commit);
      
      expect(result.factors).toContain('Weekend deployment');
      expect(result.factors).toContain('Late night deployment');
      expect(result.factors).toContain('Off-hours deployment');
      expect(result.factors).toContain('Large changes (1000 lines)');
      expect(result.factors).toContain('Urgent/hotfix commit');
      expect(result.factors.some(f => f.includes('Critical files'))).toBe(true);
    });
  });
});