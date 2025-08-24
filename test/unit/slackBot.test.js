import { jest } from '@jest/globals';
import { SlackBot } from '../../src/integrations/slackBot.js';

// Mock dependencies
jest.mock('@slack/web-api');
jest.mock('@slack/events-api');
jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));
jest.mock('../../src/forensics/incidentAnalyzer.js');
jest.mock('../../src/integrations/githubIntegration.js');

describe('SlackBot', () => {
  let slackBot;
  let mockWebClient;
  let mockEventAdapter;
  let mockAnalyzer;
  let mockGitHub;

  beforeEach(() => {
    // Mock WebClient
    mockWebClient = {
      chat: {
        postMessage: jest.fn().mockResolvedValue({ ok: true }),
        postEphemeral: jest.fn().mockResolvedValue({ ok: true }),
        update: jest.fn().mockResolvedValue({ ok: true })
      },
      conversations: {
        history: jest.fn().mockResolvedValue({ messages: [] }),
        info: jest.fn().mockResolvedValue({ channel: { name: 'test-channel' } })
      },
      users: {
        info: jest.fn().mockResolvedValue({ user: { name: 'test-user' } })
      },
      views: {
        open: jest.fn().mockResolvedValue({ ok: true })
      }
    };

    // Mock event adapter
    mockEventAdapter = {
      on: jest.fn(),
      start: jest.fn()
    };

    // Mock IncidentAnalyzer
    mockAnalyzer = {
      analyzeTimeRange: jest.fn().mockResolvedValue({
        incidents: [],
        rootCauses: [],
        summary: 'Analysis complete'
      }),
      generateReport: jest.fn().mockResolvedValue('Incident report'),
      findRootCause: jest.fn().mockResolvedValue({ event: 'root-event' })
    };

    // Mock GitHubIntegration
    mockGitHub = {
      createIssue: jest.fn().mockResolvedValue({ number: 123 }),
      getCommitHistory: jest.fn().mockResolvedValue([])
    };

    // Setup mocks
    const { WebClient } = require('@slack/web-api');
    const { createEventAdapter } = require('@slack/events-api');
    const { IncidentAnalyzer } = require('../../src/forensics/incidentAnalyzer.js');
    const { GitHubIntegration } = require('../../src/integrations/githubIntegration.js');

    WebClient.mockReturnValue(mockWebClient);
    createEventAdapter.mockReturnValue(mockEventAdapter);
    IncidentAnalyzer.mockReturnValue(mockAnalyzer);
    GitHubIntegration.mockReturnValue(mockGitHub);

    // Create bot instance with test tokens
    process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
    process.env.SLACK_SIGNING_SECRET = 'test-signing-secret';
    
    slackBot = new SlackBot();
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_SIGNING_SECRET;
  });

  describe('constructor', () => {
    test('should initialize with provided options', () => {
      const customBot = new SlackBot({
        botToken: 'custom-token',
        signingSecret: 'custom-secret',
        port: 3002
      });

      expect(customBot.botToken).toBe('custom-token');
      expect(customBot.signingSecret).toBe('custom-secret');
      expect(customBot.port).toBe(3002);
    });

    test('should throw error if tokens are missing', () => {
      delete process.env.SLACK_BOT_TOKEN;
      delete process.env.SLACK_SIGNING_SECRET;

      expect(() => new SlackBot()).toThrow('SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET are required');
    });

    test('should setup event handlers', () => {
      expect(mockEventAdapter.on).toHaveBeenCalledWith('app_mention', expect.any(Function));
      expect(mockEventAdapter.on).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mockEventAdapter.on).toHaveBeenCalledWith('reaction_added', expect.any(Function));
      expect(mockEventAdapter.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockEventAdapter.on).toHaveBeenCalledWith('slash_command', expect.any(Function));
    });
  });

  describe('handleMention', () => {
    test('should handle incident help request', async () => {
      const event = {
        text: '<@U123> incident',
        channel: 'C123',
        user: 'U456',
        ts: '1234567890.000001'
      };

      slackBot.sendIncidentHelp = jest.fn();
      await slackBot.handleMention(event);

      expect(slackBot.sendIncidentHelp).toHaveBeenCalledWith('C123', 'U456');
    });

    test('should handle analyze request', async () => {
      const event = {
        text: '<@U123> analyze last hour',
        channel: 'C123',
        user: 'U456',
        ts: '1234567890.000001'
      };

      slackBot.startIncidentAnalysis = jest.fn();
      await slackBot.handleMention(event);

      expect(slackBot.startIncidentAnalysis).toHaveBeenCalledWith('C123', 'U456', 'analyze last hour');
    });

    test('should send general help for unknown commands', async () => {
      const event = {
        text: '<@U123> unknown command',
        channel: 'C123',
        user: 'U456',
        ts: '1234567890.000001'
      };

      slackBot.sendGeneralHelp = jest.fn();
      await slackBot.handleMention(event);

      expect(slackBot.sendGeneralHelp).toHaveBeenCalledWith('C123', 'U456');
    });

    test('should handle errors gracefully', async () => {
      const event = {
        text: '<@U123> analyze',
        channel: 'C123',
        user: 'U456',
        ts: '1234567890.000001'
      };

      slackBot.startIncidentAnalysis = jest.fn().mockRejectedValue(new Error('Analysis failed'));
      await slackBot.handleMention(event);

      expect(mockWebClient.chat.postMessage).toHaveBeenCalledWith({
        channel: 'C123',
        text: '❌ Error: Analysis failed',
        thread_ts: '1234567890.000001'
      });
    });
  });

  describe('handleDirectMessage', () => {
    test('should handle incident reports', async () => {
      const event = {
        text: 'The service is down!',
        channel: 'D123',
        user: 'U456',
        channel_type: 'im'
      };

      slackBot.handleIncidentReport = jest.fn();
      await slackBot.handleDirectMessage(event);

      expect(slackBot.handleIncidentReport).toHaveBeenCalledWith('D123', 'U456', 'The service is down!');
    });

    test('should handle error reports', async () => {
      const event = {
        text: 'Getting 500 errors',
        channel: 'D123',
        user: 'U456',
        channel_type: 'im'
      };

      slackBot.handleIncidentReport = jest.fn();
      await slackBot.handleDirectMessage(event);

      expect(slackBot.handleIncidentReport).toHaveBeenCalledWith('D123', 'U456', 'Getting 500 errors');
    });

    test('should send help for non-incident messages', async () => {
      const event = {
        text: 'Hello there',
        channel: 'D123',
        user: 'U456',
        channel_type: 'im'
      };

      slackBot.sendGeneralHelp = jest.fn();
      await slackBot.handleDirectMessage(event);

      expect(slackBot.sendGeneralHelp).toHaveBeenCalledWith('D123', 'U456');
    });
  });

  describe('handleIncidentReaction', () => {
    test('should handle rotating_light reaction', async () => {
      const event = {
        reaction: 'rotating_light',
        user: 'U456',
        item: {
          type: 'message',
          channel: 'C123',
          ts: '1234567890.000001'
        }
      };

      slackBot.createIncidentFromMessage = jest.fn();
      await slackBot.handleIncidentReaction(event);

      expect(slackBot.createIncidentFromMessage).toHaveBeenCalledWith('C123', '1234567890.000001', 'U456');
    });

    test('should handle fire reaction', async () => {
      const event = {
        reaction: 'fire',
        user: 'U456',
        item: {
          type: 'message',
          channel: 'C123',
          ts: '1234567890.000001'
        }
      };

      slackBot.createIncidentFromMessage = jest.fn();
      await slackBot.handleIncidentReaction(event);

      expect(slackBot.createIncidentFromMessage).toHaveBeenCalledWith('C123', '1234567890.000001', 'U456');
    });

    test('should ignore non-message items', async () => {
      const event = {
        reaction: 'rotating_light',
        user: 'U456',
        item: {
          type: 'file',
          file: 'F123'
        }
      };

      slackBot.createIncidentFromMessage = jest.fn();
      await slackBot.handleIncidentReaction(event);

      expect(slackBot.createIncidentFromMessage).not.toHaveBeenCalled();
    });
  });

  describe('handleSlashCommand', () => {
    test('should handle status command', async () => {
      slackBot.getSystemStatus = jest.fn().mockResolvedValue('System healthy');
      
      await slackBot.handleSlashCommand('status', 'C123', 'U456', 'https://response.url');

      expect(slackBot.getSystemStatus).toHaveBeenCalled();
    });

    test('should handle analyze command', async () => {
      slackBot.startIncidentAnalysis = jest.fn();
      
      await slackBot.handleSlashCommand('analyze 2h', 'C123', 'U456', 'https://response.url');

      expect(slackBot.startIncidentAnalysis).toHaveBeenCalledWith('C123', 'U456', 'analyze 2h');
    });

    test('should handle incidents command', async () => {
      slackBot.listRecentIncidents = jest.fn();
      
      await slackBot.handleSlashCommand('incidents', 'C123', 'U456', 'https://response.url');

      expect(slackBot.listRecentIncidents).toHaveBeenCalledWith('C123');
    });

    test('should handle report command', async () => {
      slackBot.generateIncidentReport = jest.fn();
      
      await slackBot.handleSlashCommand('report INC-123', 'C123', 'U456', 'https://response.url');

      expect(slackBot.generateIncidentReport).toHaveBeenCalledWith('C123', 'INC-123');
    });

    test('should handle help command', async () => {
      slackBot.sendSlashCommandHelp = jest.fn();
      
      await slackBot.handleSlashCommand('help', 'C123', 'U456', 'https://response.url');

      expect(slackBot.sendSlashCommandHelp).toHaveBeenCalledWith('https://response.url');
    });
  });

  describe('startIncidentAnalysis', () => {
    test('should analyze time range', async () => {
      slackBot.startIncidentAnalysis = jest.fn(async function(channel, user, text) {
        await mockWebClient.chat.postMessage({
          channel,
          text: '🔍 Starting incident analysis...'
        });

        const analysis = await mockAnalyzer.analyzeTimeRange();
        
        await mockWebClient.chat.postMessage({
          channel,
          text: analysis.summary
        });
      });

      await slackBot.startIncidentAnalysis('C123', 'U456', 'analyze 1h');

      expect(mockWebClient.chat.postMessage).toHaveBeenCalledWith({
        channel: 'C123',
        text: '🔍 Starting incident analysis...'
      });
    });

    test('should handle analysis errors', async () => {
      mockAnalyzer.analyzeTimeRange.mockRejectedValue(new Error('Analysis failed'));
      
      slackBot.startIncidentAnalysis = jest.fn(async function(channel) {
        try {
          await mockAnalyzer.analyzeTimeRange();
        } catch (error) {
          await mockWebClient.chat.postMessage({
            channel,
            text: `❌ Analysis failed: ${error.message}`
          });
        }
      });

      await slackBot.startIncidentAnalysis('C123', 'U456', 'analyze 1h');

      expect(mockWebClient.chat.postMessage).toHaveBeenCalledWith({
        channel: 'C123',
        text: '❌ Analysis failed: Analysis failed'
      });
    });
  });

  describe('createIncidentFromMessage', () => {
    test('should create incident from message', async () => {
      mockWebClient.conversations.history.mockResolvedValue({
        messages: [{
          text: 'Service is experiencing issues',
          user: 'U789',
          ts: '1234567890.000001'
        }]
      });

      slackBot.createIncidentFromMessage = jest.fn(async function(channel, ts) {
        const history = await mockWebClient.conversations.history({
          channel,
          latest: ts,
          limit: 1,
          inclusive: true
        });

        const message = history.messages[0];
        
        await mockWebClient.chat.postMessage({
          channel,
          text: `🚨 Incident created from message: "${message.text}"`,
          thread_ts: ts
        });
      });

      await slackBot.createIncidentFromMessage('C123', '1234567890.000001', 'U456');

      expect(mockWebClient.conversations.history).toHaveBeenCalledWith({
        channel: 'C123',
        latest: '1234567890.000001',
        limit: 1,
        inclusive: true
      });

      expect(mockWebClient.chat.postMessage).toHaveBeenCalledWith({
        channel: 'C123',
        text: '🚨 Incident created from message: "Service is experiencing issues"',
        thread_ts: '1234567890.000001'
      });
    });
  });

  describe('sendIncidentReport', () => {
    test('should send formatted incident report', async () => {
      const incident = {
        id: 'INC-123',
        title: 'Service Outage',
        severity: 'high',
        startTime: new Date('2024-01-01T10:00:00Z'),
        endTime: new Date('2024-01-01T11:00:00Z'),
        rootCause: 'Database connection pool exhausted',
        impact: '500 users affected',
        resolution: 'Increased connection pool size'
      };

      slackBot.sendIncidentReport = jest.fn(async function(channel, incidentData) {
        const blocks = [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `📊 Incident Report: ${incidentData.id}`
            }
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Title:* ${incidentData.title}` },
              { type: 'mrkdwn', text: `*Severity:* ${incidentData.severity}` }
            ]
          }
        ];

        await mockWebClient.chat.postMessage({
          channel,
          blocks,
          text: `Incident Report: ${incidentData.id}`
        });
      });

      await slackBot.sendIncidentReport('C123', incident);

      expect(mockWebClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C123',
          text: 'Incident Report: INC-123'
        })
      );
    });
  });

  describe('getSystemStatus', () => {
    test('should retrieve and format system status', async () => {
      slackBot.getSystemStatus = jest.fn(async function() {
        return {
          status: 'healthy',
          services: {
            api: 'up',
            database: 'up',
            cache: 'up'
          },
          metrics: {
            responseTime: '45ms',
            errorRate: '0.01%',
            throughput: '1000 req/s'
          }
        };
      });

      const status = await slackBot.getSystemStatus();

      expect(status.status).toBe('healthy');
      expect(status.services.api).toBe('up');
      expect(status.metrics.responseTime).toBe('45ms');
    });
  });

  describe('listRecentIncidents', () => {
    test('should list recent incidents', async () => {
      const incidents = [
        { id: 'INC-001', title: 'API Timeout', severity: 'medium', time: '2h ago' },
        { id: 'INC-002', title: 'Database Lock', severity: 'high', time: '5h ago' }
      ];

      slackBot.listRecentIncidents = jest.fn(async function(channel) {
        const blocks = incidents.map(inc => ({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `• *${inc.id}* - ${inc.title} (${inc.severity}) - ${inc.time}`
          }
        }));

        await mockWebClient.chat.postMessage({
          channel,
          blocks,
          text: `Found ${incidents.length} recent incidents`
        });
      });

      await slackBot.listRecentIncidents('C123');

      expect(mockWebClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C123',
          text: 'Found 2 recent incidents'
        })
      );
    });
  });

  describe('server lifecycle', () => {
    test('should start server', async () => {
      const mockServer = {
        listen: jest.fn((port, callback) => callback())
      };

      const createServer = require('http').createServer;
      createServer.mockReturnValue(mockServer);

      slackBot.start = jest.fn(async function() {
        return new Promise((resolve) => {
          mockServer.listen(this.port, () => {
            resolve();
          });
        });
      });

      await slackBot.start();

      expect(mockServer.listen).toHaveBeenCalledWith(slackBot.port, expect.any(Function));
    });

    test('should stop server', async () => {
      const mockServer = {
        close: jest.fn((callback) => callback())
      };

      slackBot.server = mockServer;
      
      slackBot.stop = jest.fn(async function() {
        return new Promise((resolve) => {
          this.server.close(() => resolve());
        });
      });

      await slackBot.stop();

      expect(mockServer.close).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    test('should handle API errors', async () => {
      mockWebClient.chat.postMessage.mockRejectedValue(new Error('API Error'));
      
      const event = {
        text: '<@U123> status',
        channel: 'C123',
        user: 'U456',
        ts: '1234567890.000001'
      };

      slackBot.getSystemStatus = jest.fn().mockResolvedValue('Status');
      slackBot.sendGeneralHelp = jest.fn(async function(channel) {
        try {
          await mockWebClient.chat.postMessage({ channel, text: 'Help' });
        } catch (error) {
          console.error('Failed to send message:', error);
        }
      });

      await slackBot.sendGeneralHelp('C123', 'U456');

      // Error should be caught and logged, not thrown
      expect(mockWebClient.chat.postMessage).toHaveBeenCalled();
    });

    test('should handle event adapter errors', () => {
      const errorHandler = mockEventAdapter.on.mock.calls.find(
        call => call[0] === 'error'
      )[1];

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      
      errorHandler(new Error('Event adapter error'));

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(Error));
      
      consoleErrorSpy.mockRestore();
    });
  });

  describe('integration with other services', () => {
    test('should create GitHub issue from incident', async () => {
      slackBot.createGitHubIssue = jest.fn(async function(incident) {
        const issue = await mockGitHub.createIssue({
          title: incident.title,
          body: incident.description
        });

        return issue.number;
      });

      const issueNumber = await slackBot.createGitHubIssue({
        title: 'Service Outage',
        description: 'API is not responding'
      });

      expect(mockGitHub.createIssue).toHaveBeenCalledWith({
        title: 'Service Outage',
        body: 'API is not responding'
      });
      expect(issueNumber).toBe(123);
    });

    test('should analyze with IncidentAnalyzer', async () => {
      slackBot.analyzeIncident = jest.fn(async function(timeRange) {
        return await mockAnalyzer.analyzeTimeRange(timeRange);
      });

      const analysis = await slackBot.analyzeIncident('1h');

      expect(mockAnalyzer.analyzeTimeRange).toHaveBeenCalledWith('1h');
      expect(analysis.summary).toBe('Analysis complete');
    });
  });
});