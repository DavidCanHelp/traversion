#!/usr/bin/env node

/**
 * Traversion Production Demo
 * 
 * Demonstrates the complete production debugging experience:
 * - Event collection from multiple services
 * - Causality detection  
 * - Temporal queries
 * - Time-travel debugging
 * - Real-time visualization
 */

import CausalityEngine from './src/engine/causalityEngine.js';
import EventCollector from './src/collectors/eventCollector.js';
import TemporalQueryEngine from './src/engine/temporalQueryEngine.js';
import express from 'express';
import { WebSocketServer } from 'ws';
import chalk from 'chalk';
import open from 'open';

// Create core components
const causalityEngine = new CausalityEngine();
const queryEngine = new TemporalQueryEngine(causalityEngine);
const collectors = new Map();

// Create Express app for dashboard
const app = express();
const PORT = 3335;
const WS_PORT = 3336;

// WebSocket server for real-time updates
const wss = new WebSocketServer({ port: WS_PORT });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(chalk.green('✓ Dashboard connected'));
  
  // Send historical events to new client
  const events = Array.from(causalityEngine.causalityGraph.values());
  events.forEach(event => {
    ws.send(JSON.stringify(event));
  });
  
  ws.on('close', () => {
    clients.delete(ws);
    console.log(chalk.yellow('Dashboard disconnected'));
  });
});

// Broadcast event to all connected dashboards
function broadcastEvent(event) {
  const message = JSON.stringify(event);
  clients.forEach(client => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(message);
    }
  });
}

// Create collectors for different services
function createServiceCollector(serviceId, serviceName) {
  const collector = new EventCollector({
    serviceId,
    serviceName,
    environment: 'production'
  });
  
  // Connect to causality engine
  collector.on('event:collected', (event) => {
    causalityEngine.processEvent(event);
    broadcastEvent(event);
  });
  
  collectors.set(serviceId, collector);
  return collector;
}

// API endpoints for TimeQL queries
app.use(express.json());
app.use(express.static('public'));

app.post('/api/query', async (req, res) => {
  try {
    const { query } = req.body;
    const result = await queryEngine.query(query);
    res.json({ success: true, result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.get('/api/stats', (req, res) => {
  const stats = {
    events: causalityEngine.causalityGraph.size,
    services: collectors.size,
    queries: queryEngine.getStats(),
    causality: {
      chains: causalityEngine.activeChains.size,
      patterns: causalityEngine.patterns.size
    }
  };
  res.json(stats);
});

app.get('/api/state/:timestamp', async (req, res) => {
  const timestamp = parseInt(req.params.timestamp);
  const state = await queryEngine.queryStateAt({ timestamp });
  res.json(state);
});

// Serve production dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile('production-dashboard.html', { root: './public' });
});

/**
 * Simulate a production environment with multiple services
 */
async function simulateProduction() {
  console.log(chalk.bold.blue('\n🚀 Starting Production Simulation\n'));
  
  // Create service collectors
  const apiGateway = createServiceCollector('api-gateway', 'API Gateway');
  const authService = createServiceCollector('auth-service', 'Auth Service');
  const userService = createServiceCollector('user-service', 'User Service');
  const dbService = createServiceCollector('database', 'PostgreSQL');
  const cacheService = createServiceCollector('cache', 'Redis Cache');
  const paymentService = createServiceCollector('payment-service', 'Payment Service');
  
  console.log(chalk.green('✓ Services initialized'));
  
  // Simulate normal traffic
  console.log(chalk.yellow('\n📊 Phase 1: Normal Operations\n'));
  
  for (let i = 0; i < 5; i++) {
    await simulateUserRequest(apiGateway, authService, userService, dbService, cacheService);
    await sleep(200);
  }
  
  // Simulate gradual degradation
  console.log(chalk.yellow('\n⚠️  Phase 2: Gradual Degradation\n'));
  
  for (let i = 0; i < 3; i++) {
    await simulateDegradedRequest(apiGateway, authService, userService, dbService, cacheService);
    await sleep(300);
  }
  
  // Simulate cascade failure
  console.log(chalk.red('\n🔥 Phase 3: Cascade Failure\n'));
  
  await simulateCascadeFailure(apiGateway, authService, userService, dbService, cacheService, paymentService);
  
  // Demonstrate time-travel debugging
  console.log(chalk.magenta('\n⏰ Phase 4: Time-Travel Analysis\n'));
  
  await demonstrateTimeTravel();
  
  // Show TimeQL examples
  console.log(chalk.cyan('\n🔍 Phase 5: TimeQL Queries\n'));
  
  await demonstrateQueries();
}

/**
 * Simulate a normal user request
 */
async function simulateUserRequest(gateway, auth, user, db, cache) {
  // User makes request to API gateway
  const requestSpan = gateway.startSpan('GET /api/users/123');
  
  gateway.trackEvent('http:request', {
    method: 'GET',
    path: '/api/users/123',
    headers: { authorization: 'Bearer token123' }
  });
  
  // Gateway checks auth
  const authSpan = auth.startSpan('Verify Token', requestSpan);
  
  auth.trackEvent('auth:verify', {
    tokenHash: 'hash123',
    userId: '123'
  });
  
  // Check cache first
  cache.trackEvent('cache:get', {
    key: 'user:123',
    hit: Math.random() > 0.3 // 70% cache hit rate
  });
  
  // If cache miss, query database
  if (Math.random() > 0.7) {
    db.trackEvent('database:query', {
      query: 'SELECT * FROM users WHERE id = $1',
      params: ['123'],
      rowCount: 1,
      executionTime: 15 + Math.random() * 10
    });
    
    cache.trackEvent('cache:set', {
      key: 'user:123',
      ttl: 3600
    });
  }
  
  auth.endSpan(authSpan.spanId);
  
  // Return response
  gateway.trackEvent('http:response', {
    statusCode: 200,
    duration: 25 + Math.random() * 20
  });
  
  gateway.endSpan(requestSpan.spanId);
}

/**
 * Simulate a degraded request
 */
async function simulateDegradedRequest(gateway, auth, user, db, cache) {
  const requestSpan = gateway.startSpan('GET /api/orders');
  
  gateway.trackEvent('http:request', {
    method: 'GET',
    path: '/api/orders'
  });
  
  // Database is slow
  db.trackEvent('database:query', {
    query: 'SELECT * FROM orders',
    rowCount: 1000,
    executionTime: 500 + Math.random() * 500, // Much slower!
    slow: true
  });
  
  // Timeout occurs
  if (Math.random() > 0.5) {
    gateway.trackEvent('error', {
      message: 'Database query timeout',
      code: 'ETIMEDOUT',
      service: 'database'
    });
    
    gateway.trackEvent('http:response', {
      statusCode: 504,
      duration: 1000,
      error: 'Gateway Timeout'
    });
  } else {
    gateway.trackEvent('http:response', {
      statusCode: 200,
      duration: 600 + Math.random() * 200
    });
  }
  
  gateway.endSpan(requestSpan.spanId, 'error');
}

/**
 * Simulate cascade failure
 */
async function simulateCascadeFailure(gateway, auth, user, db, cache, payment) {
  console.log(chalk.red('💥 Database connection pool exhausted'));
  
  // Database fails
  db.trackEvent('error', {
    message: 'Connection pool exhausted',
    code: 'ECONNREFUSED',
    connections: 100,
    maxConnections: 100
  });
  
  await sleep(100);
  
  // Cache fails due to increased load
  console.log(chalk.red('💥 Cache memory limit exceeded'));
  cache.trackEvent('error', {
    message: 'Out of memory',
    code: 'OOM',
    memoryUsed: 4096,
    memoryLimit: 4096
  });
  
  await sleep(100);
  
  // Payment service fails
  console.log(chalk.red('💥 Payment service circuit breaker opened'));
  payment.trackEvent('error', {
    message: 'Circuit breaker open',
    failureRate: 0.8,
    requestsInWindow: 100,
    failures: 80
  });
  
  // Multiple user requests fail
  for (let i = 0; i < 5; i++) {
    const span = gateway.startSpan(`Failed Request ${i}`);
    
    gateway.trackEvent('http:request', {
      method: 'POST',
      path: '/api/payment'
    });
    
    gateway.trackEvent('error', {
      message: 'Service unavailable',
      statusCode: 503
    });
    
    gateway.trackEvent('http:response', {
      statusCode: 503,
      duration: 10
    });
    
    gateway.endSpan(span.spanId, 'error');
    
    await sleep(50);
  }
  
  // System metrics spike
  gateway.trackEvent('system:metrics', {
    cpu: { usage: 95 },
    memory: { usagePercent: 92 },
    openConnections: 850,
    errorRate: 0.75
  });
}

/**
 * Demonstrate time-travel debugging
 */
async function demonstrateTimeTravel() {
  const events = Array.from(causalityEngine.causalityGraph.values());
  const errors = events.filter(e => e.eventType === 'error');
  
  if (errors.length === 0) return;
  
  console.log(chalk.magenta('🔍 Finding root cause of failures...\n'));
  
  // Find root cause of last error
  const lastError = errors[errors.length - 1];
  const rootCause = causalityEngine.findRootCause(lastError.eventId);
  
  if (rootCause) {
    const rootNode = causalityEngine.causalityGraph.get(rootCause.eventId);
    console.log(chalk.green('✓ Root cause identified:'));
    console.log('  Event Type:', chalk.yellow(rootNode.eventType));
    console.log('  Service:', chalk.yellow(rootNode.serviceId));
    console.log('  Message:', chalk.yellow(rootNode.data?.message || 'N/A'));
    console.log('  Time:', chalk.gray(new Date(rootNode.timestamp).toISOString()));
  }
  
  // Show causality chain
  const chain = causalityEngine.traceCausalityChain(lastError.eventId, {
    direction: 'backward',
    maxDepth: 10
  });
  
  console.log(chalk.magenta('\n📊 Causality Chain:'));
  console.log(`  ${chain.events.length} events in chain`);
  console.log(`  Duration: ${chain.endTime - chain.startTime}ms`);
  console.log(`  Confidence: ${(chain.confidence * 100).toFixed(1)}%`);
  
  // Show time points
  const startTime = events[0].timestamp;
  const endTime = events[events.length - 1].timestamp;
  const duration = endTime - startTime;
  
  console.log(chalk.magenta('\n⏱️  System State Over Time:'));
  
  for (let i = 0; i <= 4; i++) {
    const checkpointTime = startTime + (duration * i / 4);
    const state = await queryEngine.queryStateAt({ timestamp: checkpointTime });
    
    const percentage = (i * 25);
    const health = state.summary.health;
    const healthIcon = health === 'healthy' ? '✅' : health === 'degraded' ? '⚠️' : '❌';
    
    console.log(`  ${percentage}%: ${healthIcon} ${health.toUpperCase()} - ${state.summary.errorCount} errors, ${state.summary.activeRequestCount} active requests`);
  }
}

/**
 * Demonstrate TimeQL queries
 */
async function demonstrateQueries() {
  const queries = [
    "STATE AT 'now' WHERE service = 'database'",
    "TIMELINE FROM '5 minutes ago' TO 'now' WHERE eventType = 'error'",
    "MATCH PATTERN WHERE eventType = 'error' FOLLOWED BY eventType = 'error' WITHIN 1 seconds IN LAST 1 minutes",
    "PREDICT NEXT 5 seconds FROM 'now'"
  ];
  
  for (const query of queries) {
    console.log(chalk.cyan(`\n📝 Query: ${query}`));
    
    try {
      const result = await queryEngine.query(query);
      
      if (result.events) {
        console.log(chalk.green(`   ✓ Found ${result.events.length} events`));
      } else if (result.predictions) {
        console.log(chalk.green(`   ✓ ${result.predictions.length} predictions with ${(result.confidence * 100).toFixed(1)}% confidence`));
      } else if (result.summary) {
        console.log(chalk.green(`   ✓ State: ${result.summary.health}, ${result.summary.totalEvents} events, ${result.summary.errorCount} errors`));
      } else {
        console.log(chalk.green(`   ✓ Query executed successfully`));
      }
    } catch (error) {
      console.log(chalk.red(`   ✗ Error: ${error.message}`));
    }
  }
  
  // Show query statistics
  const stats = queryEngine.getStats();
  console.log(chalk.cyan('\n📈 Query Engine Statistics:'));
  console.log(`  Queries executed: ${stats.queriesExecuted}`);
  console.log(`  Cache hit rate: ${(stats.cacheHitRate * 100).toFixed(1)}%`);
  console.log(`  Average query time: ${stats.averageQueryTime.toFixed(2)}ms`);
}

// Helper function
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Main execution
async function main() {
  console.log(chalk.bold.white('╔══════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.white('║      Traversion Production Debugging Platform             ║'));
  console.log(chalk.bold.white('║      Time Travel Through Your Production System           ║'));
  console.log(chalk.bold.white('╚══════════════════════════════════════════════════════════╗'));
  
  // Start API server
  app.listen(PORT, () => {
    console.log(chalk.green(`\n✓ API server running on http://localhost:${PORT}`));
    console.log(chalk.green(`✓ WebSocket server running on ws://localhost:${WS_PORT}`));
  });
  
  // Open dashboard
  console.log(chalk.yellow('\n🌐 Opening production dashboard...'));
  setTimeout(() => {
    open(`http://localhost:${PORT}/dashboard`);
  }, 2000);
  
  // Start simulation after delay
  setTimeout(() => {
    simulateProduction();
  }, 3000);
  
  // Keep running
  process.on('SIGINT', async () => {
    console.log(chalk.yellow('\n\n👋 Shutting down...'));
    
    // Cleanup collectors
    for (const collector of collectors.values()) {
      await collector.shutdown();
    }
    
    // Show final statistics
    const vizData = causalityEngine.exportForVisualization();
    console.log(chalk.bold.blue('\n📊 Final Statistics:'));
    console.log(`  Total events: ${causalityEngine.causalityGraph.size}`);
    console.log(`  Services: ${collectors.size}`);
    console.log(`  Causality edges: ${vizData.edges.length}`);
    console.log(`  Patterns detected: ${causalityEngine.patterns.size}`);
    
    process.exit(0);
  });
}

// Handle errors
process.on('unhandledRejection', (error) => {
  console.error(chalk.red('Error:'), error);
});

// Run the demo
main();