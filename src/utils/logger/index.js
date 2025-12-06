const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const config = require('../../config');

/**
 * Enhanced Logger with Winston
 * Provides structured logging with multiple transports and log levels
 */
class Logger {
  constructor() {
    this.logger = this.createLogger();
  }

  createLogger() {
    const logDir = path.join(process.cwd(), 'logs');
    
    // Custom format for structured logging
    const logFormat = winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
      winston.format.errors({ stack: true }),
      winston.format.json(),
      winston.format.printf(({ timestamp, level, message, service, userId, taskId, processInstanceId, ...meta }) => {
        const logEntry = {
          timestamp,
          level: level.toUpperCase(),
          message,
          service: service || config.get('app.name'),
          ...(userId && { userId }),
          ...(taskId && { taskId }),
          ...(processInstanceId && { processInstanceId }),
          ...meta
        };
        return JSON.stringify(logEntry);
      })
    );

    // Console format for development
    const consoleFormat = winston.format.combine(
      winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
      winston.format.colorize({ all: true }),
      winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
        const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
        return `[${timestamp}] ${level}: ${message} ${metaStr}`;
      })
    );

    const transports = [];

    // Console transport (always enabled in development)
    if (config.isDevelopment()) {
      transports.push(
        new winston.transports.Console({
          format: consoleFormat,
          level: config.get('app.logLevel')
        })
      );
    }

    // File transports for production
    if (config.isProduction()) {
      // Error logs
      transports.push(
        new DailyRotateFile({
          filename: path.join(logDir, 'error-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          maxSize: '20m',
          maxFiles: '14d',
          level: 'error',
          format: logFormat,
          zippedArchive: true
        })
      );

      // Combined logs
      transports.push(
        new DailyRotateFile({
          filename: path.join(logDir, 'combined-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          maxSize: '20m',
          maxFiles: '7d',
          format: logFormat,
          zippedArchive: true
        })
      );

      // Worker specific logs
      transports.push(
        new DailyRotateFile({
          filename: path.join(logDir, 'worker-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          maxSize: '20m',
          maxFiles: '7d',
          format: logFormat,
          zippedArchive: true,
          level: 'debug'
        })
      );
    } else {
      // Development file logging
      transports.push(
        new winston.transports.File({
          filename: path.join(logDir, 'development.log'),
          format: logFormat,
          maxsize: 10 * 1024 * 1024, // 10MB
          maxFiles: 3
        })
      );
    }

    return winston.createLogger({
      level: config.get('app.logLevel'),
      format: logFormat,
      defaultMeta: {
        service: config.get('app.name'),
        version: config.get('app.version'),
        environment: config.get('app.env'),
        hostname: require('os').hostname(),
        pid: process.pid
      },
      transports,
      // Handle uncaught exceptions
      exceptionHandlers: [
        new winston.transports.File({ 
          filename: path.join(logDir, 'exceptions.log'),
          format: logFormat
        })
      ],
      // Handle promise rejections
      rejectionHandlers: [
        new winston.transports.File({ 
          filename: path.join(logDir, 'rejections.log'),
          format: logFormat
        })
      ],
      exitOnError: false
    });
  }

  /**
   * Log application lifecycle events
   */
  lifecycle(event, data = {}) {
    this.logger.info(`Application lifecycle: ${event}`, {
      lifecycle: true,
      event,
      ...data
    });
  }

  /**
   * Log worker-specific events
   */
  worker(message, data = {}) {
    this.logger.info(message, {
      component: 'worker',
      ...data
    });
  }

  /**
   * Log Camunda task events
   */
  task(message, taskId, processInstanceId, data = {}) {
    this.logger.info(message, {
      component: 'camunda-task',
      taskId,
      processInstanceId,
      ...data
    });
  }

  /**
   * Log API requests
   */
  request(method, url, statusCode, responseTime, userId = null) {
    this.logger.info('API Request', {
      component: 'api',
      method,
      url,
      statusCode,
      responseTime: `${responseTime}ms`,
      userId
    });
  }

  /**
   * Log database operations
   */
  database(operation, table, duration, error = null) {
    const level = error ? 'error' : 'debug';
    this.logger[level]('Database Operation', {
      component: 'database',
      operation,
      table,
      duration: `${duration}ms`,
      ...(error && { error: error.message, stack: error.stack })
    });
  }

  /**
   * Log external API calls
   */
  external(service, method, url, statusCode, responseTime, error = null) {
    const level = error || statusCode >= 400 ? 'error' : 'info';
    this.logger[level]('External API Call', {
      component: 'external-api',
      service,
      method,
      url,
      statusCode,
      responseTime: `${responseTime}ms`,
      ...(error && { error: error.message })
    });
  }

  /**
   * Standard log methods
   */
  error(message, error = null, meta = {}) {
    this.logger.error(message, {
      ...(error && { 
        error: error.message, 
        stack: error.stack,
        code: error.code
      }),
      ...meta
    });
  }

  warn(message, meta = {}) {
    this.logger.warn(message, meta);
  }

  info(message, meta = {}) {
    this.logger.info(message, meta);
  }

  debug(message, meta = {}) {
    this.logger.debug(message, meta);
  }

  /**
   * Performance logging
   */
  performance(operation, duration, meta = {}) {
    this.logger.info(`Performance: ${operation}`, {
      component: 'performance',
      operation,
      duration: `${duration}ms`,
      ...meta
    });
  }

  /**
   * Security logging
   */
  security(event, userId, ip, details = {}) {
    this.logger.warn(`Security Event: ${event}`, {
      component: 'security',
      event,
      userId,
      ip,
      ...details
    });
  }

  /**
   * Business logic logging
   */
  business(event, data = {}) {
    this.logger.info(`Business Event: ${event}`, {
      component: 'business',
      event,
      ...data
    });
  }

  /**
   * Create child logger with additional context
   */
  child(meta) {
    return {
      error: (message, error, additionalMeta) => this.error(message, error, { ...meta, ...additionalMeta }),
      warn: (message, additionalMeta) => this.warn(message, { ...meta, ...additionalMeta }),
      info: (message, additionalMeta) => this.info(message, { ...meta, ...additionalMeta }),
      debug: (message, additionalMeta) => this.debug(message, { ...meta, ...additionalMeta }),
    };
  }
}

// Export singleton instance
const logger = new Logger();
module.exports = logger;