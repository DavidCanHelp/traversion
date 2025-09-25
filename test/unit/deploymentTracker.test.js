import { jest } from '@jest/globals';
import { DeploymentTracker } from '../../src/tracking/deploymentTracker.js';
import WebSocket from 'ws';

describe('DeploymentTracker', () => {
  let tracker;

  beforeEach(() => {
    tracker = new DeploymentTracker({
      port: 3399, // Use different port for testing
      checkInterval: 100, // Faster for tests
      monitoring: {} // Empty monitoring config for tests
    });
  });

  afterEach(() => {
    if (tracker) {
      tracker.stop();
    }
  });

  describe('Initialization', () => {
    test('should initialize with default configuration', () => {
      expect(tracker.config.port).toBe(3399);
      expect(tracker.config.checkInterval).toBe(100);
      expect(tracker.config.correlationWindow).toBe(300000);
    });

    test('should initialize empty deployment tracking structures', () => {
      expect(tracker.deployments).toBeInstanceOf(Map);
      expect(tracker.activeDeployments).toBeInstanceOf(Set);
      expect(tracker.deploymentMetrics).toBeInstanceOf(Map);
      expect(tracker.deploymentHistory).toEqual([]);
    });
  });

  describe('Deployment Detection', () => {
    test('should create deployment record with correct structure', async () => {
      const mockCommit = {
        hash: 'abc123def456',
        message: 'Fix critical bug',
        author_name: 'Test Author',
        author_email: 'test@example.com',
        date: '2024-01-01T12:00:00Z',
        diff: { files: ['file1.js', 'file2.js'] }
      };

      // Mock git log
      tracker.git.log = jest.fn().mockResolvedValue({
        latest: mockCommit,
        all: [mockCommit]
      });

      tracker.git.diff = jest.fn().mockResolvedValue('M\tfile1.js\nM\tfile2.js');

      const deployment = await tracker.createDeploymentRecord(mockCommit.hash);

      expect(deployment).toMatchObject({
        id: expect.stringMatching(/^dep_/),
        timestamp: expect.any(Date),
        commit: expect.objectContaining({
          hash: mockCommit.hash,
          message: mockCommit.message,
          author: mockCommit.author_name
        }),
        status: 'in_progress',
        metrics: expect.objectContaining({
          startTime: expect.any(Date),
          endTime: null,
          duration: null
        }),
        risk: expect.objectContaining({
          score: expect.any(Number),
          factors: expect.any(Array)
        })
      });
    });

    test('should handle new deployment and emit events', async () => {
      const deploymentSpy = jest.fn();
      tracker.on('deployment', deploymentSpy);

      const mockCommit = 'abc123def456';
      tracker.createDeploymentRecord = jest.fn().mockResolvedValue({
        id: 'dep_test_123',
        commit: { hash: mockCommit },
        timestamp: new Date(),
        status: 'in_progress'
      });

      tracker.startDeploymentMonitoring = jest.fn();
      tracker.analyzeDeploymentRisk = jest.fn();
      tracker.broadcast = jest.fn();

      await tracker.handleNewDeployment(mockCommit);

      expect(deploymentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'dep_test_123',
          commit: expect.objectContaining({ hash: mockCommit })
        })
      );

      expect(tracker.deployments.has('dep_test_123')).toBe(true);
      expect(tracker.activeDeployments.has('dep_test_123')).toBe(true);
    });
  });

  describe('Risk Analysis', () => {
    test('should calculate risk score for off-hours deployment', async () => {
      const deployment = {
        timestamp: new Date('2024-01-01T03:00:00Z'), // 3 AM
        commit: {
          files: ['config.js', 'database.js'],
          message: 'Update configuration'
        }
      };

      await tracker.analyzeDeploymentRisk(deployment);

      expect(deployment.risk.score).toBeGreaterThan(0.3);
      expect(deployment.risk.factors).toContain('Off-hours deployment');
      expect(deployment.risk.factors).toContain('2 risky files modified');
    });

    test('should detect high-risk deployment patterns', async () => {
      const highRiskSpy = jest.fn();
      tracker.on('high_risk_deployment', highRiskSpy);
      tracker.broadcast = jest.fn();

      const deployment = {
        timestamp: new Date('2024-01-06T02:00:00Z'), // Saturday 2 AM
        commit: {
          files: Array(25).fill('file.js'), // Large deployment
          message: 'HOTFIX: Emergency database migration'
        }
      };

      await tracker.analyzeDeploymentRisk(deployment);

      expect(deployment.risk.score).toBeGreaterThan(0.7);
      expect(deployment.risk.factors).toContain('Weekend deployment');
      expect(deployment.risk.factors).toContain('Off-hours deployment');
      expect(deployment.risk.factors).toContain('Large deployment');
      expect(deployment.risk.factors).toContain('Urgent deployment');
      expect(highRiskSpy).toHaveBeenCalledWith(deployment);
    });
  });

  describe('Anomaly Detection', () => {
    test('should detect error rate spike anomaly', async () => {
      const deployment = {
        id: 'dep_test_123',
        metrics: {
          errorRate: 10,
          responseTime: 500,
          cpu: 50,
          memory: 70
        },
        correlations: {
          alerts: []
        }
      };

      const anomalies = await tracker.detectAnomalies(deployment);

      expect(anomalies).toContainEqual(
        expect.objectContaining({
          type: 'error_rate_spike',
          severity: 'high',
          value: 10
        })
      );
    });

    test('should detect multiple anomalies', async () => {
      const deployment = {
        id: 'dep_test_123',
        metrics: {
          errorRate: 8,
          responseTime: 1500,
          cpu: 85,
          memory: 95
        },
        correlations: {
          alerts: [
            { severity: 'critical', message: 'Database connection failed' }
          ]
        }
      };

      const anomalies = await tracker.detectAnomalies(deployment);

      expect(anomalies.length).toBeGreaterThanOrEqual(4);
      expect(anomalies.some(a => a.type === 'error_rate_spike')).toBe(true);
      expect(anomalies.some(a => a.type === 'response_time_degradation')).toBe(true);
      expect(anomalies.some(a => a.type === 'cpu_spike')).toBe(true);
      expect(anomalies.some(a => a.type === 'memory_spike')).toBe(true);
      expect(anomalies.some(a => a.type === 'critical_alerts')).toBe(true);
    });
  });

  describe('Incident Triggering', () => {
    test('should trigger incident for critical anomalies', () => {
      const incidentSpy = jest.fn();
      tracker.on('incident_detected', incidentSpy);
      tracker.broadcast = jest.fn();

      const deployment = {
        id: 'dep_test_123',
        commit: {
          hash: 'abc123',
          message: 'Deploy feature',
          author: 'Test Author'
        },
        correlations: {
          incidents: []
        }
      };

      const anomalies = [
        {
          type: 'critical_alerts',
          severity: 'critical',
          message: 'Service down'
        }
      ];

      const incident = tracker.triggerIncident(deployment, anomalies);

      expect(incident).toMatchObject({
        id: expect.stringMatching(/^inc_/),
        deploymentId: 'dep_test_123',
        severity: 'critical',
        status: 'active',
        anomalies: anomalies
      });

      expect(incidentSpy).toHaveBeenCalledWith(incident);
      expect(deployment.correlations.incidents).toContain(incident);
    });

    test('should generate incident recommendations', () => {
      const deployment = {
        id: 'dep_test_123',
        commit: {
          hash: 'abc123',
          message: 'Deploy feature'
        }
      };

      const anomalies = [
        { type: 'error_rate_spike', severity: 'high' },
        { type: 'memory_spike', severity: 'high' }
      ];

      const recommendations = tracker.generateIncidentRecommendations(deployment, anomalies);

      expect(recommendations).toContainEqual(
        expect.objectContaining({
          priority: 'high',
          action: 'rollback'
        })
      );

      expect(recommendations).toContainEqual(
        expect.objectContaining({
          action: 'investigate',
          description: expect.stringContaining('logs')
        })
      );

      expect(recommendations).toContainEqual(
        expect.objectContaining({
          action: 'investigate',
          description: expect.stringContaining('memory')
        })
      );
    });
  });

  describe('WebSocket Communication', () => {
    test('should setup WebSocket server on start', async () => {
      tracker.setupWebSocketServer = jest.fn();
      tracker.startDeploymentDetection = jest.fn();
      tracker.startMonitoringCorrelation = jest.fn();
      tracker.setupWebhooks = jest.fn().mockResolvedValue();

      await tracker.start();

      expect(tracker.setupWebSocketServer).toHaveBeenCalled();
    });

    test('should broadcast to all connected clients', () => {
      const mockClient1 = {
        id: 'client_1',
        ws: { readyState: WebSocket.OPEN, send: jest.fn() }
      };

      const mockClient2 = {
        id: 'client_2',
        ws: { readyState: WebSocket.OPEN, send: jest.fn() }
      };

      tracker.clients.add(mockClient1);
      tracker.clients.add(mockClient2);

      const data = { type: 'test_broadcast', message: 'Hello' };
      tracker.broadcast(data);

      expect(mockClient1.ws.send).toHaveBeenCalledWith(JSON.stringify(data));
      expect(mockClient2.ws.send).toHaveBeenCalledWith(JSON.stringify(data));
    });
  });

  describe('Correlation Confidence', () => {
    test('should calculate high confidence for time-correlated alerts', () => {
      const deployment = {
        id: 'dep_test_123',
        timestamp: new Date('2024-01-01T12:00:00Z')
      };

      const monitoringData = {
        correlatedAlerts: [
          {
            correlation: {
              timeProximity: 0.9,
              serviceMatch: 0.8,
              severityMatch: 0.7
            },
            severity: 'critical'
          },
          {
            correlation: {
              timeProximity: 0.8,
              serviceMatch: 0.6,
              severityMatch: 0.5
            },
            severity: 'high'
          }
        ]
      };

      const confidence = tracker.calculateCorrelationConfidence(deployment, monitoringData);

      expect(confidence).toBeGreaterThan(0.7);
      expect(confidence).toBeLessThanOrEqual(1.0);
    });

    test('should calculate low confidence for weak correlations', () => {
      const deployment = {
        id: 'dep_test_123'
      };

      const monitoringData = {
        correlatedAlerts: [
          {
            correlation: {
              timeProximity: 0.2,
              serviceMatch: 0.1,
              severityMatch: 0.3
            },
            severity: 'low'
          }
        ]
      };

      const confidence = tracker.calculateCorrelationConfidence(deployment, monitoringData);

      expect(confidence).toBeLessThan(0.3);
    });
  });

  describe('Deployment Status Updates', () => {
    test('should auto-complete deployment after timeout', () => {
      const deployment = {
        timestamp: new Date(Date.now() - 700000), // 11+ minutes ago
        status: 'in_progress',
        metrics: {}
      };

      tracker.updateDeploymentStatus(deployment);

      expect(deployment.status).toBe('completed');
      expect(deployment.metrics.endTime).toBeInstanceOf(Date);
      expect(deployment.metrics.duration).toBeGreaterThan(600000);
    });

    test('should mark deployment as failed for critical anomalies', () => {
      tracker.broadcast = jest.fn();
      tracker.triggerIncident = jest.fn();

      const deployment = {
        id: 'dep_test_123',
        status: 'in_progress',
        anomalies: []
      };

      const anomalies = [
        { type: 'critical_alerts', severity: 'critical' }
      ];

      tracker.handleDeploymentAnomalies(deployment, anomalies);

      expect(deployment.status).toBe('failed');
      expect(deployment.anomalies).toEqual(anomalies);
      expect(tracker.triggerIncident).toHaveBeenCalledWith(deployment, anomalies);
    });

    test('should mark deployment as degraded for multiple high anomalies', () => {
      const degradedSpy = jest.fn();
      tracker.on('deployment_degraded', degradedSpy);
      tracker.broadcast = jest.fn();
      tracker.triggerIncident = jest.fn();

      const deployment = {
        id: 'dep_test_123',
        status: 'in_progress'
      };

      const anomalies = [
        { type: 'error_rate_spike', severity: 'high' },
        { type: 'memory_spike', severity: 'high' }
      ];

      tracker.handleDeploymentAnomalies(deployment, anomalies);

      expect(deployment.status).toBe('degraded');
      expect(degradedSpy).toHaveBeenCalledWith(deployment, anomalies);
      expect(tracker.triggerIncident).not.toHaveBeenCalled();
    });
  });
});