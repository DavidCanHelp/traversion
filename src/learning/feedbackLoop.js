import EventEmitter from 'events';
import Database from 'better-sqlite3';
import logger from '../utils/logger.js';

/**
 * Feedback Loop System
 *
 * Tracks the accuracy of risk predictions and continuously improves
 * the scoring algorithm based on real incident outcomes.
 */
export class FeedbackLoop extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      dbPath: config.dbPath || './.traversion/feedback.db',
      learningRate: config.learningRate || 0.1,
      minSampleSize: config.minSampleSize || 10,
      confidenceThreshold: config.confidenceThreshold || 0.7,
      ...config
    };

    // Initialize database
    this.db = null;
    this.initializeDatabase();

    // Risk weight adjustments
    this.weightAdjustments = new Map();
    this.patternSuccess = new Map();

    // Statistics
    this.stats = {
      totalPredictions: 0,
      correctPredictions: 0,
      falsePositives: 0,
      falseNegatives: 0,
      accuracy: 0,
      precision: 0,
      recall: 0
    };
  }

  /**
   * Initialize the feedback database
   */
  initializeDatabase() {
    try {
      this.db = new Database(this.config.dbPath);

      // Create tables
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS predictions (
          id TEXT PRIMARY KEY,
          deployment_id TEXT,
          commit_hash TEXT,
          predicted_risk REAL,
          risk_factors TEXT,
          predicted_at DATETIME,
          actual_outcome TEXT,
          outcome_severity TEXT,
          feedback_at DATETIME,
          accuracy_score REAL,
          metadata TEXT
        );

        CREATE TABLE IF NOT EXISTS risk_patterns (
          pattern_id TEXT PRIMARY KEY,
          pattern_type TEXT,
          pattern_value TEXT,
          success_count INTEGER DEFAULT 0,
          failure_count INTEGER DEFAULT 0,
          success_rate REAL,
          confidence REAL,
          last_updated DATETIME
        );

        CREATE TABLE IF NOT EXISTS weight_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          factor_name TEXT,
          old_weight REAL,
          new_weight REAL,
          adjustment_reason TEXT,
          samples_used INTEGER,
          accuracy_delta REAL,
          updated_at DATETIME
        );

        CREATE TABLE IF NOT EXISTS incident_correlations (
          id TEXT PRIMARY KEY,
          incident_id TEXT,
          deployment_id TEXT,
          correlation_score REAL,
          confirmed BOOLEAN,
          false_positive BOOLEAN,
          created_at DATETIME,
          confirmed_at DATETIME
        );

        CREATE INDEX IF NOT EXISTS idx_predictions_deployment
          ON predictions(deployment_id);
        CREATE INDEX IF NOT EXISTS idx_predictions_outcome
          ON predictions(actual_outcome);
        CREATE INDEX IF NOT EXISTS idx_patterns_type
          ON risk_patterns(pattern_type);
        CREATE INDEX IF NOT EXISTS idx_correlations_incident
          ON incident_correlations(incident_id);
      `);

      logger.info('Feedback database initialized');

    } catch (error) {
      logger.error('Failed to initialize feedback database', { error: error.message });
      throw error;
    }
  }

  /**
   * Record a risk prediction
   */
  recordPrediction(deployment, riskScore, riskFactors) {
    try {
      const predictionId = this.generatePredictionId();

      const stmt = this.db.prepare(`
        INSERT INTO predictions (
          id, deployment_id, commit_hash, predicted_risk,
          risk_factors, predicted_at, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        predictionId,
        deployment.id,
        deployment.commit.hash,
        riskScore,
        JSON.stringify(riskFactors),
        new Date().toISOString(),
        JSON.stringify({
          environment: deployment.environment,
          author: deployment.commit.author,
          fileCount: deployment.commit.files.length
        })
      );

      this.stats.totalPredictions++;

      // Track patterns
      this.trackRiskPatterns(riskFactors);

      logger.info('Risk prediction recorded', {
        predictionId,
        deploymentId: deployment.id,
        riskScore
      });

      return predictionId;

    } catch (error) {
      logger.error('Failed to record prediction', { error: error.message });
      throw error;
    }
  }

  /**
   * Provide feedback on a prediction
   */
  provideFeedback(deploymentId, outcome, severity = 'none') {
    try {
      // Get the prediction
      const prediction = this.db.prepare(`
        SELECT * FROM predictions
        WHERE deployment_id = ?
        ORDER BY predicted_at DESC
        LIMIT 1
      `).get(deploymentId);

      if (!prediction) {
        logger.warn('No prediction found for deployment', { deploymentId });
        return;
      }

      // Update with actual outcome
      const stmt = this.db.prepare(`
        UPDATE predictions
        SET actual_outcome = ?,
            outcome_severity = ?,
            feedback_at = ?,
            accuracy_score = ?
        WHERE id = ?
      `);

      const accuracyScore = this.calculateAccuracyScore(
        prediction.predicted_risk,
        outcome,
        severity
      );

      stmt.run(
        outcome,
        severity,
        new Date().toISOString(),
        accuracyScore,
        prediction.id
      );

      // Update statistics
      this.updateStatistics(prediction.predicted_risk, outcome, severity);

      // Learn from the feedback
      this.learnFromFeedback(prediction, outcome, severity);

      // Emit feedback event
      this.emit('feedback_received', {
        deploymentId,
        predictedRisk: prediction.predicted_risk,
        actualOutcome: outcome,
        severity,
        accuracyScore
      });

      logger.info('Feedback recorded', {
        deploymentId,
        outcome,
        severity,
        accuracyScore
      });

      return accuracyScore;

    } catch (error) {
      logger.error('Failed to provide feedback', { error: error.message });
      throw error;
    }
  }

  /**
   * Calculate accuracy score
   */
  calculateAccuracyScore(predictedRisk, outcome, severity) {
    // Map outcome and severity to actual risk
    const actualRisk = this.mapOutcomeToRisk(outcome, severity);

    // Calculate accuracy (1 - absolute difference)
    const accuracy = 1 - Math.abs(predictedRisk - actualRisk);

    return Math.max(0, Math.min(1, accuracy));
  }

  /**
   * Map outcome to risk score
   */
  mapOutcomeToRisk(outcome, severity) {
    const outcomeScores = {
      'success': 0,
      'degraded': 0.3,
      'incident': 0.7,
      'failure': 1.0
    };

    const severityMultipliers = {
      'none': 1.0,
      'low': 1.1,
      'medium': 1.3,
      'high': 1.5,
      'critical': 2.0
    };

    const baseScore = outcomeScores[outcome] || 0.5;
    const multiplier = severityMultipliers[severity] || 1.0;

    return Math.min(1.0, baseScore * multiplier);
  }

  /**
   * Update statistics
   */
  updateStatistics(predictedRisk, outcome, severity) {
    const actualRisk = this.mapOutcomeToRisk(outcome, severity);
    const threshold = 0.5;

    // Determine prediction correctness
    const predictedHigh = predictedRisk >= threshold;
    const actualHigh = actualRisk >= threshold;

    if (predictedHigh && actualHigh) {
      // True positive
      this.stats.correctPredictions++;
    } else if (predictedHigh && !actualHigh) {
      // False positive
      this.stats.falsePositives++;
    } else if (!predictedHigh && actualHigh) {
      // False negative
      this.stats.falseNegatives++;
    } else {
      // True negative
      this.stats.correctPredictions++;
    }

    // Calculate metrics
    const total = this.stats.correctPredictions +
                  this.stats.falsePositives +
                  this.stats.falseNegatives;

    if (total > 0) {
      this.stats.accuracy = this.stats.correctPredictions / total;

      const truePositives = this.stats.correctPredictions -
                           (total - this.stats.falsePositives - this.stats.falseNegatives);

      if (truePositives + this.stats.falsePositives > 0) {
        this.stats.precision = truePositives / (truePositives + this.stats.falsePositives);
      }

      if (truePositives + this.stats.falseNegatives > 0) {
        this.stats.recall = truePositives / (truePositives + this.stats.falseNegatives);
      }
    }
  }

  /**
   * Learn from feedback
   */
  learnFromFeedback(prediction, outcome, severity) {
    const riskFactors = JSON.parse(prediction.risk_factors || '[]');
    const actualRisk = this.mapOutcomeToRisk(outcome, severity);
    const predictedRisk = prediction.predicted_risk;
    const error = actualRisk - predictedRisk;

    // Update pattern success rates
    riskFactors.forEach(factor => {
      this.updatePatternSuccess(factor, outcome, severity);
    });

    // Adjust weights if we have enough data
    const samples = this.getRecentSamples(50);
    if (samples.length >= this.config.minSampleSize) {
      this.adjustWeights(samples);
    }

    // Store weight adjustments
    if (Math.abs(error) > 0.2) {
      this.proposeWeightAdjustment(riskFactors, error);
    }
  }

  /**
   * Track risk patterns
   */
  trackRiskPatterns(riskFactors) {
    riskFactors.forEach(factor => {
      const patternId = this.generatePatternId(factor);

      const existing = this.db.prepare(`
        SELECT * FROM risk_patterns WHERE pattern_id = ?
      `).get(patternId);

      if (!existing) {
        this.db.prepare(`
          INSERT INTO risk_patterns (
            pattern_id, pattern_type, pattern_value, last_updated
          ) VALUES (?, ?, ?, ?)
        `).run(
          patternId,
          factor.type || 'general',
          factor.description || factor,
          new Date().toISOString()
        );
      }
    });
  }

  /**
   * Update pattern success rate
   */
  updatePatternSuccess(factor, outcome, severity) {
    const patternId = this.generatePatternId(factor);
    const isSuccess = outcome === 'success' ||
                     (outcome === 'degraded' && severity === 'low');

    const stmt = this.db.prepare(`
      UPDATE risk_patterns
      SET success_count = success_count + ?,
          failure_count = failure_count + ?,
          success_rate = CAST(success_count + ? AS REAL) /
                        (success_count + failure_count + 1),
          confidence = MIN(1.0, (success_count + failure_count + 1) / ?),
          last_updated = ?
      WHERE pattern_id = ?
    `);

    stmt.run(
      isSuccess ? 1 : 0,
      isSuccess ? 0 : 1,
      isSuccess ? 1 : 0,
      this.config.minSampleSize * 2,
      new Date().toISOString(),
      patternId
    );
  }

  /**
   * Get recent samples
   */
  getRecentSamples(limit = 50) {
    return this.db.prepare(`
      SELECT * FROM predictions
      WHERE actual_outcome IS NOT NULL
      ORDER BY feedback_at DESC
      LIMIT ?
    `).all(limit);
  }

  /**
   * Adjust weights based on feedback
   */
  adjustWeights(samples) {
    const factorPerformance = new Map();

    // Analyze factor performance
    samples.forEach(sample => {
      const factors = JSON.parse(sample.risk_factors || '[]');
      const accuracy = sample.accuracy_score || 0;

      factors.forEach(factor => {
        const factorKey = factor.type || factor;
        if (!factorPerformance.has(factorKey)) {
          factorPerformance.set(factorKey, {
            totalAccuracy: 0,
            count: 0,
            samples: []
          });
        }

        const perf = factorPerformance.get(factorKey);
        perf.totalAccuracy += accuracy;
        perf.count++;
        perf.samples.push(accuracy);
      });
    });

    // Calculate weight adjustments
    const adjustments = [];

    factorPerformance.forEach((perf, factorKey) => {
      const avgAccuracy = perf.totalAccuracy / perf.count;
      const currentWeight = this.getCurrentWeight(factorKey);

      // Calculate adjustment based on performance
      let adjustment = 0;
      if (avgAccuracy < 0.5) {
        // Factor is not predictive, reduce weight
        adjustment = -this.config.learningRate * (0.5 - avgAccuracy);
      } else if (avgAccuracy > 0.7) {
        // Factor is highly predictive, increase weight
        adjustment = this.config.learningRate * (avgAccuracy - 0.7);
      }

      if (Math.abs(adjustment) > 0.01) {
        const newWeight = Math.max(0.1, Math.min(1.0, currentWeight + adjustment));

        adjustments.push({
          factor: factorKey,
          oldWeight: currentWeight,
          newWeight,
          adjustment,
          avgAccuracy,
          samples: perf.count
        });

        this.weightAdjustments.set(factorKey, newWeight);
      }
    });

    // Store weight adjustments
    adjustments.forEach(adj => {
      this.storeWeightAdjustment(adj);
    });

    if (adjustments.length > 0) {
      this.emit('weights_adjusted', adjustments);
      logger.info('Risk weights adjusted based on feedback', {
        adjustmentCount: adjustments.length
      });
    }
  }

  /**
   * Propose weight adjustment
   */
  proposeWeightAdjustment(riskFactors, error) {
    // This stores proposed adjustments for manual review
    // or automatic application after confidence threshold
    const proposal = {
      factors: riskFactors,
      error,
      proposedAdjustment: error * this.config.learningRate,
      timestamp: new Date()
    };

    this.emit('weight_adjustment_proposed', proposal);
  }

  /**
   * Store weight adjustment
   */
  storeWeightAdjustment(adjustment) {
    this.db.prepare(`
      INSERT INTO weight_history (
        factor_name, old_weight, new_weight,
        adjustment_reason, samples_used,
        accuracy_delta, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      adjustment.factor,
      adjustment.oldWeight,
      adjustment.newWeight,
      `Auto-adjusted based on ${adjustment.samples} samples`,
      adjustment.samples,
      adjustment.avgAccuracy - 0.5,
      new Date().toISOString()
    );
  }

  /**
   * Get current weight for a factor
   */
  getCurrentWeight(factorKey) {
    if (this.weightAdjustments.has(factorKey)) {
      return this.weightAdjustments.get(factorKey);
    }

    // Default weights
    const defaultWeights = {
      'off_hours': 0.2,
      'weekend': 0.2,
      'config_changes': 0.4,
      'database_changes': 0.5,
      'large_changes': 0.3,
      'urgent_keywords': 0.4
    };

    return defaultWeights[factorKey] || 0.3;
  }

  /**
   * Get adjusted risk score
   */
  getAdjustedRiskScore(baseScore, riskFactors) {
    let adjustedScore = baseScore;

    // Apply learned weight adjustments
    riskFactors.forEach(factor => {
      const factorKey = factor.type || factor;
      const weight = this.getCurrentWeight(factorKey);
      const pattern = this.getPatternPerformance(factorKey);

      if (pattern && pattern.confidence > this.config.confidenceThreshold) {
        // Adjust based on pattern performance
        const adjustment = (1 - pattern.success_rate) * weight * 0.1;
        adjustedScore += adjustment;
      }
    });

    return Math.min(1.0, adjustedScore);
  }

  /**
   * Get pattern performance
   */
  getPatternPerformance(factorKey) {
    const patternId = this.generatePatternId(factorKey);

    return this.db.prepare(`
      SELECT * FROM risk_patterns WHERE pattern_id = ?
    `).get(patternId);
  }

  /**
   * Confirm incident correlation
   */
  confirmIncidentCorrelation(incidentId, deploymentId, wasCorrect) {
    try {
      const correlationId = this.generateCorrelationId();

      this.db.prepare(`
        INSERT INTO incident_correlations (
          id, incident_id, deployment_id,
          correlation_score, confirmed,
          false_positive, created_at, confirmed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        correlationId,
        incidentId,
        deploymentId,
        1.0, // Correlation score
        wasCorrect,
        !wasCorrect,
        new Date().toISOString(),
        new Date().toISOString()
      );

      // Provide feedback based on correlation
      if (wasCorrect) {
        this.provideFeedback(deploymentId, 'incident', 'high');
      } else {
        this.provideFeedback(deploymentId, 'success', 'none');
      }

      logger.info('Incident correlation confirmed', {
        incidentId,
        deploymentId,
        wasCorrect
      });

    } catch (error) {
      logger.error('Failed to confirm incident correlation', { error: error.message });
    }
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics() {
    const recentPredictions = this.db.prepare(`
      SELECT COUNT(*) as total,
             AVG(accuracy_score) as avg_accuracy,
             SUM(CASE WHEN accuracy_score > 0.7 THEN 1 ELSE 0 END) as high_accuracy,
             SUM(CASE WHEN accuracy_score < 0.3 THEN 1 ELSE 0 END) as low_accuracy
      FROM predictions
      WHERE feedback_at IS NOT NULL
        AND feedback_at > datetime('now', '-7 days')
    `).get();

    const patternPerformance = this.db.prepare(`
      SELECT pattern_type,
             AVG(success_rate) as avg_success_rate,
             AVG(confidence) as avg_confidence,
             COUNT(*) as pattern_count
      FROM risk_patterns
      WHERE last_updated > datetime('now', '-7 days')
      GROUP BY pattern_type
    `).all();

    return {
      overall: this.stats,
      recent: recentPredictions,
      patterns: patternPerformance,
      adjustedWeights: Object.fromEntries(this.weightAdjustments)
    };
  }

  /**
   * Export learning data
   */
  exportLearningData() {
    const predictions = this.db.prepare(`
      SELECT * FROM predictions
      WHERE actual_outcome IS NOT NULL
    `).all();

    const patterns = this.db.prepare(`
      SELECT * FROM risk_patterns
    `).all();

    const weightHistory = this.db.prepare(`
      SELECT * FROM weight_history
      ORDER BY updated_at DESC
    `).all();

    return {
      predictions,
      patterns,
      weightHistory,
      statistics: this.stats,
      exportedAt: new Date().toISOString()
    };
  }

  /**
   * Generate prediction ID
   */
  generatePredictionId() {
    return `pred_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate pattern ID
   */
  generatePatternId(factor) {
    const key = typeof factor === 'string' ? factor : factor.type || 'unknown';
    return `pattern_${key.toLowerCase().replace(/\s+/g, '_')}`;
  }

  /**
   * Generate correlation ID
   */
  generateCorrelationId() {
    return `corr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Close the database
   */
  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

export default FeedbackLoop;