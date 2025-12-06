const rabbitMQConnection = require('./connection');
const messageProducer = require('./producer');
const { MessageConsumer, DefaultHandlers } = require('./consumer');
const config = require('../../config');
const logger = require('../logger');
const { gracefulShutdown } = require('../gracefulShutdown');

/**
 * RabbitMQ Queue Manager
 * High-level interface for queue operations
 */
class QueueManager {
  constructor() {
    this.connection = rabbitMQConnection;
    this.producer = messageProducer;
    this.consumer = new MessageConsumer();
    this.initialized = false;
  }

  /**
   * Initialize RabbitMQ system
   */
  async initialize() {
    if (this.initialized) {
      logger.warn('QueueManager already initialized');
      return;
    }

    try {
      logger.info('Initializing RabbitMQ system');

      // Connect to RabbitMQ
      await this.connection.connect();

      // Register default handlers
      this.registerDefaultHandlers();

      // Start consumers
      await this.consumer.start();

      // Register graceful shutdown
      this.registerGracefulShutdown();

      this.initialized = true;
      
      logger.info('RabbitMQ system initialized successfully', {
        queues: Object.keys(config.get('rabbitmq.queues')),
        component: 'queue-manager'
      });

    } catch (error) {
      logger.error('Failed to initialize RabbitMQ system', error);
      
      // In development, don't fail if RabbitMQ is not available
      if (config.isDevelopment()) {
        logger.warn('RabbitMQ not available in development mode, continuing without queue functionality');
        return;
      }
      
      throw error;
    }
  }

  /**
   * Register default message handlers
   */
  registerDefaultHandlers() {
    this.consumer.registerHandler('notifications', DefaultHandlers.handleNotification, {
      concurrency: 5,
      prefetch: 10
    });

    this.consumer.registerHandler('processing', DefaultHandlers.handleProcessing, {
      concurrency: 3,
      prefetch: 5
    });

    this.consumer.registerHandler('default', DefaultHandlers.handleDefault, {
      concurrency: 2,
      prefetch: 5
    });

    logger.info('Default message handlers registered');
  }

  /**
   * Register graceful shutdown handlers
   */
  registerGracefulShutdown() {
    gracefulShutdown.registerResource('rabbitmq-consumer', async () => {
      logger.info('Stopping RabbitMQ consumers');
      await this.consumer.stop();
    }, 8);

    gracefulShutdown.registerResource('rabbitmq-connection', async () => {
      logger.info('Closing RabbitMQ connection');
      await this.connection.close();
    }, 5);
  }

  /**
   * Publish message to queue
   */
  async publish(queueType, message, options = {}) {
    if (!this.initialized) {
      throw new Error('QueueManager not initialized');
    }
    return this.producer.publish(queueType, message, options);
  }

  /**
   * Publish notification
   */
  async sendNotification(notification) {
    return this.producer.publishNotification(notification);
  }

  /**
   * Queue processing job
   */
  async queueJob(job) {
    return this.producer.publishProcessingJob(job);
  }

  /**
   * Register custom handler
   */
  registerHandler(queueType, handler, options = {}) {
    this.consumer.registerHandler(queueType, handler, options);
  }

  /**
   * Get system statistics
   */
  getStats() {
    return {
      initialized: this.initialized,
      connection: this.connection.getStats(),
      producer: this.producer.getStats(),
      consumer: this.consumer.getStats()
    };
  }

  /**
   * Health check for RabbitMQ
   */
  async healthCheck() {
    try {
      if (!this.initialized) {
        return {
          status: 'unhealthy',
          message: 'QueueManager not initialized'
        };
      }

      if (!this.connection.isReady()) {
        return {
          status: 'unhealthy',
          message: 'RabbitMQ connection not ready'
        };
      }

      // Test basic operation
      const testChannel = await this.connection.getChannel('health-check');
      await testChannel.checkQueue(config.get('rabbitmq.queues.default'));
      await testChannel.close();

      return {
        status: 'healthy',
        message: 'RabbitMQ is operational',
        stats: this.getStats()
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        message: `RabbitMQ health check failed: ${error.message}`
      };
    }
  }
}

// Export singleton instance
const queueManager = new QueueManager();

module.exports = {
  queueManager,
  QueueManager,
  rabbitMQConnection,
  messageProducer,
  MessageConsumer,
  DefaultHandlers
};