import chalk from 'chalk';
import { writeFileSync, appendFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';

class Logger {
  constructor(options = {}) {
    this.logLevel = options.logLevel || 'info';
    this.logToFile = options.logToFile !== false;
    this.logDir = options.logDir || '.traversion/logs';
    this.colorize = options.colorize !== false;
    
    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
      trace: 4
    };
    
    if (this.logToFile) {
      this.initLogFiles();
    }
  }
  
  initLogFiles() {
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().split('T')[0];
    this.logFile = path.join(this.logDir, `traversion-${timestamp}.log`);
    this.errorFile = path.join(this.logDir, `error-${timestamp}.log`);
    
    // Write header
    const header = `=== Traversion Log Started at ${new Date().toISOString()} ===\n`;
    writeFileSync(this.logFile, header);
    writeFileSync(this.errorFile, header);
  }
  
  shouldLog(level) {
    return this.levels[level] <= this.levels[this.logLevel];
  }
  
  formatMessage(level, message, metadata = {}) {
    const timestamp = new Date().toISOString();
    const metaStr = Object.keys(metadata).length > 0 
      ? ` ${JSON.stringify(metadata)}` 
      : '';
    
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
  }
  
  writeToFile(level, message, metadata) {
    if (!this.logToFile) return;
    
    const formattedMessage = this.formatMessage(level, message, metadata) + '\n';
    
    try {
      appendFileSync(this.logFile, formattedMessage);
      
      if (level === 'error') {
        appendFileSync(this.errorFile, formattedMessage);
      }
    } catch (err) {
      console.error('Failed to write to log file:', err);
    }
  }
  
  log(level, message, metadata = {}) {
    if (!this.shouldLog(level)) return;
    
    this.writeToFile(level, message, metadata);
    
    const timestamp = new Date().toLocaleTimeString();
    let output = message;
    
    if (this.colorize) {
      const colors = {
        error: chalk.red,
        warn: chalk.yellow,
        info: chalk.cyan,
        debug: chalk.gray,
        trace: chalk.dim
      };
      
      const icons = {
        error: '❌',
        warn: '⚠️',
        info: 'ℹ️',
        debug: '🔍',
        trace: '📝'
      };
      
      const color = colors[level] || chalk.white;
      output = `${icons[level]} ${color(message)} ${chalk.dim(timestamp)}`;
    } else {
      output = `[${level.toUpperCase()}] ${message} ${timestamp}`;
    }
    
    if (Object.keys(metadata).length > 0) {
      output += `\n   ${chalk.dim(JSON.stringify(metadata, null, 2))}`;
    }
    
    if (level === 'error') {
      console.error(output);
    } else {
      console.log(output);
    }
  }
  
  error(message, metadata) {
    this.log('error', message, metadata);
  }
  
  warn(message, metadata) {
    this.log('warn', message, metadata);
  }
  
  info(message, metadata) {
    this.log('info', message, metadata);
  }
  
  debug(message, metadata) {
    this.log('debug', message, metadata);
  }
  
  trace(message, metadata) {
    this.log('trace', message, metadata);
  }
  
  // Performance logging
  startTimer(label) {
    return {
      label,
      start: Date.now()
    };
  }
  
  endTimer(timer) {
    const duration = Date.now() - timer.start;
    this.debug(`${timer.label} completed`, { duration: `${duration}ms` });
    return duration;
  }
  
  // Structured logging for specific events
  logFileChange(filePath, versionId, metadata = {}) {
    this.info(`File changed: ${filePath}`, {
      versionId,
      ...metadata
    });
  }
  
  logApiRequest(method, path, statusCode, duration) {
    const level = statusCode >= 400 ? 'error' : 'info';
    this.log(level, `${method} ${path} - ${statusCode}`, {
      duration: `${duration}ms`
    });
  }
  
  logWebSocketEvent(event, clientCount) {
    this.debug(`WebSocket ${event}`, { clients: clientCount });
  }
  
  // Error handling with stack traces
  logError(error, context = {}) {
    this.error(error.message, {
      stack: error.stack,
      ...context
    });
  }
}

// Create singleton instance
const logger = new Logger({
  logLevel: process.env.LOG_LEVEL || 'info',
  logToFile: process.env.LOG_TO_FILE !== 'false',
  colorize: process.env.NO_COLOR !== 'true'
});

export default logger;
export { Logger };