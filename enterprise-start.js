#!/usr/bin/env node

/**
 * Enterprise Traversion Platform Startup
 * 
 * Launches the full enterprise incident management platform with all features:
 * - Real-time incident dashboard
 * - Intelligent severity analysis
 * - Team performance analytics
 * - Automated post-mortem generation
 * - Monitoring tool integrations
 * - Slack and GitHub integrations
 */

import { EnterprisePlatform } from './src/platform/enterprisePlatform.js';
import logger from './src/utils/logger.js';
import chalk from 'chalk';

// Configuration
const config = {
  // Main platform settings
  port: process.env.PLATFORM_PORT || 3350,
  dashboardPort: process.env.DASHBOARD_PORT || 3340,
  
  // Authentication settings
  auth: {
    jwtSecret: process.env.JWT_SECRET || 'enterprise-traversion-secret',
    sessionTimeout: parseInt(process.env.SESSION_TIMEOUT) || 3600000, // 1 hour
    rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW) || 60000, // 1 minute
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX) || 500
  },

  // Monitoring integrations
  monitoring: {
    datadog: process.env.DATADOG_API_KEY ? {
      apiKey: process.env.DATADOG_API_KEY,
      appKey: process.env.DATADOG_APP_KEY,
      baseUrl: process.env.DATADOG_BASE_URL
    } : null,

    newrelic: process.env.NEWRELIC_API_KEY ? {
      apiKey: process.env.NEWRELIC_API_KEY,
      baseUrl: process.env.NEWRELIC_BASE_URL
    } : null,

    grafana: process.env.GRAFANA_API_KEY ? {
      apiKey: process.env.GRAFANA_API_KEY,
      baseUrl: process.env.GRAFANA_BASE_URL
    } : null,

    prometheus: process.env.PROMETHEUS_ENDPOINT ? {
      endpoint: process.env.PROMETHEUS_ENDPOINT,
      username: process.env.PROMETHEUS_USERNAME,
      password: process.env.PROMETHEUS_PASSWORD
    } : null,

    pagerduty: process.env.PAGERDUTY_API_TOKEN ? {
      apiToken: process.env.PAGERDUTY_API_TOKEN
    } : null
  },

  // Slack integration
  slack: process.env.SLACK_BOT_TOKEN ? {
    botToken: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    appToken: process.env.SLACK_APP_TOKEN,
    port: process.env.SLACK_PORT || 3001
  } : null,

  // GitHub integration
  github: process.env.GITHUB_APP_ID ? {
    appId: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_PRIVATE_KEY,
    installationId: process.env.GITHUB_INSTALLATION_ID,
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET
  } : null
};

async function startPlatform() {
  console.log(chalk.cyan.bold('\n🚀 Starting Enterprise Traversion Platform\n'));

  try {
    // Display configuration
    displayConfiguration(config);

    // Initialize platform
    console.log(chalk.blue('Initializing platform components...'));
    const platform = new EnterprisePlatform(config);

    // Start platform
    console.log(chalk.blue('Starting platform services...'));
    await platform.start();

    // Display success information
    displayStartupSuccess(config);

    // Setup graceful shutdown
    setupGracefulShutdown(platform);

  } catch (error) {
    console.error(chalk.red.bold('❌ Failed to start platform:'), error.message);
    logger.error('Platform startup failed', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

function displayConfiguration(config) {
  console.log(chalk.yellow('📋 Platform Configuration:'));
  console.log(`   Main Platform: http://localhost:${config.port}`);
  console.log(`   Dashboard: http://localhost:${config.dashboardPort}`);
  
  console.log('\n📊 Enabled Features:');
  console.log('   ✅ Real-time Incident Dashboard');
  console.log('   ✅ Intelligent Severity Analysis');
  console.log('   ✅ Team Performance Analytics');
  console.log('   ✅ Automated Post-mortem Generation');
  console.log('   ✅ Git Integration & Forensics');
  console.log('   ✅ Incident Timeline Reconstruction');

  console.log('\n🔌 Integrations:');
  
  // Monitoring integrations
  const monitoringIntegrations = Object.keys(config.monitoring).filter(key => config.monitoring[key]);
  if (monitoringIntegrations.length > 0) {
    console.log(`   📈 Monitoring: ${monitoringIntegrations.map(capitalizeFirst).join(', ')}`);
  } else {
    console.log('   📈 Monitoring: None configured');
  }

  // Communication integrations
  const commsIntegrations = [];
  if (config.slack) commsIntegrations.push('Slack');
  if (config.github) commsIntegrations.push('GitHub');
  
  if (commsIntegrations.length > 0) {
    console.log(`   💬 Communications: ${commsIntegrations.join(', ')}`);
  } else {
    console.log('   💬 Communications: None configured');
  }

  console.log('\n🔐 Security Features:');
  console.log('   ✅ JWT Authentication');
  console.log('   ✅ Multi-tenant Isolation');
  console.log('   ✅ Rate Limiting');
  console.log('   ✅ Input Sanitization');
  console.log('   ✅ XSS Protection');
  console.log('   ✅ Command Injection Prevention');

  console.log('');
}

function displayStartupSuccess(config) {
  console.log(chalk.green.bold('\n🎉 Enterprise Traversion Platform Started Successfully!\n'));

  console.log(chalk.cyan('🌐 Access Points:'));
  console.log(`   Platform API: ${chalk.white.underline(`http://localhost:${config.port}`)}`);
  console.log(`   Dashboard: ${chalk.white.underline(`http://localhost:${config.dashboardPort}`)}`);
  
  console.log(chalk.cyan('\n📖 Quick Start Guide:'));
  console.log('   1. Create an incident:');
  console.log(`      POST ${chalk.white(`http://localhost:${config.port}/api/incidents`)}`);
  console.log('   2. View real-time dashboard:');
  console.log(`      ${chalk.white.underline(`http://localhost:${config.dashboardPort}`)}`);
  console.log('   3. Generate team performance report:');
  console.log(`      GET ${chalk.white(`http://localhost:${config.port}/api/analytics/team-performance`)}`);

  console.log(chalk.cyan('\n🔧 API Features:'));
  console.log('   📊 Real-time incident dashboard with WebSocket updates');
  console.log('   🧠 AI-powered severity analysis and recommendations');
  console.log('   📈 Team performance metrics and trending');
  console.log('   📝 Automated post-mortem generation');
  console.log('   🔍 Git forensics and change impact analysis');
  console.log('   🔔 Monitoring tool integrations and alert correlation');
  console.log('   👥 Team collaboration and workload management');

  if (config.slack) {
    console.log(chalk.cyan('\n💬 Slack Integration:'));
    console.log('   Use slash commands in Slack:');
    console.log('   • /traversion status - View active incidents');
    console.log('   • /traversion create - Create new incident');
    console.log('   • /traversion war-room - Start incident war room');
  }

  if (config.github) {
    console.log(chalk.cyan('\n🐙 GitHub Integration:'));
    console.log('   • Automatic PR risk assessment');
    console.log('   • Incident correlation with code changes');
    console.log('   • Comment-based incident updates');
  }

  console.log(chalk.cyan('\n📋 Environment Variables:'));
  console.log('   Set these for additional features:');
  console.log('   • JWT_SECRET - Authentication secret');
  console.log('   • DATADOG_API_KEY - DataDog integration');
  console.log('   • NEWRELIC_API_KEY - New Relic integration');
  console.log('   • SLACK_BOT_TOKEN - Slack integration');
  console.log('   • GITHUB_APP_ID - GitHub integration');

  console.log(chalk.green('\n✨ Platform is ready for enterprise incident management!'));
  console.log(chalk.gray('\nPress Ctrl+C to stop the platform\n'));
}

function setupGracefulShutdown(platform) {
  const signals = ['SIGTERM', 'SIGINT'];

  signals.forEach(signal => {
    process.on(signal, async () => {
      console.log(chalk.yellow(`\n🛑 Received ${signal}, shutting down gracefully...`));
      
      try {
        await platform.shutdown();
        console.log(chalk.green('✅ Platform shutdown complete'));
        process.exit(0);
      } catch (error) {
        console.error(chalk.red('❌ Error during shutdown:'), error.message);
        process.exit(1);
      }
    });
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    console.error(chalk.red.bold('❌ Uncaught Exception:'), error.message);
    logger.error('Uncaught exception', { error: error.message, stack: error.stack });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error(chalk.red.bold('❌ Unhandled Rejection:'), reason);
    logger.error('Unhandled promise rejection', { reason, promise });
    process.exit(1);
  });
}

function capitalizeFirst(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Start the platform
startPlatform().catch(error => {
  console.error(chalk.red.bold('❌ Startup failed:'), error.message);
  process.exit(1);
});