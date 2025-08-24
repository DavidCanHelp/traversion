import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import CausalityEngine from '../../src/engine/causalityEngine.js';

describe('SimpleCausalityEngine', () => {
  let engine;

  beforeEach(() => {
    engine = new CausalityEngine();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should initialize correctly', () => {
    expect(engine.causalityGraph).toBeDefined();
    expect(engine.config.maxChainDepth).toBe(100);
  });

  test('should process events', () => {
    const event = {
      eventId: 'test1',
      timestamp: Date.now(),
      serviceId: 'service1',
      eventType: 'request',
      data: {}
    };

    const result = engine.processEvent(event);
    expect(result.eventId).toBe('test1');
    expect(engine.causalityGraph.has('test1')).toBe(true);
  });

  test('should trace causality chains', () => {
    // Add some events
    engine.processEvent({
      eventId: 'parent',
      timestamp: 1000,
      serviceId: 'service1',
      traceId: 'trace1',
      spanId: 'span1',
      eventType: 'request',
      data: {}
    });

    engine.processEvent({
      eventId: 'child',
      timestamp: 2000,
      serviceId: 'service1',
      traceId: 'trace1',
      spanId: 'span2',
      parentSpanId: 'span1',
      eventType: 'response',
      data: {}
    });

    const chain = engine.traceCausalityChain('child', { direction: 'backward' });
    expect(chain.events.length).toBeGreaterThan(0);
    expect(chain.rootEvent).toBe('child');
  });

  test('should export visualization data', () => {
    engine.processEvent({
      eventId: 'vis1',
      timestamp: Date.now(),
      serviceId: 'service1',
      eventType: 'request',
      data: {}
    });

    const visualization = engine.exportForVisualization();
    expect(visualization.nodes).toBeDefined();
    expect(visualization.edges).toBeDefined();
    expect(Array.isArray(visualization.nodes)).toBe(true);
  });
});