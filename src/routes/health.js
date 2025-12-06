const { healthChecker } = require('../utils/healthCheck');
const { metricsCollector } = require('../utils/metrics');
const { gracefulShutdown } = require('../utils/gracefulShutdown');
const { errorHandler } = require('../utils/errorHandler');
const config = require('../config');

/**
 * Health and Monitoring Routes
 * Provides comprehensive health check and monitoring endpoints
 */
async function healthRoutes(fastify, options) {
  
  // Comprehensive health check
  fastify.get('/health', async (request, reply) => {
    try {
      const healthStatus = await healthChecker.getHealthStatus();
      const statusCode = healthStatus.status === 'unhealthy' ? 503 : 200;
      
      return reply.code(statusCode).send(healthStatus);
    } catch (error) {
      fastify.log.error('Health check failed', error);
      return reply.code(500).send({
        status: 'error',
        message: 'Health check failed',
        timestamp: new Date().toISOString()
      });
    }
  });

  // Kubernetes/Docker liveness probe
  fastify.get('/health/liveness', async (request, reply) => {
    const livenessStatus = await healthChecker.getLivenessStatus();
    return reply.send(livenessStatus);
  });

  // Kubernetes/Docker readiness probe
  fastify.get('/health/readiness', async (request, reply) => {
    try {
      const readinessStatus = await healthChecker.getReadinessStatus();
      const statusCode = readinessStatus.status === 'not-ready' ? 503 : 200;
      return reply.code(statusCode).send(readinessStatus);
    } catch (error) {
      fastify.log.error('Readiness check failed', error);
      return reply.code(503).send({
        status: 'not-ready',
        message: 'Readiness check failed',
        timestamp: new Date().toISOString()
      });
    }
  });

  // Individual health check
  fastify.get('/health/check/:checkId', async (request, reply) => {
    try {
      const { checkId } = request.params;
      const result = await healthChecker.executeCheck(checkId);
      
      const statusCode = result.status === 'unhealthy' ? 503 : 200;
      return reply.code(statusCode).send(result);
    } catch (error) {
      return reply.code(404).send({
        status: 'error',
        message: `Health check '${request.params.checkId}' not found`,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Prometheus metrics endpoint
  fastify.get('/metrics', async (request, reply) => {
    try {
      const metrics = await metricsCollector.getMetrics();
      return reply
        .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
        .send(metrics);
    } catch (error) {
      fastify.log.error('Metrics collection failed', error);
      return reply.code(500).send('Metrics unavailable');
    }
  });

  // Application info endpoint
  fastify.get('/info', async (request, reply) => {
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();
    
    return reply.send({
      application: {
        name: config.get('app.name'),
        version: config.get('app.version'),
        environment: config.get('app.env'),
        uptime: {
          seconds: Math.floor(uptime),
          human: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`
        }
      },
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        memory: {
          rss: `${Math.round(memoryUsage.rss / 1024 / 1024)}MB`,
          heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
          heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
          external: `${Math.round(memoryUsage.external / 1024 / 1024)}MB`
        }
      },
      timestamp: new Date().toISOString()
    });
  });

  // Worker status endpoint
  fastify.get('/status/worker', async (request, reply) => {
    const workerStatus = gracefulShutdown.getStatus();
    const circuitBreakerStates = errorHandler.getCircuitBreakerStates();
    
    return reply.send({
      worker: {
        isShuttingDown: workerStatus.isShuttingDown,
        canAcceptWork: gracefulShutdown.canAcceptWork(),
        activeTasks: workerStatus.activeTasks.length,
        tasks: workerStatus.activeTasks
      },
      circuitBreakers: circuitBreakerStates,
      timestamp: new Date().toISOString()
    });
  });

  // Configuration endpoint (non-sensitive only)
  fastify.get('/status/config', async (request, reply) => {
    return reply.send({
      application: {
        name: config.get('app.name'),
        version: config.get('app.version'),
        environment: config.get('app.env'),
        port: config.get('app.port'),
        logLevel: config.get('app.logLevel')
      },
      features: {
        metricsEnabled: config.get('monitoring.metrics.enabled'),
        healthCheckInterval: config.get('monitoring.healthCheck.interval'),
        workerConcurrency: config.get('worker.concurrency')
      },
      limits: {
        maxFileSize: config.get('upload.maxSize'),
        gracefulShutdownTimeout: config.get('worker.gracefulShutdownTimeout'),
        maxConnections: config.get('database.maxConnections')
      }
    });
  });
}

module.exports = healthRoutes;