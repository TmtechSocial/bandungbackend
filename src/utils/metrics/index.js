const client = require('prom-client');
const config = require('../../config');
const logger = require('../logger');

/**
 * Prometheus Metrics Collector for Worker Service
 * Provides comprehensive application metrics for monitoring and observability
 */
class MetricsCollector {
  constructor() {
    this.prefix = config.get('monitoring.metrics.prefix');
    this.register = new client.Registry();
    this.defaultMetrics = client.collectDefaultMetrics;
    
    this.setupDefaultMetrics();
    this.setupCustomMetrics();
    this.setupEventListeners();
  }

  /**
   * Setup default Node.js metrics
   */
  setupDefaultMetrics() {
    // Collect default metrics
    this.defaultMetrics({
      register: this.register,
      prefix: this.prefix,
      gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5],
      eventLoopMonitoringPrecision: 5
    });
  }

  /**
   * Setup custom application metrics
   */
  setupCustomMetrics() {
    // HTTP Request metrics
    this.httpRequestDuration = new client.Histogram({
      name: `${this.prefix}http_request_duration_seconds`,
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30]
    });

    this.httpRequestsTotal = new client.Counter({
      name: `${this.prefix}http_requests_total`,
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code']
    });

    // Worker Task metrics
    this.workerTasksActive = new client.Gauge({
      name: `${this.prefix}worker_tasks_active`,
      help: 'Number of currently active worker tasks'
    });

    this.workerTasksProcessed = new client.Counter({
      name: `${this.prefix}worker_tasks_processed_total`,
      help: 'Total number of processed worker tasks',
      labelNames: ['task_type', 'status']
    });

    this.workerTaskDuration = new client.Histogram({
      name: `${this.prefix}worker_task_duration_seconds`,
      help: 'Duration of worker task execution in seconds',
      labelNames: ['task_type'],
      buckets: [1, 5, 10, 30, 60, 300, 900]
    });

    // Camunda metrics
    this.camundaTasksReceived = new client.Counter({
      name: `${this.prefix}camunda_tasks_received_total`,
      help: 'Total number of Camunda tasks received',
      labelNames: ['topic']
    });

    this.camundaTasksCompleted = new client.Counter({
      name: `${this.prefix}camunda_tasks_completed_total`,
      help: 'Total number of Camunda tasks completed',
      labelNames: ['topic', 'status']
    });

    this.camundaTaskDuration = new client.Histogram({
      name: `${this.prefix}camunda_task_duration_seconds`,
      help: 'Duration of Camunda task processing in seconds',
      labelNames: ['topic'],
      buckets: [1, 5, 15, 30, 60, 300, 900, 1800]
    });

    // Database metrics
    this.databaseQueriesTotal = new client.Counter({
      name: `${this.prefix}database_queries_total`,
      help: 'Total number of database queries',
      labelNames: ['operation', 'status']
    });

    this.databaseQueryDuration = new client.Histogram({
      name: `${this.prefix}database_query_duration_seconds`,
      help: 'Duration of database queries in seconds',
      labelNames: ['operation'],
      buckets: [0.01, 0.1, 0.5, 1, 2, 5, 10]
    });

    this.databaseConnectionsActive = new client.Gauge({
      name: `${this.prefix}database_connections_active`,
      help: 'Number of active database connections'
    });

    // External API metrics
    this.externalApiCallsTotal = new client.Counter({
      name: `${this.prefix}external_api_calls_total`,
      help: 'Total number of external API calls',
      labelNames: ['service', 'method', 'status_code']
    });

    this.externalApiCallDuration = new client.Histogram({
      name: `${this.prefix}external_api_call_duration_seconds`,
      help: 'Duration of external API calls in seconds',
      labelNames: ['service', 'method'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30]
    });

    // Error metrics
    this.errorsTotal = new client.Counter({
      name: `${this.prefix}errors_total`,
      help: 'Total number of errors',
      labelNames: ['type', 'component']
    });

    // Circuit Breaker metrics
    this.circuitBreakerState = new client.Gauge({
      name: `${this.prefix}circuit_breaker_state`,
      help: 'Circuit breaker state (0=closed, 1=open, 2=half-open)',
      labelNames: ['service']
    });

    this.circuitBreakerFailures = new client.Counter({
      name: `${this.prefix}circuit_breaker_failures_total`,
      help: 'Total number of circuit breaker failures',
      labelNames: ['service']
    });

    // Business metrics
    this.businessEventsTotal = new client.Counter({
      name: `${this.prefix}business_events_total`,
      help: 'Total number of business events',
      labelNames: ['event_type']
    });

    // Memory and resource metrics
    this.memoryUsage = new client.Gauge({
      name: `${this.prefix}memory_usage_bytes`,
      help: 'Memory usage in bytes',
      labelNames: ['type']
    });

    // WebSocket metrics
    this.websocketConnectionsActive = new client.Gauge({
      name: `${this.prefix}websocket_connections_active`,
      help: 'Number of active WebSocket connections'
    });

    this.websocketMessagesTotal = new client.Counter({
      name: `${this.prefix}websocket_messages_total`,
      help: 'Total number of WebSocket messages',
      labelNames: ['direction', 'type']
    });

    // RabbitMQ metrics
    this.rabbitmqMessagesPublished = new client.Counter({
      name: `${this.prefix}rabbitmq_messages_published_total`,
      help: 'Total number of RabbitMQ messages published',
      labelNames: ['queue_type', 'status']
    });

    this.rabbitmqMessagesProcessed = new client.Counter({
      name: `${this.prefix}rabbitmq_messages_processed_total`,
      help: 'Total number of RabbitMQ messages processed',
      labelNames: ['queue_type', 'status']
    });

    this.rabbitmqConnectionStatus = new client.Gauge({
      name: `${this.prefix}rabbitmq_connection_status`,
      help: 'RabbitMQ connection status (1 = connected, 0 = disconnected)'
    });

    this.rabbitmqActiveChannels = new client.Gauge({
      name: `${this.prefix}rabbitmq_active_channels`,
      help: 'Number of active RabbitMQ channels'
    });

    this.rabbitmqQueueDepth = new client.Gauge({
      name: `${this.prefix}rabbitmq_queue_depth`,
      help: 'Number of messages in RabbitMQ queues',
      labelNames: ['queue_name']
    });

    // Application lifecycle metrics
    this.applicationStartTime = new client.Gauge({
      name: `${this.prefix}application_start_time_seconds`,
      help: 'Application start time in Unix timestamp'
    });

    this.applicationInfo = new client.Gauge({
      name: `${this.prefix}application_info`,
      help: 'Application information',
      labelNames: ['version', 'environment', 'node_version']
    });

    // Register all custom metrics
    this.register.registerMetric(this.httpRequestDuration);
    this.register.registerMetric(this.httpRequestsTotal);
    this.register.registerMetric(this.workerTasksActive);
    this.register.registerMetric(this.workerTasksProcessed);
    this.register.registerMetric(this.workerTaskDuration);
    this.register.registerMetric(this.camundaTasksReceived);
    this.register.registerMetric(this.camundaTasksCompleted);
    this.register.registerMetric(this.camundaTaskDuration);
    this.register.registerMetric(this.databaseQueriesTotal);
    this.register.registerMetric(this.databaseQueryDuration);
    this.register.registerMetric(this.databaseConnectionsActive);
    this.register.registerMetric(this.externalApiCallsTotal);
    this.register.registerMetric(this.externalApiCallDuration);
    this.register.registerMetric(this.errorsTotal);
    this.register.registerMetric(this.circuitBreakerState);
    this.register.registerMetric(this.circuitBreakerFailures);
    this.register.registerMetric(this.businessEventsTotal);
    this.register.registerMetric(this.memoryUsage);
    this.register.registerMetric(this.websocketConnectionsActive);
    this.register.registerMetric(this.websocketMessagesTotal);
    this.register.registerMetric(this.rabbitmqMessagesPublished);
    this.register.registerMetric(this.rabbitmqMessagesProcessed);
    this.register.registerMetric(this.rabbitmqConnectionStatus);
    this.register.registerMetric(this.rabbitmqActiveChannels);
    this.register.registerMetric(this.rabbitmqQueueDepth);
    this.register.registerMetric(this.applicationStartTime);
    this.register.registerMetric(this.applicationInfo);

    // Set initial values
    this.applicationStartTime.set(Date.now() / 1000);
    this.applicationInfo.set({
      version: config.get('app.version'),
      environment: config.get('app.env'),
      node_version: process.version
    }, 1);
  }

  /**
   * Setup event listeners for automatic metrics collection
   */
  setupEventListeners() {
    // Update memory metrics periodically
    setInterval(() => {
      const memUsage = process.memoryUsage();
      this.memoryUsage.set({ type: 'rss' }, memUsage.rss);
      this.memoryUsage.set({ type: 'heap_used' }, memUsage.heapUsed);
      this.memoryUsage.set({ type: 'heap_total' }, memUsage.heapTotal);
      this.memoryUsage.set({ type: 'external' }, memUsage.external);
    }, 15000);
  }

  /**
   * HTTP Request metrics recording
   */
  recordHttpRequest(method, route, statusCode, duration) {
    this.httpRequestsTotal.inc({ method, route, status_code: statusCode });
    this.httpRequestDuration.observe({ method, route, status_code: statusCode }, duration / 1000);
  }

  /**
   * Worker task metrics recording
   */
  recordWorkerTaskStart() {
    this.workerTasksActive.inc();
  }

  recordWorkerTaskEnd(taskType, status, duration) {
    this.workerTasksActive.dec();
    this.workerTasksProcessed.inc({ task_type: taskType, status });
    this.workerTaskDuration.observe({ task_type: taskType }, duration / 1000);
  }

  /**
   * Camunda task metrics recording
   */
  recordCamundaTaskReceived(topic) {
    this.camundaTasksReceived.inc({ topic });
  }

  recordCamundaTaskCompleted(topic, status, duration) {
    this.camundaTasksCompleted.inc({ topic, status });
    this.camundaTaskDuration.observe({ topic }, duration / 1000);
  }

  /**
   * Database metrics recording
   */
  recordDatabaseQuery(operation, status, duration) {
    this.databaseQueriesTotal.inc({ operation, status });
    this.databaseQueryDuration.observe({ operation }, duration / 1000);
  }

  updateDatabaseConnections(count) {
    this.databaseConnectionsActive.set(count);
  }

  /**
   * External API metrics recording
   */
  recordExternalApiCall(service, method, statusCode, duration) {
    this.externalApiCallsTotal.inc({ service, method, status_code: statusCode });
    this.externalApiCallDuration.observe({ service, method }, duration / 1000);
  }

  /**
   * Error metrics recording
   */
  recordError(type, component) {
    this.errorsTotal.inc({ type, component });
  }

  /**
   * Circuit Breaker metrics recording
   */
  updateCircuitBreakerState(service, state) {
    const stateValue = state === 'CLOSED' ? 0 : state === 'OPEN' ? 1 : 2;
    this.circuitBreakerState.set({ service }, stateValue);
  }

  recordCircuitBreakerFailure(service) {
    this.circuitBreakerFailures.inc({ service });
  }

  /**
   * Business event metrics recording
   */
  recordBusinessEvent(eventType) {
    this.businessEventsTotal.inc({ event_type: eventType });
  }

  /**
   * WebSocket metrics recording
   */
  updateWebSocketConnections(count) {
    this.websocketConnectionsActive.set(count);
  }

  recordWebSocketMessage(direction, type) {
    this.websocketMessagesTotal.inc({ direction, type });
  }

  /**
   * Get metrics in Prometheus format
   */
  async getMetrics() {
    return this.register.metrics();
  }

  /**
   * Get specific metric by name
   */
  getMetric(name) {
    return this.register.getSingleMetric(name);
  }

  /**
   * Clear all metrics
   */
  clear() {
    this.register.clear();
  }

  /**
   * Create a timer for measuring duration
   */
  createTimer(metricName, labels = {}) {
    const startTime = Date.now();
    
    return {
      end: () => {
        const duration = Date.now() - startTime;
        const metric = this.getMetric(metricName);
        if (metric && typeof metric.observe === 'function') {
          metric.observe(labels, duration / 1000);
        }
        return duration;
      }
    };
  }

  /**
   * Middleware for Fastify to automatically collect HTTP metrics
   */
  getFastifyMiddleware() {
    return (request, reply, done) => {
      const startTime = Date.now();
      
      reply.addHook('onSend', (request, reply, payload, done) => {
        const duration = Date.now() - startTime;
        const route = request.routerPath || request.url;
        
        this.recordHttpRequest(
          request.method,
          route,
          reply.statusCode,
          duration
        );
        
        done();
      });
      
      done();
    };
  }
}

// Export singleton instance
const metricsCollector = new MetricsCollector();

/**
 * Middleware decorator for automatic metrics collection
 */
function withMetrics(metricType, labels = {}) {
  return function(target, propertyKey, descriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function(...args) {
      const startTime = Date.now();
      let status = 'success';
      
      try {
        const result = await originalMethod.apply(this, args);
        return result;
      } catch (error) {
        status = 'error';
        metricsCollector.recordError(error.constructor.name, metricType);
        throw error;
      } finally {
        const duration = Date.now() - startTime;
        
        switch (metricType) {
          case 'worker':
            metricsCollector.recordWorkerTaskEnd(propertyKey, status, duration);
            break;
          case 'database':
            metricsCollector.recordDatabaseQuery(propertyKey, status, duration);
            break;
          case 'external-api':
            metricsCollector.recordExternalApiCall(labels.service, labels.method, status, duration);
            break;
        }
      }
    };

    return descriptor;
  };
}

module.exports = {
  metricsCollector,
  withMetrics
};