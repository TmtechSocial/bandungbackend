const logger = require('../logger');
const config = require('../../config');

/**
 * Custom Error Classes for better error categorization
 */
class AppError extends Error {
  constructor(message, statusCode, code, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    this.timestamp = new Date().toISOString();
    
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message, field = null) {
    super(message, 400, 'VALIDATION_ERROR');
    this.field = field;
  }
}

class DatabaseError extends AppError {
  constructor(message, originalError = null) {
    super(message, 500, 'DATABASE_ERROR');
    this.originalError = originalError;
  }
}

class ExternalServiceError extends AppError {
  constructor(service, message, statusCode = 503) {
    super(`${service}: ${message}`, statusCode, 'EXTERNAL_SERVICE_ERROR');
    this.service = service;
  }
}

class CamundaError extends AppError {
  constructor(message, taskId = null, processInstanceId = null) {
    super(message, 500, 'CAMUNDA_ERROR');
    this.taskId = taskId;
    this.processInstanceId = processInstanceId;
  }
}

class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

class AuthorizationError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

/**
 * Retry Logic Handler
 */
class RetryHandler {
  static async withRetry(operation, options = {}) {
    const {
      maxAttempts = 3,
      baseDelay = 1000,
      maxDelay = 10000,
      backoffFactor = 2,
      retryCondition = (error) => true,
      onRetry = null
    } = options;

    let lastError;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        // Log the attempt
        logger.warn('Operation failed, attempting retry', {
          component: 'retry-handler',
          attempt,
          maxAttempts,
          error: error.message,
          operation: operation.name || 'anonymous'
        });

        // Check if we should retry
        if (attempt === maxAttempts || !retryCondition(error)) {
          break;
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(
          baseDelay * Math.pow(backoffFactor, attempt - 1),
          maxDelay
        );

        // Add jitter to prevent thundering herd
        const jitteredDelay = delay + Math.random() * 1000;

        // Call retry callback if provided
        if (onRetry) {
          await onRetry(error, attempt);
        }

        // Wait before next attempt
        await new Promise(resolve => setTimeout(resolve, jitteredDelay));
      }
    }

    // All retries failed
    throw lastError;
  }

  static isRetryableError(error) {
    // Define which errors are retryable
    if (error.code === 'ECONNRESET' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
      return true;
    }
    
    if (error.response && [408, 429, 500, 502, 503, 504].includes(error.response.status)) {
      return true;
    }

    return false;
  }
}

/**
 * Circuit Breaker Pattern for External Services
 */
class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold || 5;
    this.recoveryTimeout = options.recoveryTimeout || 60000;
    this.monitoringPeriod = options.monitoringPeriod || 10000;
    
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.successCount = 0;
  }

  async execute(operation) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime < this.recoveryTimeout) {
        throw new ExternalServiceError(this.name, 'Circuit breaker is OPEN');
      } else {
        this.state = 'HALF_OPEN';
        this.successCount = 0;
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess() {
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= 3) {
        this.state = 'CLOSED';
        this.failureCount = 0;
        logger.info(`Circuit breaker ${this.name} closed after recovery`);
      }
    } else {
      this.failureCount = 0;
    }
  }

  onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      logger.error(`Circuit breaker ${this.name} opened due to failures`, {
        failureCount: this.failureCount,
        threshold: this.failureThreshold
      });
    }
  }

  getState() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime
    };
  }
}

/**
 * Global Error Handler
 */
class ErrorHandler {
  constructor() {
    this.circuitBreakers = new Map();
    this.setupGlobalHandlers();
  }

  setupGlobalHandlers() {
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception', error, {
        component: 'global-error-handler',
        fatal: true
      });
      
      // Give time for logs to flush before exit
      setTimeout(() => process.exit(1), 1000);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Promise Rejection', new Error(reason), {
        component: 'global-error-handler',
        promise: promise.toString()
      });
    });
  }

  /**
   * Create or get circuit breaker for service
   */
  getCircuitBreaker(serviceName, options = {}) {
    if (!this.circuitBreakers.has(serviceName)) {
      this.circuitBreakers.set(serviceName, new CircuitBreaker(serviceName, options));
    }
    return this.circuitBreakers.get(serviceName);
  }

  /**
   * Handle Fastify errors
   */
  handleFastifyError(error, request, reply) {
    // Log the error
    logger.error('Fastify Error', error, {
      component: 'fastify-error-handler',
      method: request.method,
      url: request.url,
      ip: request.ip,
      userAgent: request.headers['user-agent']
    });

    // Handle different error types
    if (error instanceof ValidationError) {
      return reply.code(400).send({
        success: false,
        error: 'Validation Error',
        message: error.message,
        field: error.field,
        code: error.code
      });
    }

    if (error instanceof AuthenticationError) {
      return reply.code(401).send({
        success: false,
        error: 'Authentication Error',
        message: error.message,
        code: error.code
      });
    }

    if (error instanceof AuthorizationError) {
      return reply.code(403).send({
        success: false,
        error: 'Authorization Error', 
        message: error.message,
        code: error.code
      });
    }

    if (error instanceof AppError && error.isOperational) {
      return reply.code(error.statusCode).send({
        success: false,
        error: 'Application Error',
        message: error.message,
        code: error.code
      });
    }

    // Default server error
    const statusCode = error.statusCode || 500;
    const message = config.isProduction() ? 'Internal Server Error' : error.message;

    return reply.code(statusCode).send({
      success: false,
      error: 'Server Error',
      message,
      ...(config.isDevelopment() && { stack: error.stack })
    });
  }

  /**
   * Wrap async functions with error handling
   */
  wrapAsync(fn) {
    return async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        
        // Convert unknown errors to AppError
        throw new AppError(
          error.message || 'Unknown error occurred',
          500,
          'UNKNOWN_ERROR',
          false
        );
      }
    };
  }

  /**
   * Database error handler with retry
   */
  async handleDatabaseOperation(operation, context = {}) {
    return RetryHandler.withRetry(operation, {
      maxAttempts: 3,
      baseDelay: 1000,
      retryCondition: (error) => {
        // Retry on connection errors
        return error.code === 'ECONNRESET' || 
               error.code === 'ETIMEDOUT' ||
               error.message.includes('connection');
      },
      onRetry: (error, attempt) => {
        logger.warn('Database operation retry', {
          component: 'database-retry',
          attempt,
          error: error.message,
          ...context
        });
      }
    });
  }

  /**
   * External API call handler with circuit breaker
   */
  async handleExternalApiCall(serviceName, operation, options = {}) {
    const circuitBreaker = this.getCircuitBreaker(serviceName, options.circuitBreaker);
    
    return circuitBreaker.execute(async () => {
      return RetryHandler.withRetry(operation, {
        maxAttempts: options.maxAttempts || 3,
        baseDelay: options.baseDelay || 1000,
        retryCondition: RetryHandler.isRetryableError,
        onRetry: (error, attempt) => {
          logger.warn('External API retry', {
            component: 'external-api-retry',
            service: serviceName,
            attempt,
            error: error.message
          });
        }
      });
    });
  }

  /**
   * Get all circuit breaker states
   */
  getCircuitBreakerStates() {
    const states = {};
    this.circuitBreakers.forEach((breaker, name) => {
      states[name] = breaker.getState();
    });
    return states;
  }
}

// Export singleton instance and classes
const errorHandler = new ErrorHandler();

module.exports = {
  errorHandler,
  RetryHandler,
  CircuitBreaker,
  AppError,
  ValidationError,
  DatabaseError,
  ExternalServiceError,
  CamundaError,
  AuthenticationError,
  AuthorizationError
};