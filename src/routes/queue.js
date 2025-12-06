const { queueManager } = require('../utils/rabbitmq');
const { errorHandler } = require('../utils/errorHandler');
const logger = require('../utils/logger');

/**
 * RabbitMQ Queue Routes
 * API endpoints for testing and managing message queues
 */
async function queueRoutes(fastify, options) {
  
  // Queue status and statistics
  fastify.get('/queue/status', async (request, reply) => {
    try {
      const stats = queueManager.getStats();
      const healthCheck = await queueManager.healthCheck();
      
      return reply.send({
        status: 'success',
        data: {
          health: healthCheck,
          statistics: stats,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      logger.error('Failed to get queue status', error);
      return reply.code(500).send({
        status: 'error',
        message: 'Failed to get queue status',
        error: error.message
      });
    }
  });

  // Send test message to default queue
  fastify.post('/queue/test/publish', {
    schema: {
      body: {
        type: 'object',
        properties: {
          queueType: { type: 'string', enum: ['default', 'notifications', 'processing'] },
          message: { type: 'object' },
          priority: { type: 'number', minimum: 0, maximum: 10 },
          delay: { type: 'number', minimum: 0 }
        },
        required: ['queueType', 'message']
      }
    }
  }, errorHandler.wrapAsync(async (request, reply) => {
    const { queueType, message, priority, delay } = request.body;
    
    logger.info('Publishing test message', { 
      queueType, 
      priority, 
      delay,
      userId: request.user?.id 
    });

    try {
      let result;
      
      if (delay && delay > 0) {
        result = await queueManager.producer.publishDelayed(queueType, message, delay, {
          priority,
          metadata: {
            source: 'api-test',
            userId: request.user?.id
          }
        });
      } else {
        result = await queueManager.publish(queueType, message, {
          priority,
          metadata: {
            source: 'api-test',
            userId: request.user?.id
          }
        });
      }

      return reply.send({
        status: 'success',
        data: result,
        message: 'Message published successfully'
      });

    } catch (error) {
      logger.error('Failed to publish test message', error, { queueType });
      throw error;
    }
  }));

  // Send notification through queue
  fastify.post('/queue/notification', {
    schema: {
      body: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['email', 'sms', 'push'] },
          recipient: { type: 'string' },
          title: { type: 'string' },
          message: { type: 'string' },
          data: { type: 'object' }
        },
        required: ['type', 'recipient', 'message']
      }
    }
  }, errorHandler.wrapAsync(async (request, reply) => {
    const notification = request.body;
    
    logger.info('Queuing notification', { 
      type: notification.type,
      recipient: notification.recipient,
      userId: request.user?.id 
    });

    try {
      const result = await queueManager.sendNotification({
        ...notification,
        metadata: {
          sentBy: request.user?.id,
          sentAt: new Date().toISOString(),
          source: 'api'
        }
      });

      return reply.send({
        status: 'success',
        data: result,
        message: 'Notification queued successfully'
      });

    } catch (error) {
      logger.error('Failed to queue notification', error, { 
        type: notification.type,
        recipient: notification.recipient 
      });
      throw error;
    }
  }));

  // Queue processing job
  fastify.post('/queue/job', {
    schema: {
      body: {
        type: 'object',
        properties: {
          jobType: { 
            type: 'string', 
            enum: ['data_export', 'report_generation', 'cleanup', 'custom'] 
          },
          data: { type: 'object' },
          priority: { type: 'number', minimum: 0, maximum: 10 },
          timeout: { type: 'number', minimum: 1000, maximum: 3600000 }
        },
        required: ['jobType', 'data']
      }
    }
  }, errorHandler.wrapAsync(async (request, reply) => {
    const { jobType, data, priority, timeout } = request.body;
    
    logger.info('Queuing processing job', { 
      jobType, 
      priority,
      userId: request.user?.id 
    });

    try {
      const job = {
        jobType,
        data,
        metadata: {
          createdBy: request.user?.id,
          createdAt: new Date().toISOString(),
          source: 'api'
        }
      };

      const result = await queueManager.queueJob(job, {
        priority,
        expiration: timeout?.toString()
      });

      return reply.send({
        status: 'success',
        data: result,
        message: 'Processing job queued successfully'
      });

    } catch (error) {
      logger.error('Failed to queue processing job', error, { jobType });
      throw error;
    }
  }));

  // Bulk message publishing
  fastify.post('/queue/bulk', {
    schema: {
      body: {
        type: 'object',
        properties: {
          messages: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                queueType: { type: 'string' },
                message: { type: 'object' },
                priority: { type: 'number' }
              },
              required: ['queueType', 'message']
            },
            maxItems: 100
          }
        },
        required: ['messages']
      }
    }
  }, errorHandler.wrapAsync(async (request, reply) => {
    const { messages } = request.body;
    
    logger.info('Publishing bulk messages', { 
      count: messages.length,
      userId: request.user?.id 
    });

    try {
      const bulkMessages = messages.map(msg => ({
        queueType: msg.queueType,
        message: msg.message,
        options: {
          priority: msg.priority || 0,
          metadata: {
            source: 'api-bulk',
            userId: request.user?.id
          }
        }
      }));

      const result = await queueManager.producer.publishBatch(bulkMessages);

      return reply.send({
        status: 'success',
        data: result,
        message: `Bulk publish completed: ${result.successful.length} successful, ${result.failed.length} failed`
      });

    } catch (error) {
      logger.error('Failed to publish bulk messages', error);
      throw error;
    }
  }));

  // Get queue metrics (requires authentication)
  fastify.get('/queue/metrics', { 
    preHandler: fastify.authenticate 
  }, async (request, reply) => {
    try {
      const { metricsCollector } = require('../utils/metrics');
      const metrics = await metricsCollector.getMetrics();
      
      // Filter only RabbitMQ metrics
      const rabbitmqMetrics = metrics
        .split('\\n')
        .filter(line => line.includes('rabbitmq'))
        .join('\\n');

      return reply
        .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
        .send(rabbitmqMetrics);

    } catch (error) {
      logger.error('Failed to get queue metrics', error);
      return reply.code(500).send({
        status: 'error',
        message: 'Failed to get queue metrics'
      });
    }
  });
}

module.exports = queueRoutes;