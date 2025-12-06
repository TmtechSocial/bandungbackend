const amqp = require('amqplib');
const config = require('../../config');
const logger = require('../logger');

/**
 * RabbitMQ Connection Manager
 * Handles connection, reconnection, and channel management
 */
class RabbitMQConnection {
  constructor() {
    this.connection = null;
    this.channels = new Map();
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 5000;
    this.exchangeName = config.get('rabbitmq.exchangeName');
    this.queues = config.get('rabbitmq.queues');
  }

  /**
   * Initialize RabbitMQ connection
   */
  async connect() {
    try {
      const rabbitmqUrl = config.get('rabbitmq.url');
      
      if (!rabbitmqUrl) {
        throw new Error('RabbitMQ URL not configured');
      }

      logger.info('Connecting to RabbitMQ', { url: rabbitmqUrl.replace(/\/\/.*@/, '//***@') });
      
      this.connection = await amqp.connect(rabbitmqUrl, {
        heartbeat: config.get('rabbitmq.options.heartbeat')
      });

      this.connection.on('error', this.handleConnectionError.bind(this));
      this.connection.on('close', this.handleConnectionClose.bind(this));

      // Setup exchange and queues
      await this.setupExchangeAndQueues();
      
      this.isConnected = true;
      this.reconnectAttempts = 0;
      
      logger.info('RabbitMQ connected successfully', { 
        exchange: this.exchangeName,
        queues: Object.keys(this.queues)
      });

      return this.connection;
    } catch (error) {
      logger.error('Failed to connect to RabbitMQ', error);
      await this.handleReconnect();
      throw error;
    }
  }

  /**
   * Setup exchange and queues
   */
  async setupExchangeAndQueues() {
    const channel = await this.getChannel('setup');

    // Create exchange
    await channel.assertExchange(this.exchangeName, 'topic', {
      durable: true,
      autoDelete: false
    });

    // Create queues
    for (const [queueKey, queueName] of Object.entries(this.queues)) {
      const queueOptions = {
        durable: true,
        exclusive: false,
        autoDelete: false
      };

      // Setup dead letter queue for main queues
      if (queueKey !== 'deadLetter') {
        queueOptions.arguments = {
          'x-dead-letter-exchange': this.exchangeName,
          'x-dead-letter-routing-key': `dlq.${queueKey}`,
          'x-message-ttl': 300000 // 5 minutes
        };
      }

      await channel.assertQueue(queueName, queueOptions);
      
      // Bind queue to exchange
      const routingKey = queueKey === 'deadLetter' ? 'dlq.*' : `queue.${queueKey}`;
      await channel.bindQueue(queueName, this.exchangeName, routingKey);
      
      logger.debug('Queue setup completed', { queue: queueName, routingKey });
    }

    await channel.close();
  }

  /**
   * Get or create a channel
   */
  async getChannel(channelId = 'default') {
    if (!this.isConnected || !this.connection) {
      throw new Error('RabbitMQ not connected');
    }

    if (this.channels.has(channelId)) {
      const channel = this.channels.get(channelId);
      if (!channel.connection.destroyed) {
        return channel;
      }
      this.channels.delete(channelId);
    }

    const channel = await this.connection.createChannel();
    
    // Set prefetch for fair dispatching
    await channel.prefetch(config.get('rabbitmq.options.prefetch'));
    
    channel.on('error', (error) => {
      logger.error('RabbitMQ channel error', { channelId, error: error.message });
      this.channels.delete(channelId);
    });

    channel.on('close', () => {
      logger.debug('RabbitMQ channel closed', { channelId });
      this.channels.delete(channelId);
    });

    this.channels.set(channelId, channel);
    return channel;
  }

  /**
   * Handle connection errors
   */
  handleConnectionError(error) {
    logger.error('RabbitMQ connection error', error);
    this.isConnected = false;
  }

  /**
   * Handle connection close
   */
  async handleConnectionClose() {
    logger.warn('RabbitMQ connection closed');
    this.isConnected = false;
    this.channels.clear();
    await this.handleReconnect();
  }

  /**
   * Handle reconnection logic
   */
  async handleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    logger.info('Attempting to reconnect to RabbitMQ', { 
      attempt: this.reconnectAttempts, 
      delay 
    });

    setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        logger.error('Reconnection failed', error);
      }
    }, delay);
  }

  /**
   * Close connection gracefully
   */
  async close() {
    if (this.connection) {
      logger.info('Closing RabbitMQ connection');
      
      // Close all channels first
      for (const [channelId, channel] of this.channels) {
        try {
          await channel.close();
        } catch (error) {
          logger.warn('Error closing channel', { channelId, error: error.message });
        }
      }
      
      this.channels.clear();
      
      // Close connection
      await this.connection.close();
      this.connection = null;
      this.isConnected = false;
      
      logger.info('RabbitMQ connection closed');
    }
  }

  /**
   * Check if connected
   */
  isReady() {
    return this.isConnected && this.connection && !this.connection.destroyed;
  }

  /**
   * Get connection statistics
   */
  getStats() {
    return {
      connected: this.isConnected,
      channels: this.channels.size,
      reconnectAttempts: this.reconnectAttempts
    };
  }
}

// Export singleton instance
const rabbitMQConnection = new RabbitMQConnection();
module.exports = rabbitMQConnection;