/**
 * Incident Analyzer Test Suite
 */

import { jest, describe, it, beforeEach, expect } from '@jest/globals';
import { IncidentAnalyzer } from '../../src/forensics/incidentAnalyzer.js';

// Mock simple-git
const mockGit = {
  log: jest.fn(),
  diffSummary: jest.fn(),
  diff: jest.fn()
};

jest.mock('simple-git', () => ({
  simpleGit: jest.fn(() => mockGit)
}));

describe('IncidentAnalyzer', () => {
  let analyzer;
  
  beforeEach(() => {
    analyzer = new IncidentAnalyzer('/test/repo');
    jest.clearAllMocks();
  });
  
  describe('Incident Analysis', () => {
    it('should analyze incident within timeframe', async () => {
      const incidentTime = new Date('2024-01-15T15:00:00Z');
      const lookbackHours = 24;
      
      // Mock git log response
      mockGit.log.mockResolvedValue({
        all: [
          {
            hash: 'abc123',
            date: '2024-01-15T14:00:00Z',
            message: 'Fix critical bug',
            author_name: 'Developer',
            author_email: 'dev@example.com'
          },
          {
            hash: 'def456',
            date: '2024-01-15T10:00:00Z',
            message: 'Update configuration',
            author_name: 'Admin',
            author_email: 'admin@example.com'
          }
        ]
      });
      
      // Mock diff summary for each commit
      mockGit.diffSummary.mockResolvedValue({
        files: [
          { file: 'src/server.js', changes: 10, insertions: 8, deletions: 2 }
        ],
        insertions: 8,
        deletions: 2
      });
      
      const analysis = await analyzer.analyzeIncident(incidentTime, lookbackHours);
      
      expect(analysis.incidentTime).toEqual(incidentTime);
      expect(analysis.suspiciousCommits).toBeDefined();
      expect(analysis.recommendations).toBeDefined();
      expect(mockGit.log).toHaveBeenCalled();
    });
    
    it('should identify high-risk commits', async () => {
      const incidentTime = new Date();
      
      mockGit.log.mockResolvedValue({
        all: [
          {
            hash: 'danger123',
            date: new Date(Date.now() - 3600000).toISOString(),
            message: 'HOTFIX: emergency database migration',
            author_name: 'Developer',
            author_email: 'dev@example.com'
          }
        ]
      });
      
      mockGit.diffSummary.mockResolvedValue({
        files: [
          { file: 'database/migration.sql', changes: 500, insertions: 400, deletions: 100 },
          { file: '.env.production', changes: 5, insertions: 3, deletions: 2 }
        ],
        insertions: 403,
        deletions: 102
      });
      
      const analysis = await analyzer.analyzeIncident(incidentTime, 24);
      
      expect(analysis.suspiciousCommits.length).toBeGreaterThan(0);
      const highRiskCommit = analysis.suspiciousCommits[0];
      expect(highRiskCommit.riskScore).toBeGreaterThan(0.7);
      expect(highRiskCommit.riskFactors).toContain('Urgent/fix commit');
    });
    
    it('should handle affected files filtering', async () => {
      const affectedFiles = ['server.js', 'config.yml'];
      
      mockGit.log.mockResolvedValue({
        all: [
          {
            hash: 'abc123',
            date: new Date().toISOString(),
            message: 'Update server',
            author_name: 'Dev',
            author_email: 'dev@example.com'
          }
        ]
      });
      
      mockGit.diffSummary.mockResolvedValue({
        files: [
          { file: 'src/server.js', changes: 10, insertions: 5, deletions: 5 }
        ],
        insertions: 5,
        deletions: 5
      });
      
      const analysis = await analyzer.analyzeIncident(new Date(), 24, affectedFiles);
      
      const commit = analysis.suspiciousCommits[0];
      expect(commit.riskFactors).toContain('Modified affected files');
    });
  });
  
  describe('Commit Analysis', () => {
    it('should calculate risk score correctly', () => {
      const analysis = {
        date: new Date('2024-01-13T23:00:00Z'), // Saturday night
        message: 'hotfix: critical bug',
        filesChanged: [
          { file: 'config/production.env' },
          { file: 'database/schema.sql' }
        ],
        linesChanged: { additions: 600, deletions: 400 }
      };
      
      const score = analyzer.calculateRiskScore(analysis, []);
      
      expect(score).toBeGreaterThan(0.7);
    });
    
    it('should identify risk factors', () => {
      const analysis = {
        date: new Date('2024-01-13T02:00:00Z'), // Saturday 2am
        message: 'fix',
        filesChanged: [
          { file: '.env' },
          { file: 'auth/login.js' }
        ],
        linesChanged: { additions: 100, deletions: 50 }
      };
      
      const factors = analyzer.identifyRiskFactors(analysis, []);
      
      expect(factors).toContain('Off-hours deployment');
      expect(factors).toContain('Vague commit message');
      expect(factors).toContain('Configuration changes');
      expect(factors).toContain('Security changes');
    });
  });
  
  describe('Impact Analysis', () => {
    it('should generate impact analysis', async () => {
      const suspiciousCommits = [
        {
          hash: 'abc123',
          riskScore: 0.8,
          author: 'Dev1',
          filesChanged: [{ file: 'server.js' }],
          riskFactors: ['Off-hours deployment', 'Large code changes']
        },
        {
          hash: 'def456',
          riskScore: 0.6,
          author: 'Dev2',
          filesChanged: [{ file: 'config.yml' }],
          riskFactors: ['Configuration changes']
        }
      ];
      
      const impact = await analyzer.generateImpactAnalysis(suspiciousCommits, []);
      
      expect(impact.totalSuspiciousCommits).toBe(2);
      expect(impact.highRiskCommits).toBe(1);
      expect(impact.authorsInvolved).toBe(2);
      expect(impact.filesImpacted.size).toBe(2);
      expect(impact.commonPatterns['Off-hours deployment']).toBe(1);
    });
  });
  
  describe('Recommendations', () => {
    it('should generate appropriate recommendations', () => {
      const analysis = {
        suspiciousCommits: [
          {
            shortHash: 'abc123',
            message: 'database migration',
            riskScore: 0.8,
            riskFactors: ['Database changes']
          }
        ],
        impactAnalysis: {
          highRiskCommits: 1,
          authorsInvolved: 1,
          commonPatterns: { 'Database changes': 1 }
        }
      };
      
      const recommendations = analyzer.generateRecommendations(analysis);
      
      expect(recommendations.length).toBeGreaterThan(0);
      const dbRec = recommendations.find(r => r.category === 'database');
      expect(dbRec).toBeDefined();
      expect(dbRec.priority).toBe('high');
    });
    
    it('should handle no suspicious commits', () => {
      const analysis = {
        suspiciousCommits: [],
        impactAnalysis: {
          highRiskCommits: 0,
          authorsInvolved: 0,
          commonPatterns: {}
        }
      };
      
      const recommendations = analyzer.generateRecommendations(analysis);
      
      expect(recommendations.length).toBe(1);
      expect(recommendations[0].priority).toBe('low');
      expect(recommendations[0].message).toContain('No suspicious commits');
    });
  });
  
  describe('Error Handling', () => {
    it('should handle git command failures gracefully', async () => {
      mockGit.log.mockRejectedValue(new Error('Git command failed'));
      
      await expect(analyzer.analyzeIncident(new Date(), 24))
        .rejects.toThrow('Git command failed');
    });
    
    it('should handle missing commit data', async () => {
      const commit = {
        hash: 'abc123',
        message: 'Test commit'
        // Missing other fields
      };
      
      mockGit.diffSummary.mockRejectedValue(new Error('Not found'));
      
      const analysis = await analyzer.analyzeCommit(commit, []);
      
      expect(analysis.hash).toBe('abc123');
      expect(analysis.riskScore).toBeDefined();
    });
  });
});