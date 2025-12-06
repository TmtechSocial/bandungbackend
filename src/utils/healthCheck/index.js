const logger = require('../logger');
const config = require('../../config');
const { Pool } = require('pg');
const axios = require('axios');

/**
 * Health Check System for Worker Service
 * Provides comprehensive health monitoring for all system components
 */
class HealthChecker {
  constructor() {
    this.checks = new Map();
    this.lastResults = new Map();
    this.isRunning = false;
    this.interval = null;
    this.setupDefaultChecks();
  }

  /**
   * Setup default health checks
   */
  setupDefaultChecks() {
    // Database connectivity check
    this.registerCheck('database', {
      name: 'PostgreSQL Database',
      check: this.checkDatabase.bind(this),
      timeout: 5000,
      critical: true,
      interval: 30000
    });

    // Inventree Database check
    this.registerCheck('inventree_database', {
      name: 'Inventree PostgreSQL Database',
      check: this.checkInventreeDatabase.bind(this),
      timeout: 5000,
      critical: true,
      interval: 30000
    });

    // Camunda API check
    this.registerCheck('camunda', {
      name: 'Camunda BPM API',
      check: this.checkCamunda.bind(this),
      timeout: 10000,
      critical: true,
      interval: 60000
    });

    // GraphQL API check
    this.registerCheck('graphql', {
      name: 'GraphQL API',
      check: this.checkGraphQL.bind(this),
      timeout: 10000,
      critical: false,
      interval: 60000
    });

    // Memory usage check
    this.registerCheck('memory', {
      name: 'Memory Usage',
      check: this.checkMemory.bind(this),
      timeout: 1000,
      critical: false,
      interval: 15000
    });

    // Disk space check
    this.registerCheck('disk', {
      name: 'Disk Space',
      check: this.checkDiskSpace.bind(this),
      timeout: 2000,
      critical: false,
      interval: 60000
    });

    // Worker tasks check
    this.registerCheck('worker_tasks', {
      name: 'Active Worker Tasks',
      check: this.checkWorkerTasks.bind(this),
      timeout: 1000,
      critical: false,
      interval: 15000
    });

    // RabbitMQ check
    this.registerCheck('rabbitmq', {
      name: 'RabbitMQ Message Broker',
      check: this.checkRabbitMQ.bind(this),
      timeout: 10000,
      critical: false,
      interval: 60000
    });
  }

  /**
   * Register a new health check
   */
  registerCheck(id, checkConfig) {
    this.checks.set(id, {
      id,
      ...checkConfig,
      lastRun: null,
      lastResult: null
    });

    logger.debug('Health check registered', {
      component: 'health-check',
      checkId: id,
      name: checkConfig.name
    });
  }

  /**
   * Database connectivity check
   */
  async checkDatabase() {
    const pool = new Pool(config.getDatabaseConfig());
    
    try {
      const client = await pool.connect();
      const result = await client.query('SELECT NOW() as timestamp, version() as version');
      client.release();
      await pool.end();

      return {
        status: 'healthy',
        message: 'Database connection successful',
        details: {
          timestamp: result.rows[0].timestamp,
          version: result.rows[0].version.split(' ')[0]
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: 'Database connection failed',
        error: error.message
      };
    }
  }

  /**
   * Inventree database connectivity check
   */
  async checkInventreeDatabase() {
    const pool = new Pool(config.getInventreeDbConfig());
    
    try {
      const client = await pool.connect();
      const result = await client.query('SELECT NOW() as timestamp');
      client.release();
      await pool.end();

      return {
        status: 'healthy',
        message: 'Inventree database connection successful',
        details: {
          timestamp: result.rows[0].timestamp
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: 'Inventree database connection failed',
        error: error.message
      };
    }
  }

  /**
   * Camunda API connectivity check
   */
  async checkCamunda() {
    try {
      const camundaUrl = config.get('api.camunda.baseUrl');
      const response = await axios.get(`${camundaUrl}/engine`, {
        timeout: config.get('api.camunda.timeout')
      });

      return {
        status: 'healthy',
        message: 'Camunda API accessible',
        details: {
          engines: response.data.length,
          responseTime: response.headers['x-response-time']
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: 'Camunda API unreachable',
        error: error.message,
        details: {
          status: error.response?.status,
          statusText: error.response?.statusText
        }
      };
    }
  }

  /**
   * GraphQL API connectivity check
   */
  async checkGraphQL() {
    try {
      const graphqlUrl = config.get('api.graphql.endpoint');
      const response = await axios.post(graphqlUrl, {
        query: '{ __schema { queryType { name } } }'
      }, {
        timeout: config.get('api.graphql.timeout'),
        headers: {
          'Content-Type': 'application/json'
        }
      });

      return {
        status: 'healthy',
        message: 'GraphQL API accessible',
        details: {
          queryType: response.data.data?.__schema?.queryType?.name
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: 'GraphQL API unreachable',
        error: error.message,
        details: {
          status: error.response?.status,
          statusText: error.response?.statusText
        }
      };
    }
  }

  /**
   * Memory usage check
   */
  async checkMemory() {
    const memUsage = process.memoryUsage();
    const totalMemory = require('os').totalmem();
    const freeMemory = require('os').freemem();
    
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const rssMB = Math.round(memUsage.rss / 1024 / 1024);
    const systemUsedPercent = Math.round(((totalMemory - freeMemory) / totalMemory) * 100);

    const heapUsagePercent = Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100);
    
    // Consider unhealthy if heap usage > 90% or RSS > 1GB
    const isUnhealthy = heapUsagePercent > 90 || rssMB > 1024;

    return {
      status: isUnhealthy ? 'warning' : 'healthy',
      message: `Memory usage: ${heapUsedMB}MB heap, ${rssMB}MB RSS`,
      details: {
        heap: {
          used: heapUsedMB,
          total: heapTotalMB,
          percent: heapUsagePercent
        },
        rss: rssMB,
        external: Math.round(memUsage.external / 1024 / 1024),
        system: {
          total: Math.round(totalMemory / 1024 / 1024),
          free: Math.round(freeMemory / 1024 / 1024),
          usedPercent: systemUsedPercent
        }
      }
    };
  }

  /**
   * Disk space check
   */
  async checkDiskSpace() {
    const fs = require('fs').promises;
    const path = require('path');
    
    try {
      const stats = await fs.statSync(process.cwd());
      
      // For Windows, we'll check available space differently
      const { execSync } = require('child_process');
      const drive = process.cwd().split(':')[0] + ':';
      const output = execSync(`fsutil volume diskfree ${drive}`, { encoding: 'utf8' });
      
      const lines = output.split('\n');
      const freeBytes = parseInt(lines[0].match(/\d+/)[0]);
      const totalBytes = parseInt(lines[1].match(/\d+/)[0]);
      
      const freeGB = Math.round(freeBytes / (1024 * 1024 * 1024));
      const totalGB = Math.round(totalBytes / (1024 * 1024 * 1024));
      const usedPercent = Math.round(((totalBytes - freeBytes) / totalBytes) * 100);
      
      // Consider warning if < 10% free or < 5GB free
      const isWarning = usedPercent > 90 || freeGB < 5;

      return {
        status: isWarning ? 'warning' : 'healthy',
        message: `Disk usage: ${usedPercent}% used, ${freeGB}GB free`,
        details: {
          drive,
          total: totalGB,
          free: freeGB,
          usedPercent
        }
      };
    } catch (error) {
      return {
        status: 'warning',
        message: 'Could not check disk space',
        error: error.message
      };
    }
  }

  /**
   * Worker tasks check
   */
  async checkWorkerTasks() {
    const { gracefulShutdown } = require('../gracefulShutdown');
    const status = gracefulShutdown.getStatus();
    
    const activeTasks = status.activeTasks.length;
    const isShuttingDown = status.isShuttingDown;
    
    // Get longest running task
    const longestTask = status.activeTasks.reduce((longest, task) => {
      return task.runtime > (longest?.runtime || 0) ? task : longest;
    }, null);

    return {
      status: isShuttingDown ? 'warning' : 'healthy',
      message: `${activeTasks} active tasks${isShuttingDown ? ' (shutting down)' : ''}`,
      details: {
        activeTasks,
        isShuttingDown,
        longestRunningTask: longestTask ? {
          id: longestTask.id,
          runtime: `${Math.round(longestTask.runtime / 1000)}s`
        } : null
      }
    };
  }

  /**
   * Check RabbitMQ connectivity and status
   */
  async checkRabbitMQ() {
    try {
      const rabbitmqConfig = config.get('rabbitmq');
      if (!rabbitmqConfig.url) {
        return {
          status: 'warning',
          message: 'RabbitMQ not configured',
          responseTime: 0
        };
      }

      // Import here to avoid circular dependency issues
      const { queueManager } = require('../rabbitmq');
      
      const startTime = Date.now();
      const healthResult = await queueManager.healthCheck();
      const responseTime = Date.now() - startTime;

      return {
        status: healthResult.status === 'healthy' ? 'healthy' : 'unhealthy',
        message: healthResult.message,
        responseTime,
        details: {
          connection: healthResult.stats?.connection,
          queues: Object.keys(rabbitmqConfig.queues),
          exchange: rabbitmqConfig.exchangeName
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `RabbitMQ health check failed: ${error.message}`,
        error: error.message
      };
    }
  }

  /**
   * Execute a single health check
   */
  async executeCheck(checkId) {
    const check = this.checks.get(checkId);
    if (!check) {
      throw new Error(`Health check '${checkId}' not found`);
    }

    const startTime = Date.now();
    let result;

    try {
      // Execute check with timeout
      const checkPromise = check.check();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Health check timeout')), check.timeout)
      );

      result = await Promise.race([checkPromise, timeoutPromise]);
      
      result.responseTime = Date.now() - startTime;
      result.timestamp = new Date().toISOString();
      result.checkId = checkId;

    } catch (error) {
      result = {
        status: 'unhealthy',
        message: 'Health check failed',
        error: error.message,
        responseTime: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        checkId: checkId
      };
    }

    // Update check metadata
    check.lastRun = Date.now();
    check.lastResult = result;
    this.lastResults.set(checkId, result);

    // Log result if unhealthy
    if (result.status === 'unhealthy') {
      logger.warn('Health check failed', {
        component: 'health-check',
        checkId,
        name: check.name,
        error: result.error,
        responseTime: result.responseTime
      });
    }

    return result;
  }

  /**
   * Execute all health checks
   */
  async executeAllChecks() {
    const results = {};
    const checkPromises = Array.from(this.checks.keys()).map(async (checkId) => {
      try {
        results[checkId] = await this.executeCheck(checkId);
      } catch (error) {
        results[checkId] = {
          status: 'error',
          message: 'Health check execution failed',
          error: error.message,
          timestamp: new Date().toISOString(),
          checkId: checkId
        };
      }
    });

    await Promise.all(checkPromises);
    return results;
  }

  /**
   * Get overall health status
   */
  async getHealthStatus() {
    const results = await this.executeAllChecks();
    
    let overallStatus = 'healthy';
    const criticalFailures = [];
    const warnings = [];
    
    Object.entries(results).forEach(([checkId, result]) => {
      const check = this.checks.get(checkId);
      
      if (result.status === 'unhealthy') {
        if (check.critical) {
          overallStatus = 'unhealthy';
          criticalFailures.push(checkId);
        } else {
          if (overallStatus === 'healthy') {
            overallStatus = 'warning';
          }
          warnings.push(checkId);
        }
      } else if (result.status === 'warning') {
        if (overallStatus === 'healthy') {
          overallStatus = 'warning';
        }
        warnings.push(checkId);
      }
    });

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      checks: results,
      summary: {
        total: Object.keys(results).length,
        healthy: Object.values(results).filter(r => r.status === 'healthy').length,
        warning: warnings.length,
        unhealthy: criticalFailures.length,
        criticalFailures,
        warnings
      },
      uptime: process.uptime(),
      version: config.get('app.version'),
      environment: config.get('app.env')
    };
  }

  /**
   * Start periodic health checks
   */
  start() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    logger.info('Health checker started', {
      component: 'health-check',
      checks: Array.from(this.checks.keys())
    });

    // Run initial check
    this.executeAllChecks();
  }

  /**
   * Stop periodic health checks
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    logger.info('Health checker stopped', {
      component: 'health-check'
    });
  }

  /**
   * Get quick status for liveness probe
   */
  async getLivenessStatus() {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      pid: process.pid
    };
  }

  /**
   * Get readiness status (includes dependency checks)
   */
  async getReadinessStatus() {
    const criticalChecks = Array.from(this.checks.entries())
      .filter(([_, check]) => check.critical)
      .map(([id, _]) => id);

    const results = {};
    for (const checkId of criticalChecks) {
      results[checkId] = await this.executeCheck(checkId);
    }

    const isReady = Object.values(results).every(r => r.status === 'healthy');

    return {
      status: isReady ? 'ready' : 'not-ready',
      timestamp: new Date().toISOString(),
      checks: results
    };
  }
}

// Export singleton instance
const healthChecker = new HealthChecker();

module.exports = {
  healthChecker
};