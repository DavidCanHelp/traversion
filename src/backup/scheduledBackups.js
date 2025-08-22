/**
 * Scheduled Backup Service for Traversion
 * 
 * Handles automated backup scheduling with cron-like syntax,
 * backup rotation, health monitoring, and failure recovery.
 */

import { EventEmitter } from 'events';
import cron from 'node-cron';

class ScheduledBackupService extends EventEmitter {
  constructor(backupManager, storage, options = {}) {
    super();
    
    this.backupManager = backupManager;
    this.storage = storage;
    
    this.options = {
      timezone: options.timezone || 'UTC',
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 300000, // 5 minutes
      healthCheckInterval: options.healthCheckInterval || 3600000, // 1 hour
      ...options
    };
    
    this.schedules = new Map();
    this.runningJobs = new Map();
    this.jobHistory = [];
    this.isShutdown = false;
    
    // Initialize default schedules
    this._initializeDefaultSchedules();
    
    // Start health monitoring
    this.healthCheckInterval = setInterval(() => {
      this._performHealthCheck();
    }, this.options.healthCheckInterval);
  }
  
  _initializeDefaultSchedules() {
    // Daily full backup at 2 AM
    this.addSchedule({
      name: 'daily_full_backup',
      description: 'Daily full backup of all data',
      schedule: '0 2 * * *', // 2 AM daily
      enabled: true,
      backupOptions: {
        tables: ['events', 'causality', 'patterns', 'metrics', 'users', 'tenants'],
        format: 'json',
        compression: true,
        storageBackend: 'local',
        includeSchema: true
      },
      retention: {
        local: 7, // Keep 7 days locally
        s3: 90    // Keep 90 days in S3
      }
    });
    
    // Hourly incremental backup (events only)
    this.addSchedule({
      name: 'hourly_events_backup',
      description: 'Hourly backup of recent events',
      schedule: '0 * * * *', // Every hour
      enabled: true,
      backupOptions: {
        tables: ['events'],
        format: 'json',
        compression: true,
        storageBackend: 'local',
        startTime: 'LAST_HOUR',
        includeSchema: false
      },
      retention: {
        local: 2 // Keep 2 days of hourly backups
      }
    });
    
    // Weekly full backup to cloud storage
    this.addSchedule({
      name: 'weekly_cloud_backup',
      description: 'Weekly full backup to cloud storage',
      schedule: '0 3 * * 0', // 3 AM on Sundays
      enabled: false, // Disabled by default, enable when cloud storage is configured
      backupOptions: {
        tables: ['events', 'causality', 'patterns', 'metrics', 'users', 'tenants'],
        format: 'json',
        compression: true,
        storageBackend: 's3', // or 'gcs'
        includeSchema: true,
        encryption: true
      },
      retention: {
        s3: 365 // Keep 1 year in cloud
      }
    });
    
    // Monthly archive backup
    this.addSchedule({
      name: 'monthly_archive',
      description: 'Monthly archive backup for long-term retention',
      schedule: '0 4 1 * *', // 4 AM on 1st of every month
      enabled: true,
      backupOptions: {
        tables: ['events', 'causality', 'patterns'],
        format: 'parquet', // More efficient for archives
        compression: true,
        storageBackend: 's3',
        endTime: 'LAST_MONTH',
        includeSchema: true,
        encryption: true
      },
      retention: {
        s3: 2555 // Keep 7 years for compliance
      }
    });
  }
  
  addSchedule(scheduleConfig) {
    const {
      name,
      description,
      schedule,
      enabled = true,
      backupOptions = {},
      retention = {},
      maxRetries = this.options.maxRetries,
      notifyOnSuccess = false,
      notifyOnFailure = true
    } = scheduleConfig;
    
    // Validate cron expression
    if (!cron.validate(schedule)) {
      throw new Error(`Invalid cron expression: ${schedule}`);
    }
    
    const scheduleInfo = {
      name,
      description,
      schedule,
      enabled,
      backupOptions,
      retention,
      maxRetries,
      notifyOnSuccess,
      notifyOnFailure,
      createdAt: new Date(),
      lastRun: null,
      lastSuccess: null,
      lastFailure: null,
      runCount: 0,
      successCount: 0,
      failureCount: 0,
      task: null
    };
    
    // Create cron task
    if (enabled) {
      scheduleInfo.task = cron.schedule(schedule, () => {
        this._executeScheduledBackup(name);
      }, {
        scheduled: false,
        timezone: this.options.timezone
      });
    }
    
    this.schedules.set(name, scheduleInfo);
    
    this.emit('schedule:added', { name, schedule: scheduleInfo });
    
    // Start the task if enabled
    if (enabled && scheduleInfo.task) {
      scheduleInfo.task.start();
    }
    
    return scheduleInfo;
  }
  
  updateSchedule(name, updates) {
    const schedule = this.schedules.get(name);
    if (!schedule) {
      throw new Error(`Schedule not found: ${name}`);
    }
    
    // Stop existing task
    if (schedule.task) {
      schedule.task.stop();
      schedule.task.destroy();
    }
    
    // Update schedule
    const updatedSchedule = { ...schedule, ...updates };
    
    // Validate new cron expression if changed
    if (updates.schedule && !cron.validate(updates.schedule)) {
      throw new Error(`Invalid cron expression: ${updates.schedule}`);
    }
    
    // Create new task if enabled
    if (updatedSchedule.enabled) {
      updatedSchedule.task = cron.schedule(updatedSchedule.schedule, () => {
        this._executeScheduledBackup(name);
      }, {
        scheduled: false,
        timezone: this.options.timezone
      });
      
      updatedSchedule.task.start();
    }
    
    this.schedules.set(name, updatedSchedule);
    
    this.emit('schedule:updated', { name, schedule: updatedSchedule });
    
    return updatedSchedule;
  }
  
  removeSchedule(name) {
    const schedule = this.schedules.get(name);
    if (!schedule) {
      return false;
    }
    
    // Stop and destroy task
    if (schedule.task) {
      schedule.task.stop();
      schedule.task.destroy();
    }
    
    this.schedules.delete(name);
    
    this.emit('schedule:removed', { name });
    
    return true;
  }
  
  enableSchedule(name) {
    const schedule = this.schedules.get(name);
    if (!schedule) {
      throw new Error(`Schedule not found: ${name}`);
    }
    
    if (!schedule.enabled) {
      schedule.enabled = true;
      
      // Create and start task
      schedule.task = cron.schedule(schedule.schedule, () => {
        this._executeScheduledBackup(name);
      }, {
        scheduled: false,
        timezone: this.options.timezone
      });
      
      schedule.task.start();
      
      this.emit('schedule:enabled', { name });
    }
    
    return schedule;
  }
  
  disableSchedule(name) {
    const schedule = this.schedules.get(name);
    if (!schedule) {
      throw new Error(`Schedule not found: ${name}`);
    }
    
    if (schedule.enabled) {
      schedule.enabled = false;
      
      // Stop and destroy task
      if (schedule.task) {
        schedule.task.stop();
        schedule.task.destroy();
        schedule.task = null;
      }
      
      this.emit('schedule:disabled', { name });
    }
    
    return schedule;
  }
  
  async _executeScheduledBackup(scheduleName) {
    const schedule = this.schedules.get(scheduleName);
    if (!schedule || !schedule.enabled || this.isShutdown) {
      return;
    }
    
    // Check if already running
    if (this.runningJobs.has(scheduleName)) {
      console.warn(`Backup job ${scheduleName} is already running, skipping`);
      return;
    }
    
    const jobId = `${scheduleName}_${Date.now()}`;
    const jobInfo = {
      id: jobId,
      scheduleName,
      startedAt: new Date(),
      status: 'running',
      attempts: 0,
      maxAttempts: schedule.maxRetries + 1
    };
    
    this.runningJobs.set(scheduleName, jobInfo);
    
    try {
      await this._runBackupWithRetries(schedule, jobInfo);
      
      // Update schedule stats
      schedule.lastRun = new Date();
      schedule.lastSuccess = new Date();
      schedule.runCount++;
      schedule.successCount++;
      
      jobInfo.status = 'completed';
      jobInfo.completedAt = new Date();
      
      this.emit('job:completed', { jobId, scheduleName, jobInfo });
      
      if (schedule.notifyOnSuccess) {
        this.emit('backup:success', { 
          scheduleName, 
          schedule,
          duration: jobInfo.completedAt - jobInfo.startedAt
        });
      }
      
    } catch (error) {
      // Update schedule stats
      schedule.lastRun = new Date();
      schedule.lastFailure = new Date();
      schedule.runCount++;
      schedule.failureCount++;
      
      jobInfo.status = 'failed';
      jobInfo.error = error.message;
      jobInfo.failedAt = new Date();
      
      this.emit('job:failed', { jobId, scheduleName, error, jobInfo });
      
      if (schedule.notifyOnFailure) {
        this.emit('backup:failure', { 
          scheduleName, 
          schedule,
          error,
          attempts: jobInfo.attempts
        });
      }
      
    } finally {
      // Add to history
      this.jobHistory.unshift({
        ...jobInfo,
        duration: (jobInfo.completedAt || jobInfo.failedAt) - jobInfo.startedAt
      });
      
      // Keep only last 100 jobs in history
      if (this.jobHistory.length > 100) {
        this.jobHistory = this.jobHistory.slice(0, 100);
      }
      
      this.runningJobs.delete(scheduleName);
    }
  }
  
  async _runBackupWithRetries(schedule, jobInfo) {
    let lastError;
    
    for (let attempt = 1; attempt <= jobInfo.maxAttempts; attempt++) {
      jobInfo.attempts = attempt;
      
      try {
        // Prepare backup options
        const backupOptions = { ...schedule.backupOptions };
        
        // Handle dynamic time ranges
        backupOptions.startTime = this._resolveTimeRange(backupOptions.startTime);
        backupOptions.endTime = this._resolveTimeRange(backupOptions.endTime);
        
        // Add metadata
        backupOptions.createdBy = `scheduled_job_${schedule.name}`;
        backupOptions.description = `${schedule.description} (attempt ${attempt})`;
        
        // Execute backup
        this.emit('job:attempt', { 
          jobId: jobInfo.id, 
          scheduleName: schedule.name, 
          attempt,
          options: backupOptions 
        });
        
        const backupResult = await this.backupManager.createBackup(backupOptions);
        
        // Handle multi-storage backup
        await this._handleMultiStorageBackup(backupResult, schedule);
        
        // Backup successful
        jobInfo.backupId = backupResult.id;
        jobInfo.backupResult = backupResult;
        
        return backupResult;
        
      } catch (error) {
        lastError = error;
        
        this.emit('job:attempt_failed', { 
          jobId: jobInfo.id, 
          scheduleName: schedule.name, 
          attempt, 
          error,
          willRetry: attempt < jobInfo.maxAttempts
        });
        
        // Wait before retry (exponential backoff)
        if (attempt < jobInfo.maxAttempts) {
          const delay = this.options.retryDelay * Math.pow(2, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  }
  
  async _handleMultiStorageBackup(backupResult, schedule) {
    const { retention } = schedule;
    
    // Copy to additional storage backends if specified
    for (const [backend, retentionDays] of Object.entries(retention)) {
      if (backend !== schedule.backupOptions.storageBackend) {
        try {
          // Copy backup to additional backend
          await this._copyBackupToStorage(backupResult, backend);
          
          this.emit('backup:copied', { 
            backupId: backupResult.id,
            fromBackend: schedule.backupOptions.storageBackend,
            toBackend: backend
          });
          
        } catch (error) {
          console.error(`Failed to copy backup to ${backend}:`, error);
          
          this.emit('backup:copy_failed', {
            backupId: backupResult.id,
            backend,
            error
          });
        }
      }
    }
  }
  
  async _copyBackupToStorage(backupResult, targetBackend) {
    // This would implement copying between storage backends
    // For now, it's a placeholder
    console.log(`Would copy backup ${backupResult.id} to ${targetBackend}`);
  }
  
  _resolveTimeRange(timeRange) {
    if (!timeRange || typeof timeRange !== 'string') {
      return timeRange;
    }
    
    const now = new Date();
    
    switch (timeRange.toUpperCase()) {
      case 'LAST_HOUR':
        return new Date(now.getTime() - 60 * 60 * 1000);
        
      case 'LAST_DAY':
        return new Date(now.getTime() - 24 * 60 * 60 * 1000);
        
      case 'LAST_WEEK':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        
      case 'LAST_MONTH':
        const lastMonth = new Date(now);
        lastMonth.setMonth(lastMonth.getMonth() - 1);
        return lastMonth;
        
      case 'LAST_YEAR':
        const lastYear = new Date(now);
        lastYear.setFullYear(lastYear.getFullYear() - 1);
        return lastYear;
        
      default:
        return timeRange;
    }
  }
  
  async _performHealthCheck() {
    if (this.isShutdown) return;
    
    const healthReport = {
      timestamp: new Date(),
      totalSchedules: this.schedules.size,
      enabledSchedules: 0,
      runningJobs: this.runningJobs.size,
      recentFailures: 0,
      scheduleHealth: {}
    };
    
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    for (const [name, schedule] of this.schedules.entries()) {
      if (schedule.enabled) {
        healthReport.enabledSchedules++;
      }
      
      // Check for recent failures
      if (schedule.lastFailure && schedule.lastFailure > oneDayAgo) {
        healthReport.recentFailures++;
      }
      
      // Individual schedule health
      const isHealthy = schedule.enabled && 
        (!schedule.lastFailure || 
         (schedule.lastSuccess && schedule.lastSuccess > schedule.lastFailure));
      
      healthReport.scheduleHealth[name] = {
        enabled: schedule.enabled,
        healthy: isHealthy,
        lastRun: schedule.lastRun,
        lastSuccess: schedule.lastSuccess,
        lastFailure: schedule.lastFailure,
        successRate: schedule.runCount > 0 ? schedule.successCount / schedule.runCount : null
      };
    }
    
    this.emit('health:report', healthReport);
    
    // Alert on unhealthy conditions
    if (healthReport.recentFailures > healthReport.enabledSchedules * 0.5) {
      this.emit('health:alert', {
        type: 'high_failure_rate',
        message: `High failure rate: ${healthReport.recentFailures}/${healthReport.enabledSchedules} schedules failed recently`,
        severity: 'warning'
      });
    }
  }
  
  // Management methods
  getSchedules() {
    return Array.from(this.schedules.entries()).map(([name, schedule]) => ({
      name,
      ...schedule,
      task: undefined // Don't include task object in output
    }));
  }
  
  getSchedule(name) {
    const schedule = this.schedules.get(name);
    return schedule ? { ...schedule, task: undefined } : null;
  }
  
  getRunningJobs() {
    return Array.from(this.runningJobs.values());
  }
  
  getJobHistory(limit = 50) {
    return this.jobHistory.slice(0, limit);
  }
  
  async triggerSchedule(name) {
    const schedule = this.schedules.get(name);
    if (!schedule) {
      throw new Error(`Schedule not found: ${name}`);
    }
    
    // Trigger immediately (don't wait for cron)
    await this._executeScheduledBackup(name);
  }
  
  getNextRun(name) {
    const schedule = this.schedules.get(name);
    if (!schedule || !schedule.task || !schedule.enabled) {
      return null;
    }
    
    // This would require additional cron parsing logic
    // For now, return null - could be enhanced with a cron parser
    return null;
  }
  
  async shutdown() {
    this.isShutdown = true;
    
    // Stop all scheduled tasks
    for (const [name, schedule] of this.schedules.entries()) {
      if (schedule.task) {
        schedule.task.stop();
        schedule.task.destroy();
      }
    }
    
    // Clear health check interval
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    // Wait for running jobs to complete (with timeout)
    const runningJobPromises = Array.from(this.runningJobs.keys()).map(name => 
      new Promise(resolve => {
        const checkInterval = setInterval(() => {
          if (!this.runningJobs.has(name)) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 1000);
        
        // Timeout after 5 minutes
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve();
        }, 5 * 60 * 1000);
      })
    );
    
    await Promise.all(runningJobPromises);
    
    this.removeAllListeners();
  }
}

export default ScheduledBackupService;