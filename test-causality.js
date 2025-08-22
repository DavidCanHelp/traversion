/**
 * Test and demonstrate the Causality Detection Engine
 * 
 * This shows how Traversion can track cause-and-effect relationships
 * in a production system, enabling time-travel debugging.
 */

import CausalityEngine from './src/engine/causalityEngine.js';
import EventCollector from './src/collectors/eventCollector.js';
import chalk from 'chalk';

// Create instances
const causalityEngine = new CausalityEngine();
const collector = new EventCollector({
  serviceId: 'demo-service',
  serviceName: 'Demo API',
  environment: 'development'
});

// Connect collector to causality engine
collector.on('event:collected', (event) => {
  causalityEngine.processEvent(event);
});

// Listen for causality detection
causalityEngine.on('causality:detected', ({ cause, effect, confidence, type }) => {
  console.log(chalk.cyan('🔗 Causality detected:'), {
    cause: cause.substring(0, 8),
    effect: effect.substring(0, 8),
    confidence: confidence.toFixed(2),
    type
  });
});

// Listen for anomalies
causalityEngine.on('anomaly:detected', ({ node, score, type }) => {
  console.log(chalk.red('⚠️  Anomaly detected:'), {
    event: node.eventId.substring(0, 8),
    score: score.toFixed(2),
    type,
    eventType: node.eventType
  });
});

// Listen for patterns
causalityEngine.on('pattern:matched', ({ node, pattern }) => {
  console.log(chalk.green('📊 Pattern matched:'), {
    event: node.eventId.substring(0, 8),
    patternId: pattern.id,
    occurrences: pattern.occurrences
  });
});

/**
 * Simulate a production scenario with cascading failures
 */
async function simulateProductionScenario() {
  console.log(chalk.bold.blue('\n🚀 Starting Production Simulation\n'));
  console.log(chalk.gray('This demonstrates how Traversion tracks causality in production.\n'));
  
  // Simulate normal operation
  console.log(chalk.yellow('Phase 1: Normal Operation'));
  
  // User makes a request
  const span1 = collector.startSpan('HTTP GET /api/users');
  collector.trackEvent('http:request', {
    method: 'GET',
    path: '/api/users',
    ip: '192.168.1.100'
  });
  
  // API calls database
  collector.trackEvent('database:query', {
    query: 'SELECT * FROM users',
    rowCount: 150,
    executionTime: 45
  });
  
  // API returns response
  collector.trackEvent('http:response', {
    statusCode: 200,
    duration: 52,
    bodySize: 4096
  });
  collector.endSpan(span1.spanId);
  
  await sleep(100);
  
  // Another normal request
  const span2 = collector.startSpan('HTTP GET /api/products');
  collector.trackEvent('http:request', {
    method: 'GET',
    path: '/api/products'
  });
  
  collector.trackEvent('database:query', {
    query: 'SELECT * FROM products',
    rowCount: 500,
    executionTime: 120
  });
  
  collector.trackEvent('http:response', {
    statusCode: 200,
    duration: 135
  });
  collector.endSpan(span2.spanId);
  
  await sleep(100);
  
  // Simulate cascade failure
  console.log(chalk.yellow('\nPhase 2: Cascade Failure Beginning'));
  
  // Database starts slowing down
  const span3 = collector.startSpan('HTTP GET /api/users');
  collector.trackEvent('http:request', {
    method: 'GET',
    path: '/api/users'
  });
  
  collector.trackEvent('database:query', {
    query: 'SELECT * FROM users',
    rowCount: 150,
    executionTime: 2500 // Much slower!
  });
  
  // This causes API timeout
  collector.trackEvent('error', {
    message: 'Database query timeout',
    code: 'ETIMEDOUT'
  });
  
  collector.trackEvent('http:response', {
    statusCode: 503,
    duration: 3000,
    error: 'Service Unavailable'
  });
  collector.endSpan(span3.spanId, 'error');
  
  await sleep(50);
  
  // Cache service fails due to increased load
  collector.trackEvent('error', {
    message: 'Cache connection refused',
    service: 'redis',
    code: 'ECONNREFUSED'
  });
  
  // More requests start failing
  for (let i = 0; i < 3; i++) {
    const span = collector.startSpan(`HTTP GET /api/data${i}`);
    collector.trackEvent('http:request', {
      method: 'GET',
      path: `/api/data${i}`
    });
    
    collector.trackEvent('error', {
      message: 'Circuit breaker open',
      service: 'api-gateway'
    });
    
    collector.trackEvent('http:response', {
      statusCode: 503,
      duration: 10
    });
    collector.endSpan(span.spanId, 'error');
    
    await sleep(20);
  }
  
  // System metrics spike
  collector.trackEvent('system:metrics', {
    cpu: { usage: 95 },
    memory: { usagePercent: 87 }
  });
  
  console.log(chalk.yellow('\nPhase 3: Analyzing Causality\n'));
  await sleep(500);
  
  // Find the root cause
  const errorEvents = Array.from(causalityEngine.causalityGraph.values())
    .filter(node => node.eventType === 'error');
  
  if (errorEvents.length > 0) {
    console.log(chalk.bold.magenta('\n🔍 Root Cause Analysis:\n'));
    
    const lastError = errorEvents[errorEvents.length - 1];
    const rootCause = causalityEngine.findRootCause(lastError.eventId);
    
    if (rootCause) {
      const rootNode = causalityEngine.causalityGraph.get(rootCause.eventId);
      console.log(chalk.green('Root cause found:'));
      console.log('  Event:', rootNode.eventType);
      console.log('  Data:', JSON.stringify(rootNode.data, null, 2));
      console.log('  Time:', new Date(rootNode.timestamp).toISOString());
      console.log('  Confidence:', rootCause.confidence?.toFixed(2) || 'N/A');
    }
    
    // Trace the full causality chain
    console.log(chalk.bold.magenta('\n🔗 Causality Chain:\n'));
    const chain = causalityEngine.traceCausalityChain(lastError.eventId, {
      direction: 'backward'
    });
    
    console.log(`Chain contains ${chain.events.length} events:`);
    chain.events.forEach((event, index) => {
      const node = causalityEngine.causalityGraph.get(event.eventId);
      const indent = '  '.repeat(event.depth);
      const icon = node.eventType === 'error' ? '❌' : '📍';
      console.log(`${indent}${icon} ${node.eventType} (${node.serviceId})`);
      if (node.data?.message) {
        console.log(`${indent}   → ${node.data.message}`);
      }
    });
    
    console.log('\nChain confidence:', chain.confidence.toFixed(2));
    console.log('Duration:', chain.endTime - chain.startTime, 'ms');
  }
  
  // Predict what might happen next
  console.log(chalk.bold.magenta('\n🔮 Predictions:\n'));
  const lastEvent = Array.from(causalityEngine.causalityGraph.values()).pop();
  if (lastEvent) {
    const predictions = causalityEngine.predictNextEvents(lastEvent.eventId);
    
    if (predictions.length > 0) {
      console.log('Likely next events:');
      predictions.slice(0, 3).forEach(pred => {
        console.log(`  • ${pred.eventType} in ~${pred.timestamp - lastEvent.timestamp}ms (confidence: ${pred.confidence.toFixed(2)})`);
      });
    } else {
      console.log('No predictions available yet (need more data)');
    }
  }
  
  // Export for visualization
  const vizData = causalityEngine.exportForVisualization();
  console.log(chalk.bold.magenta('\n📊 Graph Statistics:\n'));
  console.log(`  Nodes: ${vizData.nodes.length}`);
  console.log(`  Edges: ${vizData.edges.length}`);
  console.log(`  Services: ${new Set(vizData.nodes.map(n => n.service)).size}`);
  
  // Show collector stats
  console.log(chalk.bold.blue('\n📈 Collection Statistics:\n'));
  const stats = collector.getStats();
  console.log(`  Events collected: ${stats.eventsCollected}`);
  console.log(`  Events sent: ${stats.eventsSent}`);
  console.log(`  Events dropped: ${stats.eventsDropped}`);
  console.log(`  Bytes collected: ${(stats.bytesCollected / 1024).toFixed(2)} KB`);
}

/**
 * Demonstrate time travel debugging
 */
async function demonstrateTimeTravel() {
  console.log(chalk.bold.cyan('\n⏰ Time Travel Demonstration\n'));
  
  // Get all events in chronological order
  const allEvents = Array.from(causalityEngine.causalityGraph.values())
    .sort((a, b) => a.timestamp - b.timestamp);
  
  if (allEvents.length === 0) {
    console.log('No events to travel through');
    return;
  }
  
  const startTime = allEvents[0].timestamp;
  const endTime = allEvents[allEvents.length - 1].timestamp;
  const duration = endTime - startTime;
  
  console.log(`Timeline: ${new Date(startTime).toISOString()} → ${new Date(endTime).toISOString()}`);
  console.log(`Duration: ${duration}ms\n`);
  
  // Show system state at different points in time
  const checkpoints = [0.25, 0.5, 0.75, 1.0];
  
  for (const checkpoint of checkpoints) {
    const targetTime = startTime + (duration * checkpoint);
    const eventsAtTime = allEvents.filter(e => e.timestamp <= targetTime);
    const errors = eventsAtTime.filter(e => e.eventType === 'error').length;
    const requests = eventsAtTime.filter(e => e.eventType === 'http:request').length;
    const queries = eventsAtTime.filter(e => e.eventType === 'database:query').length;
    
    console.log(chalk.yellow(`\n⏱️  Time: ${(checkpoint * 100).toFixed(0)}% (${new Date(targetTime).toISOString().split('T')[1]})`));
    console.log(`  Total events: ${eventsAtTime.length}`);
    console.log(`  HTTP requests: ${requests}`);
    console.log(`  DB queries: ${queries}`);
    console.log(`  Errors: ${errors}`);
    
    // Show system health
    const health = errors === 0 ? chalk.green('✅ Healthy') :
                   errors < 3 ? chalk.yellow('⚠️  Degraded') :
                   chalk.red('❌ Critical');
    console.log(`  System status: ${health}`);
  }
}

// Helper function
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the simulation
async function main() {
  console.log(chalk.bold.white('╔══════════════════════════════════════════════════╗'));
  console.log(chalk.bold.white('║     Traversion Causality Detection Demo          ║'));
  console.log(chalk.bold.white('║     Production Time Travel Debugging             ║'));
  console.log(chalk.bold.white('╚══════════════════════════════════════════════════╝'));
  
  await simulateProductionScenario();
  await demonstrateTimeTravel();
  
  console.log(chalk.bold.green('\n✨ Demo complete!\n'));
  console.log(chalk.gray('This demonstrates how Traversion can:'));
  console.log(chalk.gray('  • Track cause-and-effect relationships'));
  console.log(chalk.gray('  • Identify root causes of failures'));
  console.log(chalk.gray('  • Detect anomalies and patterns'));
  console.log(chalk.gray('  • Enable time-travel debugging'));
  console.log(chalk.gray('  • Predict future system behavior\n'));
  
  // Cleanup
  await collector.shutdown();
  process.exit(0);
}

// Handle errors
process.on('unhandledRejection', (error) => {
  console.error(chalk.red('Error:'), error);
  process.exit(1);
});

// Run the demo
main();