/**
 * Causality Detection Engine
 * 
 * This module implements the core causality detection system for Traversion.
 * It tracks cause-and-effect relationships between events in a distributed system,
 * enabling developers to understand not just "what happened" but "what caused what."
 */

import EventEmitter from 'events';

export class CausalityEngine extends EventEmitter {
  constructor() {
    super();
    
    // Causality graph storage
    this.causalityGraph = new Map(); // eventId -> CausalityNode
    this.temporalIndex = new Map(); // timestamp -> Set of eventIds
    this.serviceIndex = new Map(); // serviceId -> Set of eventIds
    
    // Pattern detection
    this.patterns = new Map(); // patternId -> Pattern
    this.activeChains = new Map(); // chainId -> CausalityChain
    
    // Configuration
    this.config = {
      maxChainDepth: 100,
      correlationWindow: 5000, // ms
      confidenceThreshold: 0.7,
      anomalyThreshold: 0.9
    };
  }

  /**
   * Process a new event and update causality graph
   */
  processEvent(event) {
    const {
      eventId,
      timestamp,
      serviceId,
      traceId,
      spanId,
      parentSpanId,
      eventType,
      data,
      metadata = {}
    } = event;

    // Create causality node
    const node = {
      eventId,
      timestamp,
      serviceId,
      traceId,
      spanId,
      parentSpanId,
      eventType,
      data,
      metadata,
      causes: new Set(),
      causedBy: new Set(),
      confidence: 1.0,
      anomalyScore: 0
    };

    // Store in graph
    this.causalityGraph.set(eventId, node);
    
    // Update indices
    this._updateTemporalIndex(timestamp, eventId);
    this._updateServiceIndex(serviceId, eventId);
    
    // Detect causality relationships
    this._detectCausality(node);
    
    // Check for patterns
    this._detectPatterns(node);
    
    // Calculate anomaly score
    this._calculateAnomalyScore(node);
    
    // Emit event for real-time processing
    this.emit('event:processed', node);
    
    return node;
  }

  /**
   * Detect causal relationships for a node
   */
  _detectCausality(node) {
    // Direct causality from trace context
    if (node.parentSpanId) {
      const parent = this._findNodeBySpanId(node.parentSpanId, node.traceId);
      if (parent) {
        this._addCausalRelation(parent.eventId, node.eventId, 1.0, 'trace');
      }
    }
    
    // Temporal causality within correlation window
    const temporalCandidates = this._getTemporalNeighbors(
      node.timestamp,
      this.config.correlationWindow
    );
    
    for (const candidateId of temporalCandidates) {
      if (candidateId === node.eventId) continue;
      
      const candidate = this.causalityGraph.get(candidateId);
      const confidence = this._calculateTemporalConfidence(candidate, node);
      
      if (confidence > this.config.confidenceThreshold) {
        this._addCausalRelation(candidateId, node.eventId, confidence, 'temporal');
      }
    }
    
    // Service-level causality
    if (node.metadata.triggeredBy) {
      const trigger = this._findNodeById(node.metadata.triggeredBy);
      if (trigger) {
        this._addCausalRelation(trigger.eventId, node.eventId, 0.9, 'service');
      }
    }
    
    // Data flow causality
    this._detectDataFlowCausality(node);
  }

  /**
   * Detect causality based on data flow patterns
   */
  _detectDataFlowCausality(node) {
    if (!node.data) return;
    
    // Look for data dependencies
    const dataKeys = Object.keys(node.data);
    const recentEvents = this._getRecentEvents(node.timestamp, 1000);
    
    for (const recentId of recentEvents) {
      const recent = this.causalityGraph.get(recentId);
      if (!recent || !recent.data) continue;
      
      // Check for data correlation
      const correlation = this._calculateDataCorrelation(recent.data, node.data);
      if (correlation > 0.8) {
        this._addCausalRelation(recentId, node.eventId, correlation, 'dataflow');
      }
    }
  }

  /**
   * Add a causal relationship between two events
   */
  _addCausalRelation(causeId, effectId, confidence, type) {
    const cause = this.causalityGraph.get(causeId);
    const effect = this.causalityGraph.get(effectId);
    
    if (!cause || !effect) return;
    
    // Store bidirectional relationship with metadata
    cause.causes.add({
      eventId: effectId,
      confidence,
      type,
      timestamp: effect.timestamp
    });
    
    effect.causedBy.add({
      eventId: causeId,
      confidence,
      type,
      timestamp: cause.timestamp
    });
    
    // Emit causality detection event
    this.emit('causality:detected', {
      cause: causeId,
      effect: effectId,
      confidence,
      type
    });
  }

  /**
   * Trace causality chain from an event
   */
  traceCausalityChain(eventId, options = {}) {
    const {
      direction = 'backward', // 'backward', 'forward', 'both'
      maxDepth = this.config.maxChainDepth,
      confidenceThreshold = this.config.confidenceThreshold
    } = options;
    
    const chain = {
      id: `chain_${Date.now()}_${eventId}`,
      rootEvent: eventId,
      events: [],
      edges: [],
      startTime: null,
      endTime: null,
      confidence: 1.0
    };
    
    const visited = new Set();
    const queue = [{
      eventId,
      depth: 0,
      pathConfidence: 1.0
    }];
    
    while (queue.length > 0) {
      const { eventId: currentId, depth, pathConfidence } = queue.shift();
      
      if (visited.has(currentId) || depth > maxDepth) continue;
      visited.add(currentId);
      
      const node = this.causalityGraph.get(currentId);
      if (!node) continue;
      
      // Add to chain
      chain.events.push({
        eventId: currentId,
        timestamp: node.timestamp,
        serviceId: node.serviceId,
        eventType: node.eventType,
        depth,
        confidence: pathConfidence
      });
      
      // Update time bounds
      if (!chain.startTime || node.timestamp < chain.startTime) {
        chain.startTime = node.timestamp;
      }
      if (!chain.endTime || node.timestamp > chain.endTime) {
        chain.endTime = node.timestamp;
      }
      
      // Traverse relationships
      if (direction === 'backward' || direction === 'both') {
        for (const relation of node.causedBy) {
          if (relation.confidence >= confidenceThreshold) {
            queue.push({
              eventId: relation.eventId,
              depth: depth + 1,
              pathConfidence: pathConfidence * relation.confidence
            });
            
            chain.edges.push({
              from: relation.eventId,
              to: currentId,
              confidence: relation.confidence,
              type: relation.type
            });
          }
        }
      }
      
      if (direction === 'forward' || direction === 'both') {
        for (const relation of node.causes) {
          if (relation.confidence >= confidenceThreshold) {
            queue.push({
              eventId: relation.eventId,
              depth: depth + 1,
              pathConfidence: pathConfidence * relation.confidence
            });
            
            chain.edges.push({
              from: currentId,
              to: relation.eventId,
              confidence: relation.confidence,
              type: relation.type
            });
          }
        }
      }
    }
    
    // Sort events by timestamp
    chain.events.sort((a, b) => a.timestamp - b.timestamp);
    
    // Calculate overall chain confidence
    chain.confidence = this._calculateChainConfidence(chain);
    
    // Store active chain
    this.activeChains.set(chain.id, chain);
    
    return chain;
  }

  /**
   * Find root cause of an event
   */
  findRootCause(eventId) {
    const chain = this.traceCausalityChain(eventId, {
      direction: 'backward',
      maxDepth: 50
    });
    
    // Find events with no causes (root events)
    const rootCauses = chain.events.filter(event => {
      const node = this.causalityGraph.get(event.eventId);
      return node && node.causedBy.size === 0;
    });
    
    // If no true root, find most likely cause
    if (rootCauses.length === 0) {
      const scored = chain.events.map(event => ({
        ...event,
        score: this._calculateRootCauseScore(event, chain)
      }));
      
      scored.sort((a, b) => b.score - a.score);
      return scored[0];
    }
    
    // Return highest confidence root cause
    rootCauses.sort((a, b) => b.confidence - a.confidence);
    return rootCauses[0];
  }

  /**
   * Detect patterns in causality chains
   */
  _detectPatterns(node) {
    // Look for recurring sequences
    const recentChains = Array.from(this.activeChains.values())
      .filter(chain => chain.endTime > Date.now() - 60000); // Last minute
    
    for (const chain of recentChains) {
      const pattern = this._extractPattern(chain);
      const existingPattern = this._findSimilarPattern(pattern);
      
      if (existingPattern) {
        existingPattern.occurrences++;
        existingPattern.lastSeen = Date.now();
        
        // Check if this node matches the pattern
        if (this._matchesPattern(node, existingPattern)) {
          this.emit('pattern:matched', {
            node,
            pattern: existingPattern
          });
        }
      } else {
        // Store new pattern
        const patternId = `pattern_${Date.now()}`;
        this.patterns.set(patternId, {
          id: patternId,
          signature: pattern,
          occurrences: 1,
          firstSeen: Date.now(),
          lastSeen: Date.now()
        });
      }
    }
  }

  /**
   * Calculate anomaly score for an event
   */
  _calculateAnomalyScore(node) {
    let score = 0;
    
    // Check temporal anomaly
    const expectedInterval = this._getExpectedInterval(node.serviceId, node.eventType);
    if (expectedInterval) {
      const lastEvent = this._getLastEvent(node.serviceId, node.eventType);
      if (lastEvent) {
        const actualInterval = node.timestamp - lastEvent.timestamp;
        const deviation = Math.abs(actualInterval - expectedInterval) / expectedInterval;
        score = Math.max(score, Math.min(deviation, 1.0));
      }
    }
    
    // Check data anomaly
    if (node.data) {
      const dataScore = this._calculateDataAnomalyScore(node);
      score = Math.max(score, dataScore);
    }
    
    // Check causality anomaly
    const causalityScore = this._calculateCausalityAnomalyScore(node);
    score = Math.max(score, causalityScore);
    
    node.anomalyScore = score;
    
    // Emit anomaly if above threshold
    if (score > this.config.anomalyThreshold) {
      this.emit('anomaly:detected', {
        node,
        score,
        type: this._classifyAnomaly(node, score)
      });
    }
    
    return score;
  }

  /**
   * Predict next likely events based on patterns
   */
  predictNextEvents(currentEventId, options = {}) {
    const {
      horizon = 5000, // ms
      minConfidence = 0.5
    } = options;
    
    const predictions = [];
    const node = this.causalityGraph.get(currentEventId);
    if (!node) return predictions;
    
    // Find patterns that match current state
    const matchingPatterns = Array.from(this.patterns.values())
      .filter(pattern => this._matchesPartialPattern(node, pattern));
    
    for (const pattern of matchingPatterns) {
      const nextEvents = this._predictFromPattern(node, pattern, horizon);
      predictions.push(...nextEvents);
    }
    
    // Use historical causality
    const historicalPredictions = this._predictFromHistory(node, horizon);
    predictions.push(...historicalPredictions);
    
    // Deduplicate and sort by confidence
    const unique = this._deduplicatePredictions(predictions);
    unique.sort((a, b) => b.confidence - a.confidence);
    
    return unique.filter(p => p.confidence >= minConfidence);
  }

  /**
   * Helper methods
   */
  
  _updateTemporalIndex(timestamp, eventId) {
    if (!this.temporalIndex.has(timestamp)) {
      this.temporalIndex.set(timestamp, new Set());
    }
    this.temporalIndex.get(timestamp).add(eventId);
  }
  
  _updateServiceIndex(serviceId, eventId) {
    if (!this.serviceIndex.has(serviceId)) {
      this.serviceIndex.set(serviceId, new Set());
    }
    this.serviceIndex.get(serviceId).add(eventId);
  }
  
  _findNodeBySpanId(spanId, traceId) {
    for (const node of this.causalityGraph.values()) {
      if (node.spanId === spanId && node.traceId === traceId) {
        return node;
      }
    }
    return null;
  }
  
  _findNodeById(eventId) {
    return this.causalityGraph.get(eventId);
  }
  
  _getTemporalNeighbors(timestamp, window) {
    const neighbors = new Set();
    const start = timestamp - window;
    const end = timestamp;
    
    for (const [ts, eventIds] of this.temporalIndex) {
      if (ts >= start && ts <= end) {
        for (const id of eventIds) {
          neighbors.add(id);
        }
      }
    }
    
    return neighbors;
  }
  
  _getRecentEvents(timestamp, window) {
    return this._getTemporalNeighbors(timestamp, window);
  }
  
  _calculateTemporalConfidence(event1, event2) {
    const timeDiff = Math.abs(event2.timestamp - event1.timestamp);
    const maxDiff = this.config.correlationWindow;
    
    // Exponential decay based on time difference
    let confidence = Math.exp(-timeDiff / (maxDiff / 3));
    
    // Boost confidence for same service or trace
    if (event1.serviceId === event2.serviceId) {
      confidence *= 1.2;
    }
    if (event1.traceId === event2.traceId) {
      confidence *= 1.5;
    }
    
    return Math.min(confidence, 1.0);
  }
  
  _calculateDataCorrelation(data1, data2) {
    const keys1 = Object.keys(data1);
    const keys2 = Object.keys(data2);
    const commonKeys = keys1.filter(k => keys2.includes(k));
    
    if (commonKeys.length === 0) return 0;
    
    let matches = 0;
    for (const key of commonKeys) {
      if (JSON.stringify(data1[key]) === JSON.stringify(data2[key])) {
        matches++;
      }
    }
    
    return matches / Math.max(keys1.length, keys2.length);
  }
  
  _calculateChainConfidence(chain) {
    if (chain.edges.length === 0) return 1.0;
    
    const edgeConfidences = chain.edges.map(e => e.confidence);
    const avgConfidence = edgeConfidences.reduce((a, b) => a + b, 0) / edgeConfidences.length;
    const minConfidence = Math.min(...edgeConfidences);
    
    // Weighted average favoring weakest link
    return avgConfidence * 0.7 + minConfidence * 0.3;
  }
  
  _calculateRootCauseScore(event, chain) {
    const node = this.causalityGraph.get(event.eventId);
    if (!node) return 0;
    
    let score = event.confidence;
    
    // Boost score for error events
    if (node.eventType === 'error' || node.data?.error) {
      score *= 1.5;
    }
    
    // Boost score for anomalous events
    score *= (1 + node.anomalyScore);
    
    // Consider position in chain
    const position = event.depth / chain.events.length;
    score *= (1 - position * 0.5);
    
    return score;
  }
  
  _extractPattern(chain) {
    return {
      eventTypes: chain.events.map(e => {
        const node = this.causalityGraph.get(e.eventId);
        return node ? node.eventType : null;
      }).filter(Boolean),
      services: [...new Set(chain.events.map(e => e.serviceId))],
      duration: chain.endTime - chain.startTime,
      edgeTypes: [...new Set(chain.edges.map(e => e.type))]
    };
  }
  
  _findSimilarPattern(pattern) {
    for (const existing of this.patterns.values()) {
      if (this._patternsAreSimilar(pattern, existing.signature)) {
        return existing;
      }
    }
    return null;
  }
  
  _patternsAreSimilar(p1, p2) {
    // Simple similarity check - can be made more sophisticated
    return JSON.stringify(p1.eventTypes) === JSON.stringify(p2.eventTypes) &&
           Math.abs(p1.duration - p2.duration) < 1000;
  }
  
  _matchesPattern(node, pattern) {
    // Check if node could be part of this pattern
    return pattern.signature.services.includes(node.serviceId) &&
           pattern.signature.eventTypes.includes(node.eventType);
  }
  
  _getExpectedInterval(serviceId, eventType) {
    // Would be calculated from historical data
    // For now, return a default
    return 1000; // 1 second
  }
  
  _getLastEvent(serviceId, eventType) {
    const serviceEvents = this.serviceIndex.get(serviceId);
    if (!serviceEvents) return null;
    
    let lastEvent = null;
    for (const eventId of serviceEvents) {
      const node = this.causalityGraph.get(eventId);
      if (node && node.eventType === eventType) {
        if (!lastEvent || node.timestamp > lastEvent.timestamp) {
          lastEvent = node;
        }
      }
    }
    
    return lastEvent;
  }
  
  _calculateDataAnomalyScore(node) {
    // Simplified anomaly detection
    // In production, would use ML models
    if (node.data?.error) return 0.8;
    if (node.data?.latency > 1000) return 0.7;
    if (node.data?.status >= 500) return 0.9;
    return 0;
  }
  
  _calculateCausalityAnomalyScore(node) {
    // Check if causality pattern is unusual
    const expectedCauses = this._getExpectedCauses(node);
    const actualCauses = node.causedBy.size;
    
    if (expectedCauses === 0) return 0;
    
    const deviation = Math.abs(actualCauses - expectedCauses) / expectedCauses;
    return Math.min(deviation, 1.0);
  }
  
  _getExpectedCauses(node) {
    // Would be learned from historical data
    return 1;
  }
  
  _classifyAnomaly(node, score) {
    if (node.data?.error) return 'error';
    if (score > 0.95) return 'critical';
    if (score > 0.9) return 'warning';
    return 'info';
  }
  
  _matchesPartialPattern(node, pattern) {
    return this._matchesPattern(node, pattern);
  }
  
  _predictFromPattern(node, pattern, horizon) {
    // Predict next events based on pattern
    const predictions = [];
    const position = this._findPositionInPattern(node, pattern);
    
    if (position >= 0 && position < pattern.signature.eventTypes.length - 1) {
      const nextEventType = pattern.signature.eventTypes[position + 1];
      predictions.push({
        eventType: nextEventType,
        timestamp: node.timestamp + (pattern.signature.duration / pattern.signature.eventTypes.length),
        confidence: 0.7,
        source: 'pattern',
        patternId: pattern.id
      });
    }
    
    return predictions;
  }
  
  _predictFromHistory(node, horizon) {
    const predictions = [];
    
    // Find historical events that followed similar events
    for (const relation of node.causes) {
      const futureNode = this.causalityGraph.get(relation.eventId);
      if (futureNode && futureNode.timestamp - node.timestamp <= horizon) {
        predictions.push({
          eventType: futureNode.eventType,
          serviceId: futureNode.serviceId,
          timestamp: node.timestamp + (futureNode.timestamp - node.timestamp),
          confidence: relation.confidence * 0.8,
          source: 'history'
        });
      }
    }
    
    return predictions;
  }
  
  _findPositionInPattern(node, pattern) {
    // Find where in the pattern sequence this node fits
    for (let i = 0; i < pattern.signature.eventTypes.length; i++) {
      if (pattern.signature.eventTypes[i] === node.eventType) {
        return i;
      }
    }
    return -1;
  }
  
  _deduplicatePredictions(predictions) {
    const unique = new Map();
    
    for (const pred of predictions) {
      const key = `${pred.eventType}_${pred.serviceId}_${Math.floor(pred.timestamp / 100)}`;
      if (!unique.has(key) || unique.get(key).confidence < pred.confidence) {
        unique.set(key, pred);
      }
    }
    
    return Array.from(unique.values());
  }

  /**
   * Export causality data for visualization
   */
  exportForVisualization(options = {}) {
    const {
      startTime = Date.now() - 3600000, // Last hour
      endTime = Date.now(),
      minConfidence = 0.5
    } = options;
    
    const nodes = [];
    const edges = [];
    
    for (const [eventId, node] of this.causalityGraph) {
      if (node.timestamp >= startTime && node.timestamp <= endTime) {
        nodes.push({
          id: eventId,
          label: node.eventType,
          service: node.serviceId,
          timestamp: node.timestamp,
          anomalyScore: node.anomalyScore,
          group: node.serviceId
        });
        
        for (const relation of node.causes) {
          if (relation.confidence >= minConfidence) {
            edges.push({
              from: eventId,
              to: relation.eventId,
              confidence: relation.confidence,
              type: relation.type
            });
          }
        }
      }
    }
    
    return { nodes, edges };
  }
}

export default CausalityEngine;