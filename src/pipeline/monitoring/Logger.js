// src/pipeline/monitoring/Logger.js

/**
 * Structured logging system for the data ingestion pipeline
 * Provides different log levels and structured output
 */
export class Logger {
  constructor(component) {
    this.component = component;
    this.logLevels = {
      DEBUG: 0,
      INFO: 1,
      WARN: 2,
      ERROR: 3
    };
    
    // Set log level from environment or default to INFO
    this.currentLevel = this.logLevels[process.env.LOG_LEVEL] || this.logLevels.INFO;
  }

  /**
   * Format log message with timestamp and component
   */
  formatMessage(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      component: this.component,
      message
    };

    if (data) {
      if (data instanceof Error) {
        logEntry.error = {
          name: data.name,
          message: data.message,
          stack: data.stack
        };
      } else if (typeof data === 'object') {
        logEntry.data = data;
      } else {
        logEntry.data = { value: data };
      }
    }

    return logEntry;
  }

  /**
   * Output log message
   */
  output(logEntry) {
    const formatted = JSON.stringify(logEntry);
    
    switch (logEntry.level) {
      case 'ERROR':
        console.error(formatted);
        break;
      case 'WARN':
        console.warn(formatted);
        break;
      case 'DEBUG':
        console.debug(formatted);
        break;
      default:
        console.log(formatted);
    }
  }

  /**
   * Debug level logging
   */
  debug(message, data = null) {
    if (this.currentLevel <= this.logLevels.DEBUG) {
      const logEntry = this.formatMessage('DEBUG', message, data);
      this.output(logEntry);
    }
  }

  /**
   * Info level logging
   */
  info(message, data = null) {
    if (this.currentLevel <= this.logLevels.INFO) {
      const logEntry = this.formatMessage('INFO', message, data);
      this.output(logEntry);
    }
  }

  /**
   * Warning level logging
   */
  warn(message, data = null) {
    if (this.currentLevel <= this.logLevels.WARN) {
      const logEntry = this.formatMessage('WARN', message, data);
      this.output(logEntry);
    }
  }

  /**
   * Error level logging
   */
  error(message, data = null) {
    if (this.currentLevel <= this.logLevels.ERROR) {
      const logEntry = this.formatMessage('ERROR', message, data);
      this.output(logEntry);
    }
  }
}