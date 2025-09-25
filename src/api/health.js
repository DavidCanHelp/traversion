import express from 'express';
import Database from 'better-sqlite3';
import Redis from 'ioredis';
import simpleGit from 'simple-git';
import { Octokit } from '@octokit/rest';
import os from 'os';
import { promisify } from 'util';
import { execSync } from 'child_process';

// Defer config import to avoid circular dependency
let config;
let logger;

const router = express.Router();

/**
 * Health Check and Monitoring Endpoints
 *
 * Provides comprehensive health checks for production monitoring
 * including dependencies, resources, and performance metrics.
 */
class HealthMonitor {
  constructor() {
    this.startTime = Date.now();
    this.checks = new Map();
    this.metrics = {
      requests: 0,
      errors: 0,
      latency: []
    };

    // Lazy load config and logger
    this.loadDependencies();
    this.initializeChecks();
  }

  async loadDependencies() {
    if (!config) {
      const configModule = await import('../config/index.js');
      config = configModule.default;
    }
    if (!logger) {
      const loggerModule = await import('../utils/logger.js');
      logger = loggerModule.default;
    }
  }

  /**
   * Initialize health check functions
   */
  initializeChecks() {
    // Database health check
    this.checks.set('database', async () => {
      try {
        await this.loadDependencies();
        const db = new Database(config.get('database.sqlite.path') || './.traversion/database.db');
        const result = db.prepare('SELECT 1 as healthy').get();
        db.close();

        return {
          status: 'healthy',
          type: config.get('database.type') || 'sqlite',
          details: {
            healthy: result.healthy === 1,
            path: config.get('database.sqlite.path') || './.traversion/database.db'
          }
        };
      } catch (error) {
        return {
          status: 'unhealthy',
          error: error.message,
          details: { type: 'sqlite' }
        };
      }
    });

    // Redis health check (if enabled)
    if (config.get('database.redis.enabled')) {
      this.checks.set('redis', async () => {
        try {
          const redis = new Redis({
            host: config.get('database.redis.host'),
            port: config.get('database.redis.port'),
            password: config.get('database.redis.password'),
            lazyConnect: true
          });

          await redis.connect();
          const pong = await redis.ping();
          await redis.quit();

          return {
            status: 'healthy',
            details: {
              ping: pong === 'PONG',
              host: config.get('database.redis.host'),
              port: config.get('database.redis.port')
            }
          };
        } catch (error) {
          return {
            status: 'unhealthy',
            error: error.message
          };
        }
      });
    }

    // Git health check
    this.checks.set('git', async () => {
      try {
        const git = simpleGit();
        const isRepo = await git.checkIsRepo();
        const branch = await git.branch();

        return {
          status: 'healthy',
          details: {
            isRepository: isRepo,
            currentBranch: branch.current,
            branches: branch.all.length
          }
        };
      } catch (error) {
        return {
          status: 'unhealthy',
          error: error.message
        };
      }
    });

    // GitHub API health check (if configured)
    if (config.get('github.enabled') && config.get('github.token')) {
      this.checks.set('github', async () => {
        try {
          const octokit = new Octokit({
            auth: config.get('github.token')
          });

          const { data } = await octokit.rateLimit.get();

          return {
            status: 'healthy',
            details: {
              rateLimit: data.rate.limit,
              remaining: data.rate.remaining,
              reset: new Date(data.rate.reset * 1000).toISOString()
            }
          };
        } catch (error) {
          return {
            status: 'unhealthy',
            error: error.message
          };
        }
      });
    }

    // Disk space health check
    this.checks.set('disk', async () => {
      try {
        const { execSync } = require('child_process');
        const dfOutput = execSync('df -h /').toString();
        const lines = dfOutput.trim().split('\n');
        const stats = lines[1].split(/\s+/);

        const used = parseInt(stats[4]);
        const status = used > 90 ? 'unhealthy' : used > 70 ? 'degraded' : 'healthy';

        return {
          status,
          details: {
            total: stats[1],
            used: stats[2],
            available: stats[3],
            usedPercent: stats[4]
          }
        };
      } catch (error) {
        return {
          status: 'unknown',
          error: error.message
        };
      }
    });

    // Memory health check
    this.checks.set('memory', () => {
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      const usedMemory = totalMemory - freeMemory;
      const usedPercent = (usedMemory / totalMemory) * 100;

      const status = usedPercent > 90 ? 'unhealthy' : usedPercent > 70 ? 'degraded' : 'healthy';

      return {
        status,
        details: {
          total: `${(totalMemory / 1024 / 1024 / 1024).toFixed(2)} GB`,
          free: `${(freeMemory / 1024 / 1024 / 1024).toFixed(2)} GB`,
          used: `${(usedMemory / 1024 / 1024 / 1024).toFixed(2)} GB`,
          usedPercent: `${usedPercent.toFixed(2)}%`,
          process: {
            rss: `${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)} MB`,
            heapUsed: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
            heapTotal: `${(process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2)} MB`
          }
        }
      };
    });

    // CPU health check
    this.checks.set('cpu', () => {
      const cpus = os.cpus();
      const loadAverage = os.loadavg();
      const loadPercent = (loadAverage[0] / cpus.length) * 100;

      const status = loadPercent > 90 ? 'unhealthy' : loadPercent > 70 ? 'degraded' : 'healthy';

      return {
        status,
        details: {
          cores: cpus.length,
          model: cpus[0].model,
          loadAverage: {
            '1min': loadAverage[0].toFixed(2),
            '5min': loadAverage[1].toFixed(2),
            '15min': loadAverage[2].toFixed(2)
          },
          loadPercent: `${loadPercent.toFixed(2)}%`
        }
      };
    });
  }

  /**
   * Run all health checks
   */
  async runAllChecks() {
    const results = {};
    const startTime = Date.now();

    for (const [name, check] of this.checks) {
      try {
        results[name] = await Promise.race([
          check(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Health check timeout')), 5000)
          )
        ]);
      } catch (error) {
        results[name] = {
          status: 'unhealthy',
          error: error.message
        };
      }
    }

    const executionTime = Date.now() - startTime;

    return {
      results,
      executionTime
    };
  }

  /**
   * Calculate overall health status
   */
  calculateOverallStatus(checks) {
    const statuses = Object.values(checks).map(c => c.status);

    if (statuses.some(s => s === 'unhealthy')) {
      return 'unhealthy';
    }

    if (statuses.some(s => s === 'degraded')) {
      return 'degraded';
    }

    return 'healthy';
  }

  /**
   * Get system metrics
   */
  getSystemMetrics() {
    const uptime = Date.now() - this.startTime;
    const avgLatency = this.metrics.latency.length > 0
      ? this.metrics.latency.reduce((a, b) => a + b, 0) / this.metrics.latency.length
      : 0;

    return {
      uptime: {
        ms: uptime,
        human: this.formatUptime(uptime)
      },
      requests: {
        total: this.metrics.requests,
        errors: this.metrics.errors,
        errorRate: this.metrics.requests > 0
          ? ((this.metrics.errors / this.metrics.requests) * 100).toFixed(2) + '%'
          : '0%'
      },
      latency: {
        avg: `${avgLatency.toFixed(2)}ms`,
        samples: this.metrics.latency.length
      },
      system: {
        platform: os.platform(),
        release: os.release(),
        hostname: os.hostname(),
        nodeVersion: process.version
      },
      process: {
        pid: process.pid,
        memory: process.memoryUsage(),
        cpuUsage: process.cpuUsage()
      }
    };
  }

  /**
   * Format uptime to human-readable string
   */
  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    }
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  /**
   * Record request metrics
   */
  recordRequest(latency, error = false) {
    this.metrics.requests++;
    if (error) {
      this.metrics.errors++;
    }

    this.metrics.latency.push(latency);

    // Keep only last 100 latency samples
    if (this.metrics.latency.length > 100) {
      this.metrics.latency.shift();
    }
  }
}

// Create singleton instance
const healthMonitor = new HealthMonitor();

/**
 * Basic health check endpoint (for load balancers)
 */
router.get('/health', (req, res) => {
  const startTime = Date.now();

  try {
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString()
    });

    healthMonitor.recordRequest(Date.now() - startTime);

  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });

    healthMonitor.recordRequest(Date.now() - startTime, true);
  }
});

/**
 * Liveness probe (Kubernetes)
 */
router.get('/health/live', (req, res) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString()
  });
});

/**
 * Readiness probe (Kubernetes)
 */
router.get('/health/ready', async (req, res) => {
  const startTime = Date.now();

  try {
    // Check critical dependencies
    const checks = await healthMonitor.runAllChecks();
    const criticalChecks = ['database'];

    const isReady = criticalChecks.every(
      check => checks.results[check]?.status === 'healthy'
    );

    const status = isReady ? 200 : 503;

    res.status(status).json({
      ready: isReady,
      checks: Object.fromEntries(
        criticalChecks.map(c => [c, checks.results[c]?.status || 'unknown'])
      ),
      timestamp: new Date().toISOString()
    });

    healthMonitor.recordRequest(Date.now() - startTime, !isReady);

  } catch (error) {
    res.status(503).json({
      ready: false,
      error: error.message
    });

    healthMonitor.recordRequest(Date.now() - startTime, true);
  }
});

/**
 * Detailed health check endpoint
 */
router.get('/health/detailed', async (req, res) => {
  const startTime = Date.now();

  try {
    const { results, executionTime } = await healthMonitor.runAllChecks();
    const overallStatus = healthMonitor.calculateOverallStatus(results);
    const metrics = healthMonitor.getSystemMetrics();

    const statusCode = overallStatus === 'healthy' ? 200 :
                       overallStatus === 'degraded' ? 200 : 503;

    res.status(statusCode).json({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      executionTime: `${executionTime}ms`,
      checks: results,
      metrics,
      version: config.get('app.version'),
      environment: config.get('app.env')
    });

    healthMonitor.recordRequest(Date.now() - startTime);

  } catch (error) {
    logger.error('Health check failed', { error: error.message });

    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });

    healthMonitor.recordRequest(Date.now() - startTime, true);
  }
});

/**
 * Metrics endpoint (Prometheus format)
 */
router.get('/metrics', (req, res) => {
  const metrics = healthMonitor.getSystemMetrics();

  const promMetrics = [
    `# HELP traversion_up Is the application up`,
    `# TYPE traversion_up gauge`,
    `traversion_up 1`,
    ``,
    `# HELP traversion_uptime_seconds Application uptime in seconds`,
    `# TYPE traversion_uptime_seconds counter`,
    `traversion_uptime_seconds ${Math.floor(metrics.uptime.ms / 1000)}`,
    ``,
    `# HELP traversion_requests_total Total number of requests`,
    `# TYPE traversion_requests_total counter`,
    `traversion_requests_total ${metrics.requests.total}`,
    ``,
    `# HELP traversion_errors_total Total number of errors`,
    `# TYPE traversion_errors_total counter`,
    `traversion_errors_total ${metrics.requests.errors}`,
    ``,
    `# HELP traversion_memory_usage_bytes Memory usage in bytes`,
    `# TYPE traversion_memory_usage_bytes gauge`,
    `traversion_memory_usage_bytes{type="rss"} ${metrics.process.memory.rss}`,
    `traversion_memory_usage_bytes{type="heapTotal"} ${metrics.process.memory.heapTotal}`,
    `traversion_memory_usage_bytes{type="heapUsed"} ${metrics.process.memory.heapUsed}`,
    ``,
    `# HELP traversion_nodejs_version_info Node.js version`,
    `# TYPE traversion_nodejs_version_info gauge`,
    `traversion_nodejs_version_info{version="${process.version}"} 1`
  ].join('\n');

  res.set('Content-Type', 'text/plain; version=0.0.4');
  res.send(promMetrics);
});

/**
 * Status endpoint
 */
router.get('/status', async (req, res) => {
  const { results } = await healthMonitor.runAllChecks();
  const overallStatus = healthMonitor.calculateOverallStatus(results);

  // Simple status page HTML
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Traversion Status</title>
      <meta http-equiv="refresh" content="30">
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          max-width: 800px;
          margin: 50px auto;
          padding: 20px;
        }
        h1 { color: #333; }
        .status {
          display: inline-block;
          padding: 5px 10px;
          border-radius: 4px;
          font-weight: bold;
          text-transform: uppercase;
        }
        .healthy { background: #4CAF50; color: white; }
        .degraded { background: #FF9800; color: white; }
        .unhealthy { background: #f44336; color: white; }
        .checks {
          margin-top: 20px;
          border-collapse: collapse;
          width: 100%;
        }
        .checks th, .checks td {
          text-align: left;
          padding: 12px;
          border-bottom: 1px solid #ddd;
        }
        .checks th { background: #f5f5f5; }
      </style>
    </head>
    <body>
      <h1>Traversion System Status</h1>
      <p>Overall Status: <span class="status ${overallStatus}">${overallStatus}</span></p>
      <p>Last Updated: ${new Date().toISOString()}</p>

      <table class="checks">
        <thead>
          <tr>
            <th>Component</th>
            <th>Status</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          ${Object.entries(results).map(([name, check]) => `
            <tr>
              <td>${name}</td>
              <td><span class="status ${check.status}">${check.status}</span></td>
              <td>${check.error || JSON.stringify(check.details || {})}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <p style="margin-top: 30px; color: #666;">
        Auto-refreshes every 30 seconds
      </p>
    </body>
    </html>
  `;

  res.set('Content-Type', 'text/html');
  res.send(html);
});

export default router;
export { healthMonitor };