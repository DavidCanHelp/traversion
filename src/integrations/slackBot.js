import { WebClient, LogLevel } from '@slack/web-api';
import { logger } from '../utils/logger.js';
import { createEventAdapter } from '@slack/events-api';
import { createServer } from 'http';
import { IncidentAnalyzer } from '../forensics/incidentAnalyzer.js';
import { GitHubIntegration } from './githubIntegration.js';

export class SlackBot {
  constructor(options = {}) {
    this.botToken = options.botToken || process.env.SLACK_BOT_TOKEN;
    this.signingSecret = options.signingSecret || process.env.SLACK_SIGNING_SECRET;
    this.port = options.port || 3001;
    
    if (!this.botToken || !this.signingSecret) {
      throw new Error('SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET are required');
    }

    this.client = new WebClient(this.botToken, {
      logLevel: LogLevel.INFO
    });

    this.events = createEventAdapter(this.signingSecret);
    this.analyzer = new IncidentAnalyzer();
    this.github = new GitHubIntegration();
    
    this.setupEventHandlers();
    this.setupSlashCommands();
  }

  setupEventHandlers() {
    // Handle app mentions
    this.events.on('app_mention', async (event) => {
      await this.handleMention(event);
    });

    // Handle direct messages
    this.events.on('message', async (event) => {
      if (event.channel_type === 'im' && !event.bot_id) {
        await this.handleDirectMessage(event);
      }
    });

    // Handle reactions for incident tagging
    this.events.on('reaction_added', async (event) => {
      if (event.reaction === 'rotating_light' || event.reaction === 'fire') {
        await this.handleIncidentReaction(event);
      }
    });

    this.events.on('error', console.error);
  }

  setupSlashCommands() {
    this.events.on('slash_command', async (event) => {
      const { command, text, channel_id, user_id, response_url } = event;
      
      if (command === '/traversion' || command === '/trav') {
        await this.handleSlashCommand(text, channel_id, user_id, response_url);
      }
    });
  }

  async handleMention(event) {
    const { text, channel, user, ts } = event;
    
    try {
      // Parse the mention for commands
      const cleanText = text.replace(/<@[^>]+>/, '').trim();
      
      if (cleanText.includes('incident') || cleanText.includes('help')) {
        await this.sendIncidentHelp(channel, user);
      } else if (cleanText.includes('analyze') || cleanText.includes('forensics')) {
        await this.startIncidentAnalysis(channel, user, cleanText);
      } else {
        await this.sendGeneralHelp(channel, user);
      }
    } catch (error) {
      await this.client.chat.postMessage({
        channel,
        text: `❌ Error: ${error.message}`,
        thread_ts: ts
      });
    }
  }

  async handleDirectMessage(event) {
    const { text, channel, user } = event;
    
    // Handle direct messages as incident reports
    if (text.toLowerCase().includes('incident') || text.toLowerCase().includes('down') || text.toLowerCase().includes('error')) {
      await this.handleIncidentReport(channel, user, text);
    } else {
      await this.sendGeneralHelp(channel, user);
    }
  }

  async handleIncidentReaction(event) {
    const { item, user, reaction } = event;
    
    if (item.type === 'message') {
      // Get the original message
      const result = await this.client.conversations.history({
        channel: item.channel,
        latest: item.ts,
        limit: 1,
        inclusive: true
      });

      if (result.messages && result.messages[0]) {
        const message = result.messages[0];
        await this.analyzeIncidentFromMessage(item.channel, user, message, reaction);
      }
    }
  }

  async handleSlashCommand(text, channelId, userId, responseUrl) {
    const args = text.split(' ').filter(arg => arg.length > 0);
    const command = args[0];

    try {
      switch (command) {
        case 'incident':
          await this.processIncidentCommand(args.slice(1), channelId, userId);
          break;
        case 'pr':
          await this.processPRCommand(args.slice(1), channelId, userId);
          break;
        case 'help':
          await this.sendDetailedHelp(channelId, userId);
          break;
        default:
          await this.sendCommandHelp(channelId, userId);
      }
    } catch (error) {
      await this.client.chat.postMessage({
        channel: channelId,
        text: `❌ Error executing command: ${error.message}`
      });
    }
  }

  async processIncidentCommand(args, channelId, userId) {
    // Parse incident command arguments
    const options = this.parseIncidentArgs(args);
    
    await this.client.chat.postMessage({
      channel: channelId,
      text: '🔍 Analyzing incident... This may take a moment.',
      blocks: [{
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🕵️ *Starting incident forensics analysis*\n📅 Looking back ${options.hours} hours from ${options.time || 'now'}`
        }
      }]
    });

    try {
      const incidentTime = options.time ? new Date(options.time) : new Date();
      const analysis = await this.analyzer.analyzeIncident(
        incidentTime, 
        options.hours, 
        options.files || []
      );

      await this.sendIncidentAnalysis(channelId, analysis);
    } catch (error) {
      await this.client.chat.postMessage({
        channel: channelId,
        text: `❌ Incident analysis failed: ${error.message}`
      });
    }
  }

  async processPRCommand(args, channelId, userId) {
    if (args.length < 1) {
      await this.client.chat.postMessage({
        channel: channelId,
        text: '❌ Please provide PR in format: `owner/repo/number`\nExample: `/trav pr microsoft/vscode/1234`'
      });
      return;
    }

    const [owner, repo, number] = args[0].split('/');
    if (!owner || !repo || !number) {
      await this.client.chat.postMessage({
        channel: channelId,
        text: '❌ Invalid PR format. Use: `owner/repo/number`'
      });
      return;
    }

    await this.client.chat.postMessage({
      channel: channelId,
      text: `🔍 Analyzing PR #${number} in ${owner}/${repo}...`
    });

    try {
      const analysis = await this.github.analyzePullRequest(owner, repo, parseInt(number));
      await this.sendPRAnalysis(channelId, analysis);
    } catch (error) {
      await this.client.chat.postMessage({
        channel: channelId,
        text: `❌ PR analysis failed: ${error.message}`
      });
    }
  }

  async sendIncidentAnalysis(channelId, analysis) {
    const riskEmoji = analysis.suspiciousCommits.length > 3 ? '🚨' : 
                     analysis.suspiciousCommits.length > 1 ? '⚠️' : '✅';

    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${riskEmoji} Incident Forensics Report`,
          emoji: true
        }
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Incident Time:*\n${analysis.incidentTime.toISOString()}`
          },
          {
            type: 'mrkdwn',
            text: `*Suspicious Commits:*\n${analysis.suspiciousCommits.length}`
          },
          {
            type: 'mrkdwn',
            text: `*High Risk:*\n${analysis.impactAnalysis.highRiskCommits}`
          },
          {
            type: 'mrkdwn',
            text: `*Authors Involved:*\n${analysis.impactAnalysis.authorsInvolved}`
          }
        ]
      }
    ];

    if (analysis.suspiciousCommits.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*🎯 Top Suspects:*'
        }
      });

      // Add top 3 suspicious commits
      analysis.suspiciousCommits.slice(0, 3).forEach((commit, index) => {
        const riskEmoji = commit.riskScore > 0.7 ? '🚨' : commit.riskScore > 0.4 ? '⚠️' : '🟡';
        
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${index + 1}. ${riskEmoji} \`${commit.shortHash}\` ${commit.message}\n` +
                  `👤 ${commit.author} | ⏰ ${commit.date.toLocaleString()}\n` +
                  `📊 Risk: ${(commit.riskScore * 100).toFixed(0)}% | Files: ${commit.filesChanged.length} | +${commit.linesChanged.additions}/-${commit.linesChanged.deletions}\n` +
                  (commit.riskFactors.length > 0 ? `🏷️ ${commit.riskFactors.join(', ')}` : '')
          }
        });
      });

      // Add recommendations
      if (analysis.recommendations.length > 0) {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*💡 Recommendations:*'
          }
        });

        const recommendationText = analysis.recommendations.map(rec => {
          const emoji = rec.priority === 'high' ? '🔴' : rec.priority === 'medium' ? '🟡' : '🔵';
          return `${emoji} *${rec.category.toUpperCase()}:* ${rec.message}`;
        }).join('\n');

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: recommendationText
          }
        });
      }
    } else {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '✨ *No suspicious commits found in the timeframe.*\nConsider expanding the search window or checking for infrastructure changes outside version control.'
        }
      });
    }

    await this.client.chat.postMessage({
      channel: channelId,
      blocks
    });
  }

  async sendPRAnalysis(channelId, analysis) {
    const riskEmoji = analysis.riskScore > 0.7 ? '🚨' : analysis.riskScore > 0.4 ? '⚠️' : '✅';

    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${riskEmoji} Pull Request Analysis`,
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*PR #${analysis.pr.number}:* ${analysis.pr.title}\n` +
                `*Author:* ${analysis.pr.author}\n` +
                `*Risk Score:* ${(analysis.riskScore * 100).toFixed(0)}%\n` +
                `*Changes:* +${analysis.pr.additions} -${analysis.pr.deletions} (${analysis.pr.changedFiles} files)`
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*📊 Impact Assessment:*\n` +
                `• *Scope:* ${analysis.impactAssessment.scope}\n` +
                `• *Complexity:* ${analysis.impactAssessment.complexity}\n` +
                (analysis.impactAssessment.riskAreas.length > 0 ? 
                  `• *Risk Areas:* ${analysis.impactAssessment.riskAreas.join(', ')}` : '')
        }
      }
    ];

    if (analysis.impactAssessment.testingNeeds.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🧪 Testing Recommendations:*\n${analysis.impactAssessment.testingNeeds.map(need => `• ${need}`).join('\n')}`
        }
      });
    }

    if (analysis.recommendations.length > 0) {
      const recommendationText = analysis.recommendations.map(rec => {
        const emoji = rec.priority === 'high' ? '🔴' : rec.priority === 'medium' ? '🟡' : '🔵';
        return `${emoji} *${rec.category.toUpperCase()}:* ${rec.message}`;
      }).join('\n');

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*💡 Recommendations:*\n${recommendationText}`
        }
      });
    }

    await this.client.chat.postMessage({
      channel: channelId,
      blocks
    });
  }

  async sendIncidentHelp(channelId, userId) {
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '🚨 *Incident Response Help*\n\nHere are the commands you can use:'
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '• `/trav incident` - Analyze current incident\n' +
                '• `/trav incident --time "2 hours ago" --hours 24` - Analyze with custom time\n' +
                '• `/trav incident --files "server.js,config.yml"` - Focus on specific files\n' +
                '• React with 🚨 or 🔥 to any message to start analysis'
        }
      }
    ];

    await this.client.chat.postMessage({
      channel: channelId,
      blocks
    });
  }

  async sendDetailedHelp(channelId, userId) {
    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🕵️ Traversion Help',
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Available Commands:*'
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '• `/trav incident [options]` - Incident forensics\n' +
                '• `/trav pr owner/repo/number` - PR risk analysis\n' +
                '• `/trav help` - Show this help'
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Quick Actions:*\n' +
                '• React with 🚨 to any message to analyze as incident\n' +
                '• DM me with incident details for immediate analysis\n' +
                '• Mention me with "incident" or "help" for guidance'
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Examples:*\n' +
                '`/trav incident --time "30 minutes ago" --hours 6`\n' +
                '`/trav pr microsoft/typescript/12345`\n' +
                '`@traversion help with this incident please`'
        }
      }
    ];

    await this.client.chat.postMessage({
      channel: channelId,
      blocks
    });
  }

  parseIncidentArgs(args) {
    const options = {
      hours: 24,
      time: null,
      files: []
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      
      if (arg === '--hours' && i + 1 < args.length) {
        options.hours = parseInt(args[i + 1]);
        i++; // Skip next arg
      } else if (arg === '--time' && i + 1 < args.length) {
        options.time = args[i + 1];
        i++; // Skip next arg
      } else if (arg === '--files' && i + 1 < args.length) {
        options.files = args[i + 1].split(',').map(f => f.trim());
        i++; // Skip next arg
      }
    }

    return options;
  }

  async handleIncidentReport(channelId, userId, text) {
    // Parse incident details from message
    const timeRegex = /(\d+)\s*(minute|hour|day)s?\s*ago/i;
    const timeMatch = text.match(timeRegex);
    
    let incidentTime = new Date();
    if (timeMatch) {
      const [, amount, unit] = timeMatch;
      const multiplier = unit.toLowerCase() === 'minute' ? 60 * 1000 :
                        unit.toLowerCase() === 'hour' ? 60 * 60 * 1000 :
                        24 * 60 * 60 * 1000;
      incidentTime = new Date(Date.now() - (parseInt(amount) * multiplier));
    }

    await this.client.chat.postMessage({
      channel: channelId,
      text: '🔍 I\'ll analyze this incident for you. Starting forensics...'
    });

    try {
      const analysis = await this.analyzer.analyzeIncident(incidentTime, 24, []);
      await this.sendIncidentAnalysis(channelId, analysis);
    } catch (error) {
      await this.client.chat.postMessage({
        channel: channelId,
        text: `❌ Analysis failed: ${error.message}`
      });
    }
  }

  async analyzeIncidentFromMessage(channelId, userId, message, reaction) {
    await this.client.chat.postMessage({
      channel: channelId,
      text: `🔍 ${reaction === 'fire' ? 'Fire' : 'Incident'} detected! Analyzing the situation...`,
      thread_ts: message.ts
    });

    try {
      // Extract potential incident time from message timestamp
      const incidentTime = new Date(parseFloat(message.ts) * 1000);
      const analysis = await this.analyzer.analyzeIncident(incidentTime, 12, []);
      
      await this.sendIncidentAnalysis(channelId, analysis);
    } catch (error) {
      await this.client.chat.postMessage({
        channel: channelId,
        text: `❌ Analysis failed: ${error.message}`,
        thread_ts: message.ts
      });
    }
  }

  async start() {
    const server = createServer(this.events.requestListener());
    
    server.listen(this.port, () => {
      logger.info(`🤖 Traversion Slack bot listening on port ${this.port}`);
      logger.info('📱 Ready to help with incident response!');
    });

    // Test the connection
    try {
      const auth = await this.client.auth.test();
      logger.info(`✅ Connected to Slack as ${auth.user} in team ${auth.team}`);
    } catch (error) {
      logger.error('❌ Failed to connect to Slack:', error);
    }

    return server;
  }

  // Utility method to send proactive incident alerts
  async sendIncidentAlert(channelId, incident) {
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🚨 *Incident Detected*\n${incident.description || 'No description provided'}`
        },
        accessory: {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Analyze',
            emoji: true
          },
          action_id: 'analyze_incident',
          value: JSON.stringify({
            time: incident.time || new Date().toISOString(),
            files: incident.affectedFiles || []
          })
        }
      }
    ];

    await this.client.chat.postMessage({
      channel: channelId,
      blocks
    });
  }

  // Method to create incident war room
  async createIncidentChannel(incidentId, participants = []) {
    const channelName = `incident-${incidentId}-${Date.now().toString().slice(-6)}`;
    
    try {
      const result = await this.client.conversations.create({
        name: channelName,
        is_private: false
      });

      const channelId = result.channel.id;

      // Invite participants
      if (participants.length > 0) {
        await this.client.conversations.invite({
          channel: channelId,
          users: participants.join(',')
        });
      }

      // Send initial incident brief
      await this.client.chat.postMessage({
        channel: channelId,
        text: `🚨 *Incident War Room Created*\n\nThis channel was created for incident \`${incidentId}\`.\n\nUse \`/trav incident\` to start forensic analysis.`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `🚨 *Incident War Room Created*\n\nThis channel was created for incident \`${incidentId}\`.`
            }
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: '🔍 Start Analysis',
                  emoji: true
                },
                action_id: 'start_analysis',
                style: 'primary'
              },
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: '📋 Get Help',
                  emoji: true
                },
                action_id: 'get_help'
              }
            ]
          }
        ]
      });

      return { channelId, channelName };
    } catch (error) {
      logger.error('Failed to create incident channel:', error);
      throw error;
    }
  }
}