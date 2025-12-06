const { v4: uuidv4 } = require('uuid');
const config = require('../../config');
const logger = require('../logger');
const rabbitMQConnection = require('./connection');
const { metricsCollector } = require('../metrics');

/**
 * RabbitMQ Message Producer
 * Handles message publishing with routing, persistence, and error handling
 */
class MessageProducer {
  constructor() {
    this.exchangeName = config.get('rabbitmq.exchangeName');
    this.defaultOptions = {
      persistent: true,
      mandatory: true,
      timestamp: Date.now(),
      appId: config.get('app.name'),
      contentType: 'application/json',
      contentEncoding: 'utf8'
    };
  }

  /**
   * Publish message to queue
   */
  async publish(queueType, message, options = {}) {
    const startTime = Date.now();
    
    try {
      if (!rabbitMQConnection.isReady()) {
        throw new Error('RabbitMQ not connected');
      }

      const channel = await rabbitMQConnection.getChannel('publisher');
      const queues = config.get('rabbitmq.queues');
      
      if (!queues[queueType]) {
        throw new Error(`Unknown queue type: ${queueType}`);
      }

      const messageId = uuidv4();
      const routingKey = `queue.${queueType}`;
      
      const messageData = {
        id: messageId,
        timestamp: new Date().toISOString(),
        type: queueType,
        payload: message,
        metadata: {
          source: config.get('app.name'),
          version: config.get('app.version'),
          ...options.metadata
        }
      };

      const publishOptions = {
        ...this.defaultOptions,
        messageId,
        correlationId: options.correlationId || messageId,
        replyTo: options.replyTo,
        expiration: options.expiration,
        priority: options.priority || 0,
        headers: {
          'x-retry-count': 0,
          'x-original-queue': queueType,
          ...options.headers
        },
        ...options.amqpOptions
      };

      const messageBuffer = Buffer.from(JSON.stringify(messageData));
      
      const published = channel.publish(
        this.exchangeName,
        routingKey,
        messageBuffer,
        publishOptions
      );

      if (!published) {
        throw new Error('Message could not be published (channel full)');
      }

      const duration = Date.now() - startTime;
      
      logger.info('Message published successfully', {
        messageId,
        queueType,
        routingKey,
        size: messageBuffer.length,
        duration: `${duration}ms`,
        component: 'rabbitmq-producer'
      });

      // Record metrics
      metricsCollector.recordBusinessEvent('rabbitmq_message_published', {
        queue_type: queueType,
        status: 'success'
      });

      return {
        messageId,
        queueType,
        published: true,
        timestamp: messageData.timestamp
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      
      logger.error('Failed to publish message', {
        queueType,
        error: error.message,
        duration: `${duration}ms`,
        component: 'rabbitmq-producer'
      });

      // Record error metrics
      metricsCollector.recordError('RabbitMQPublishError', 'rabbitmq');
      metricsCollector.recordBusinessEvent('rabbitmq_message_published', {
        queue_type: queueType,
        status: 'failed'
      });

      throw error;
    }
  }

  /**
   * Publish notification message
   */
  async publishNotification(notification, options = {}) {
    return this.publish('notifications', notification, {
      priority: 5,
      ...options
    });
  }

  /**
   * Publish processing job
   */
  async publishProcessingJob(job, options = {}) {
    return this.publish('processing', job, {
      priority: 3,
      expiration: '3600000', // 1 hour
      ...options
    });
  }

  /**
   * Publish to default queue
   */
  async publishDefault(message, options = {}) {
    return this.publish('default', message, options);
  }

  /**
   * Publish with delay (using RabbitMQ delayed message plugin or TTL workaround)
   */
  async publishDelayed(queueType, message, delayMs, options = {}) {
    if (delayMs <= 0) {
      return this.publish(queueType, message, options);
    }

    // Use message TTL + dead letter exchange for delay
    const delayedOptions = {
      ...options,
      expiration: delayMs.toString(),
      headers: {
        ...options.headers,
        'x-delay': delayMs,
        'x-delayed-type': queueType
      }
    };

    // Publish to a temporary delay queue that routes to dead letter after TTL
    return this.publish('delayed', {
      originalQueueType: queueType,
      originalMessage: message,
      delayMs
    }, delayedOptions);
  }

  /**
   * Bulk publish messages
   */
  async publishBatch(messages) {
    const results = [];
    const errors = [];

    for (const msg of messages) {
      try {
        const result = await this.publish(msg.queueType, msg.message, msg.options);
        results.push(result);
      } catch (error) {
        errors.push({
          message: msg,
          error: error.message
        });
      }
    }

    if (errors.length > 0) {
      logger.warn('Some messages failed in batch publish', {
        total: messages.length,
        successful: results.length,
        failed: errors.length,
        component: 'rabbitmq-producer'
      });
    }

    return {
      successful: results,
      failed: errors,
      total: messages.length
    };
  }

  /**
   * Get publisher statistics
   */
  getStats() {
    return {
      connected: rabbitMQConnection.isReady(),
      exchange: this.exchangeName,
      queues: config.get('rabbitmq.queues')
    };
  }
}

// Export singleton instance
const messageProducer = new MessageProducer();
module.exports = messageProducer;