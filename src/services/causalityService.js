/**
 * Causality Service
 *
 * Integrates the causality engine with the main application
 * for advanced incident correlation and root cause analysis
 */

import { CausalityEngine } from '../engine/causalityEngine.js';
import logger from '../utils/logger.js';

class CausalityService {
  constructor() {
    this.engine = new CausalityEngine();
    this.setupEventListeners();
  }

  setupEventListeners() {
    this.engine.on('event:processed', (node) => {
      logger.debug('Causality event processed', {
        eventId: node.eventId,
        serviceId: node.serviceId
      });
    });

    this.engine.on('anomaly:detected', (anomaly) => {
      logger.warn('Causality anomaly detected', anomaly);
    });

    this.engine.on('pattern:matched', (pattern) => {
      logger.info('Causality pattern matched', pattern);
    });
  }

  /**
   * Analyze commits for causality relationships
   */
  async analyzeCommitCausality(commits, incidentTime) {
    // Convert commits to causality events
    const events = commits.map((commit, index) => ({
      eventId: `commit_${commit.hash}`,
      timestamp: new Date(commit.date).getTime(),
      serviceId: 'git',
      traceId: `incident_${incidentTime.getTime()}`,
      spanId: commit.hash,
      parentSpanId: index > 0 ? commits[index - 1].hash : null,
      eventType: 'commit',
      data: {
        message: commit.message,
        author: commit.author_name,
        filesChanged: commit.filesChanged || []
      },
      metadata: {
        risk: commit.risk,
        riskFactors: commit.riskFactors
      }
    }));

    // Process events through causality engine
    const nodes = [];
    for (const event of events) {
      const node = this.engine.processEvent(event);
      nodes.push(node);
    }

    // Trace causality chains
    const chains = [];
    for (const node of nodes) {
      if (node.anomalyScore > 0.5 || node.metadata.risk > 0.7) {
        const chain = this.engine.traceCausalityChain(node.eventId, {
          direction: 'both',
          maxDepth: 10,
          confidenceThreshold: 0.5
        });
        chains.push(chain);
      }
    }

    // Find root causes
    const rootCauses = chains
      .map(chain => this.engine.findRootCause(chain))
      .filter(root => root && root.confidence > 0.6)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    // Predict next likely events
    const predictions = [];
    if (nodes.length > 0) {
      const lastNode = nodes[nodes.length - 1];
      const predicted = this.engine.predictNextEvents(lastNode.eventId, {
        horizon: 5,
        minConfidence: 0.5
      });
      predictions.push(...predicted);
    }

    return {
      nodes,
      chains,
      rootCauses,
      predictions,
      graph: this.engine.exportForVisualization()
    };
  }

  /**
   * Analyze system events for causality
   */
  async analyzeSystemEvents(events) {
    const results = [];

    for (const event of events) {
      const node = this.engine.processEvent({
        eventId: event.id || `event_${Date.now()}_${Math.random()}`,
        timestamp: new Date(event.timestamp).getTime(),
        serviceId: event.service || 'unknown',
        traceId: event.traceId,
        spanId: event.spanId,
        parentSpanId: event.parentSpanId,
        eventType: event.type,
        data: event.data,
        metadata: event.metadata || {}
      });

      results.push(node);
    }

    return results;
  }

  /**
   * Get causality insights for a specific incident
   */
  getIncidentInsights(incidentId) {
    const chains = Array.from(this.engine.activeChains.values())
      .filter(chain => chain.metadata?.incidentId === incidentId);

    const insights = {
      totalEvents: chains.reduce((sum, chain) => sum + chain.events.length, 0),
      rootCauses: [],
      impactedServices: new Set(),
      criticalPaths: [],
      recommendations: []
    };

    for (const chain of chains) {
      // Find root cause
      const rootCause = this.engine.findRootCause(chain);
      if (rootCause) {
        insights.rootCauses.push(rootCause);
      }

      // Collect impacted services
      chain.events.forEach(event => {
        if (event.serviceId) {
          insights.impactedServices.add(event.serviceId);
        }
      });

      // Identify critical paths
      if (chain.confidence > 0.8) {
        insights.criticalPaths.push({
          start: chain.events[0],
          end: chain.events[chain.events.length - 1],
          length: chain.events.length,
          confidence: chain.confidence
        });
      }
    }

    // Generate recommendations based on patterns
    if (insights.rootCauses.length > 0) {
      const topCause = insights.rootCauses[0];

      insights.recommendations.push({
        priority: 'high',
        action: 'investigate',
        description: `Investigate ${topCause.event.eventType} in ${topCause.event.serviceId}`,
        confidence: topCause.confidence
      });

      if (topCause.score > 0.9) {
        insights.recommendations.push({
          priority: 'critical',
          action: 'rollback',
          description: `Consider rolling back changes from ${topCause.event.eventId}`,
          confidence: topCause.score
        });
      }
    }

    insights.impactedServices = Array.from(insights.impactedServices);
    return insights;
  }

  /**
   * Clear the causality graph
   */
  clear() {
    this.engine.causalityGraph.clear();
    this.engine.temporalIndex.clear();
    this.engine.serviceIndex.clear();
    this.engine.patterns.clear();
    this.engine.activeChains.clear();
  }
}

// Create singleton instance
const causalityService = new CausalityService();

export default causalityService;
export { CausalityService };