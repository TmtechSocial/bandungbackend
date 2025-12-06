const config = require('../../config');
const logger = require('../logger');
const rabbitMQConnection = require('./connection');
const { metricsCollector } = require('../metrics');

/**
 * RabbitMQ Message Consumer/Worker
 * Handles message consumption with error handling, retries, and dead letter queues
 */
class MessageConsumer {
  constructor() {
    this.consumers = new Map();
    this.isRunning = false;
    this.retryAttempts = config.get('rabbitmq.options.retryAttempts');
    this.retryDelay = config.get('rabbitmq.options.retryDelay');
  }

  /**
   * Register message handler for a queue type
   */
  registerHandler(queueType, handler, options = {}) {
    if (typeof handler !== 'function') {
      throw new Error('Handler must be a function');
    }

    this.consumers.set(queueType, {
      handler,
      options: {
        concurrency: options.concurrency || 1,
        autoAck: options.autoAck || false,
        prefetch: options.prefetch || config.get('rabbitmq.options.prefetch'),
        ...options
      }
    });

    logger.info('Message handler registered', {
      queueType,
      concurrency: options.concurrency || 1,
      component: 'rabbitmq-consumer'
    });
  }

  /**
   * Start consuming messages
   */
  async start() {
    if (this.isRunning) {
      logger.warn('Consumer already running');
      return;
    }

    try {
      if (!rabbitMQConnection.isReady()) {
        throw new Error('RabbitMQ not connected');
      }

      this.isRunning = true;
      
      // Start consumers for each registered handler
      for (const [queueType, consumer] of this.consumers) {
        await this.startQueueConsumer(queueType, consumer);
      }

      logger.info('RabbitMQ consumers started', {
        queues: Array.from(this.consumers.keys()),
        component: 'rabbitmq-consumer'
      });

    } catch (error) {
      logger.error('Failed to start consumers', error);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Start consumer for specific queue
   */
  async startQueueConsumer(queueType, consumer) {
    const queues = config.get('rabbitmq.queues');
    const queueName = queues[queueType];
    
    if (!queueName) {
      throw new Error(`Queue not configured for type: ${queueType}`);
    }

    // Create dedicated channel for this consumer
    const channel = await rabbitMQConnection.getChannel(`consumer-${queueType}`);
    
    // Set prefetch for this consumer
    await channel.prefetch(consumer.options.prefetch);

    // Start consuming
    await channel.consume(queueName, async (message) => {
      if (!message) return;

      const startTime = Date.now();
      let messageData = null;
      
      try {
        // Parse message
        messageData = JSON.parse(message.content.toString());
        
        logger.debug('Processing message', {
          messageId: messageData.id,
          queueType,
          component: 'rabbitmq-consumer'
        });

        // Record active job metric
        metricsCollector.recordWorkerTaskStart();

        // Process message with handler
        const result = await this.processMessage(messageData, consumer.handler, message);
        
        // Acknowledge message
        if (!consumer.options.autoAck) {
          channel.ack(message);
        }

        const duration = Date.now() - startTime;
        
        logger.info('Message processed successfully', {
          messageId: messageData.id,
          queueType,
          duration: `${duration}ms`,
          component: 'rabbitmq-consumer'
        });

        // Record success metrics
        metricsCollector.recordWorkerTaskEnd(queueType, 'success', duration);
        metricsCollector.recordBusinessEvent('rabbitmq_message_processed', {
          queue_type: queueType,
          status: 'success'
        });

      } catch (error) {
        const duration = Date.now() - startTime;
        
        logger.error('Message processing failed', {
          messageId: messageData?.id,
          queueType,
          error: error.message,
          duration: `${duration}ms`,
          component: 'rabbitmq-consumer'
        });

        // Handle message retry/rejection
        await this.handleMessageError(channel, message, error, queueType);
        
        // Record failure metrics
        metricsCollector.recordWorkerTaskEnd(queueType, 'failed', duration);
        metricsCollector.recordBusinessEvent('rabbitmq_message_processed', {
          queue_type: queueType,
          status: 'failed'
        });
        metricsCollector.recordError('RabbitMQProcessingError', 'rabbitmq');
      }
    }, {
      noAck: consumer.options.autoAck
    });

    logger.info('Consumer started for queue', {
      queueType,
      queueName,
      prefetch: consumer.options.prefetch,
      component: 'rabbitmq-consumer'
    });
  }

  /**
   * Process individual message
   */
  async processMessage(messageData, handler, originalMessage) {
    const context = {
      messageId: messageData.id,
      timestamp: messageData.timestamp,
      type: messageData.type,
      metadata: messageData.metadata,
      headers: originalMessage.properties.headers || {},
      correlationId: originalMessage.properties.correlationId,
      replyTo: originalMessage.properties.replyTo
    };

    // Execute handler with timeout
    const handlerTimeout = 30000; // 30 seconds
    
    return Promise.race([
      handler(messageData.payload, context),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Handler timeout')), handlerTimeout)
      )
    ]);
  }

  /**
   * Handle message processing errors
   */
  async handleMessageError(channel, message, error, queueType) {
    const headers = message.properties.headers || {};
    const retryCount = headers['x-retry-count'] || 0;

    if (retryCount < this.retryAttempts) {
      // Retry message
      logger.warn('Retrying message', {
        messageId: message.properties.messageId,
        queueType,
        retryCount: retryCount + 1,
        component: 'rabbitmq-consumer'
      });

      // Reject with requeue
      channel.reject(message, true);
      
    } else {
      // Send to dead letter queue
      logger.error('Message exhausted retries, sending to DLQ', {
        messageId: message.properties.messageId,
        queueType,
        retryCount,
        error: error.message,
        component: 'rabbitmq-consumer'
      });

      // Reject without requeue (goes to DLQ)
      channel.reject(message, false);
    }
  }

  /**
   * Stop all consumers
   */
  async stop() {
    if (!this.isRunning) return;

    logger.info('Stopping RabbitMQ consumers');
    this.isRunning = false;

    // Close all consumer channels
    for (const queueType of this.consumers.keys()) {
      try {
        const channel = rabbitMQConnection.channels.get(`consumer-${queueType}`);
        if (channel) {
          await channel.close();
        }
      } catch (error) {
        logger.warn('Error closing consumer channel', {
          queueType,
          error: error.message
        });
      }
    }

    logger.info('RabbitMQ consumers stopped');
  }

  /**
   * Get consumer statistics
   */
  getStats() {
    return {
      running: this.isRunning,
      consumers: Array.from(this.consumers.keys()),
      connected: rabbitMQConnection.isReady()
    };
  }
}

/**
 * Built-in message handlers
 */
class DefaultHandlers {
  /**
   * Default notification handler
   */
  static async handleNotification(payload, context) {
    logger.info('Processing notification', {
      type: payload.type,
      messageId: context.messageId,
      component: 'notification-handler'
    });

    switch (payload.type) {
      case 'email':
        // Implement email sending logic
        break;
      case 'sms':
        // Implement SMS sending logic
        break;
      case 'push':
        // Use existing FCM implementation
        if (global.sendFcmToClients && payload.fcmData) {
          await global.sendFcmToClients(payload.fcmData);
        }
        break;
      default:
        logger.warn('Unknown notification type', { type: payload.type });
    }
  }

  /**
   * Default processing handler
   */
  static async handleProcessing(payload, context) {
    logger.info('Processing job', {
      jobType: payload.jobType,
      messageId: context.messageId,
      component: 'processing-handler'
    });

    switch (payload.jobType) {
      case 'data_export':
        // Implement data export logic
        await DefaultHandlers.handleDataExport(payload.data);
        break;
      case 'report_generation':
        // Implement report generation logic
        await DefaultHandlers.handleReportGeneration(payload.data);
        break;
      case 'cleanup':
        // Implement cleanup logic
        await DefaultHandlers.handleCleanup(payload.data);
        break;
      default:
        logger.warn('Unknown processing job type', { jobType: payload.jobType });
    }
  }

  /**
   * Handle data export jobs
   */
  static async handleDataExport(data) {
    // Placeholder for data export implementation
    logger.info('Data export job completed', { recordCount: data.recordCount });
  }

  /**
   * Handle report generation jobs  
   */
  static async handleReportGeneration(data) {
    // Placeholder for report generation implementation
    logger.info('Report generation completed', { reportType: data.reportType });
  }

  /**
   * Handle cleanup jobs
   */
  static async handleCleanup(data) {
    // Placeholder for cleanup implementation
    logger.info('Cleanup job completed', { target: data.target });
  }

  /**
   * Default handler for unprocessed messages
   */
  static async handleDefault(payload, context) {
    logger.info('Processing default message', {
      messageId: context.messageId,
      component: 'default-handler'
    });

    // Log message for debugging
    logger.debug('Default message payload', { payload });
  }
}

// Export classes
module.exports = {
  MessageConsumer,
  DefaultHandlers
};