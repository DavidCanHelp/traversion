import { performance } from 'perf_hooks';
import v8 from 'v8';
import os from 'os';
import { execSync } from 'child_process';
import logger from './logger.js';

export class PerformanceProfiler {
  constructor() {
    this.profiles = new Map();
    this.activeProfiles = new Map();
    this.metrics = {
      execution: new Map(),
      memory: new Map(),
      cpu: new Map()
    };
  }
  
  startProfiling(versionId, filePath) {
    const profileId = `${versionId}-${Date.now()}`;
    
    const profile = {
      id: profileId,
      versionId,
      filePath,
      startTime: performance.now(),
      startMemory: process.memoryUsage(),
      startCpu: process.cpuUsage(),
      startHeapStats: v8.getHeapStatistics(),
      marks: new Map(),
      measures: new Map()
    };
    
    this.activeProfiles.set(versionId, profile);
    
    // Mark the start
    performance.mark(`version-${versionId}-start`);
    
    logger.debug('Started profiling', { versionId, filePath });
    
    return profileId;
  }
  
  endProfiling(versionId) {
    const profile = this.activeProfiles.get(versionId);
    
    if (!profile) {
      logger.warn('No active profile found', { versionId });
      return null;
    }
    
    // Mark the end
    performance.mark(`version-${versionId}-end`);
    
    // Measure the duration
    performance.measure(
      `version-${versionId}-duration`,
      `version-${versionId}-start`,
      `version-${versionId}-end`
    );
    
    const endTime = performance.now();
    const endMemory = process.memoryUsage();
    const endCpu = process.cpuUsage();
    const endHeapStats = v8.getHeapStatistics();
    
    // Calculate metrics
    const metrics = {
      duration: endTime - profile.startTime,
      memory: {
        rss: endMemory.rss - profile.startMemory.rss,
        heapTotal: endMemory.heapTotal - profile.startMemory.heapTotal,
        heapUsed: endMemory.heapUsed - profile.startMemory.heapUsed,
        external: endMemory.external - profile.startMemory.external,
        arrayBuffers: endMemory.arrayBuffers - profile.startMemory.arrayBuffers
      },
      cpu: {
        user: (endCpu.user - profile.startCpu.user) / 1000, // Convert to ms
        system: (endCpu.system - profile.startCpu.system) / 1000
      },
      heap: {
        totalHeapSize: endHeapStats.total_heap_size - profile.startHeapStats.total_heap_size,
        usedHeapSize: endHeapStats.used_heap_size - profile.startHeapStats.used_heap_size,
        heapSizeLimit: endHeapStats.heap_size_limit
      }
    };
    
    // Store the complete profile
    profile.endTime = endTime;
    profile.metrics = metrics;
    profile.marks = Array.from(profile.marks.entries());
    profile.measures = Array.from(profile.measures.entries());
    
    this.profiles.set(profile.id, profile);
    this.activeProfiles.delete(versionId);
    
    // Update aggregated metrics
    this.updateAggregatedMetrics(versionId, metrics);
    
    logger.debug('Ended profiling', { versionId, duration: metrics.duration });
    
    // Clean up performance marks
    performance.clearMarks(`version-${versionId}-start`);
    performance.clearMarks(`version-${versionId}-end`);
    performance.clearMeasures(`version-${versionId}-duration`);
    
    return metrics;
  }
  
  mark(versionId, label) {
    const profile = this.activeProfiles.get(versionId);
    if (!profile) return;
    
    const markName = `version-${versionId}-${label}`;
    performance.mark(markName);
    profile.marks.set(label, performance.now() - profile.startTime);
  }
  
  measure(versionId, label, startMark, endMark) {
    const profile = this.activeProfiles.get(versionId);
    if (!profile) return;
    
    const measureName = `version-${versionId}-${label}`;
    const startMarkName = `version-${versionId}-${startMark}`;
    const endMarkName = `version-${versionId}-${endMark}`;
    
    performance.measure(measureName, startMarkName, endMarkName);
    
    const entry = performance.getEntriesByName(measureName)[0];
    if (entry) {
      profile.measures.set(label, entry.duration);
    }
  }
  
  updateAggregatedMetrics(versionId, metrics) {
    // Update execution metrics
    if (!this.metrics.execution.has(versionId)) {
      this.metrics.execution.set(versionId, []);
    }
    this.metrics.execution.get(versionId).push(metrics.duration);
    
    // Update memory metrics
    if (!this.metrics.memory.has(versionId)) {
      this.metrics.memory.set(versionId, []);
    }
    this.metrics.memory.get(versionId).push(metrics.memory.heapUsed);
    
    // Update CPU metrics
    if (!this.metrics.cpu.has(versionId)) {
      this.metrics.cpu.set(versionId, []);
    }
    this.metrics.cpu.get(versionId).push(metrics.cpu.user + metrics.cpu.system);
  }
  
  getVersionMetrics(versionId) {
    const executions = this.metrics.execution.get(versionId) || [];
    const memory = this.metrics.memory.get(versionId) || [];
    const cpu = this.metrics.cpu.get(versionId) || [];
    
    return {
      execution: {
        count: executions.length,
        avg: this.average(executions),
        min: Math.min(...executions),
        max: Math.max(...executions),
        median: this.median(executions),
        p95: this.percentile(executions, 95),
        p99: this.percentile(executions, 99)
      },
      memory: {
        avg: this.average(memory),
        min: Math.min(...memory),
        max: Math.max(...memory),
        median: this.median(memory)
      },
      cpu: {
        avg: this.average(cpu),
        min: Math.min(...cpu),
        max: Math.max(...cpu),
        median: this.median(cpu)
      }
    };
  }
  
  compareVersions(versionAId, versionBId) {
    const metricsA = this.getVersionMetrics(versionAId);
    const metricsB = this.getVersionMetrics(versionBId);
    
    return {
      execution: {
        difference: metricsB.execution.avg - metricsA.execution.avg,
        percentChange: ((metricsB.execution.avg - metricsA.execution.avg) / metricsA.execution.avg) * 100,
        regression: metricsB.execution.avg > metricsA.execution.avg * 1.1 // 10% threshold
      },
      memory: {
        difference: metricsB.memory.avg - metricsA.memory.avg,
        percentChange: ((metricsB.memory.avg - metricsA.memory.avg) / metricsA.memory.avg) * 100,
        regression: metricsB.memory.avg > metricsA.memory.avg * 1.2 // 20% threshold
      },
      cpu: {
        difference: metricsB.cpu.avg - metricsA.cpu.avg,
        percentChange: ((metricsB.cpu.avg - metricsA.cpu.avg) / metricsA.cpu.avg) * 100,
        regression: metricsB.cpu.avg > metricsA.cpu.avg * 1.15 // 15% threshold
      }
    };
  }
  
  detectPerformanceRegression(versionId, threshold = 0.1) {
    const metrics = this.getVersionMetrics(versionId);
    const allVersions = Array.from(this.metrics.execution.keys())
      .filter(id => id < versionId);
    
    if (allVersions.length === 0) {
      return { hasRegression: false };
    }
    
    // Get baseline (average of previous versions)
    const baselineExecutions = allVersions.flatMap(id => 
      this.metrics.execution.get(id) || []
    );
    const baselineAvg = this.average(baselineExecutions);
    
    const regression = metrics.execution.avg > baselineAvg * (1 + threshold);
    
    return {
      hasRegression: regression,
      current: metrics.execution.avg,
      baseline: baselineAvg,
      increase: metrics.execution.avg - baselineAvg,
      percentIncrease: ((metrics.execution.avg - baselineAvg) / baselineAvg) * 100
    };
  }
  
  getSystemMetrics() {
    return {
      cpu: {
        loadAvg: os.loadavg(),
        cores: os.cpus().length,
        usage: this.getCpuUsage()
      },
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem(),
        percentUsed: ((os.totalmem() - os.freemem()) / os.totalmem()) * 100
      },
      process: {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage()
      }
    };
  }
  
  getCpuUsage() {
    // Get CPU usage for current process
    try {
      const pid = process.pid;
      if (process.platform === 'darwin') {
        const usage = execSync(`ps -p ${pid} -o %cpu=`).toString().trim();
        return parseFloat(usage);
      } else if (process.platform === 'linux') {
        const usage = execSync(`ps -p ${pid} -o %cpu --no-headers`).toString().trim();
        return parseFloat(usage);
      }
    } catch (error) {
      logger.debug('Could not get CPU usage', { error: error.message });
    }
    return 0;
  }
  
  profileFunction(fn, label = 'function') {
    const start = performance.now();
    const startMemory = process.memoryUsage();
    
    let result;
    let error;
    
    try {
      result = fn();
    } catch (e) {
      error = e;
    }
    
    const end = performance.now();
    const endMemory = process.memoryUsage();
    
    const profile = {
      label,
      duration: end - start,
      memoryDelta: endMemory.heapUsed - startMemory.heapUsed,
      success: !error,
      error: error?.message
    };
    
    logger.debug('Function profiled', profile);
    
    if (error) throw error;
    return { result, profile };
  }
  
  async profileAsyncFunction(fn, label = 'async-function') {
    const start = performance.now();
    const startMemory = process.memoryUsage();
    
    let result;
    let error;
    
    try {
      result = await fn();
    } catch (e) {
      error = e;
    }
    
    const end = performance.now();
    const endMemory = process.memoryUsage();
    
    const profile = {
      label,
      duration: end - start,
      memoryDelta: endMemory.heapUsed - startMemory.heapUsed,
      success: !error,
      error: error?.message
    };
    
    logger.debug('Async function profiled', profile);
    
    if (error) throw error;
    return { result, profile };
  }
  
  generateReport(versionId) {
    const metrics = this.getVersionMetrics(versionId);
    const regression = this.detectPerformanceRegression(versionId);
    const system = this.getSystemMetrics();
    
    return {
      version: versionId,
      timestamp: new Date().toISOString(),
      metrics,
      regression,
      system,
      recommendations: this.getRecommendations(metrics, regression)
    };
  }
  
  getRecommendations(metrics, regression) {
    const recommendations = [];
    
    if (regression.hasRegression) {
      recommendations.push({
        type: 'warning',
        message: `Performance regression detected: ${regression.percentIncrease.toFixed(1)}% slower than baseline`,
        severity: regression.percentIncrease > 50 ? 'high' : 'medium'
      });
    }
    
    if (metrics.memory.max > 100 * 1024 * 1024) { // 100MB
      recommendations.push({
        type: 'memory',
        message: 'High memory usage detected. Consider optimizing memory allocation.',
        severity: 'medium'
      });
    }
    
    if (metrics.execution.p99 > metrics.execution.median * 3) {
      recommendations.push({
        type: 'variability',
        message: 'High performance variability. P99 is 3x median.',
        severity: 'low'
      });
    }
    
    if (metrics.cpu.avg > 1000) { // 1 second of CPU time
      recommendations.push({
        type: 'cpu',
        message: 'High CPU usage. Consider optimizing algorithms.',
        severity: 'medium'
      });
    }
    
    return recommendations;
  }
  
  // Utility functions
  average(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }
  
  median(arr) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  
  percentile(arr, p) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[index];
  }
  
  clear() {
    this.profiles.clear();
    this.activeProfiles.clear();
    this.metrics.execution.clear();
    this.metrics.memory.clear();
    this.metrics.cpu.clear();
  }
}

export default new PerformanceProfiler();