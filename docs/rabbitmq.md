# RabbitMQ Implementation - Bandung Backend

## Overview

RabbitMQ messaging queue telah diintegrasikan ke dalam Bandung Backend untuk menangani:
- **Asynchronous processing**: Background jobs yang tidak memerlukan response langsung
- **Notification delivery**: Email, SMS, push notifications
- **Task scheduling**: Delayed jobs dan batch processing
- **System decoupling**: Memisahkan producer dan consumer untuk scalability

## Architecture

### Components
1. **Connection Manager** (`src/utils/rabbitmq/connection.js`)
   - Handles RabbitMQ connection lifecycle
   - Auto-reconnection with exponential backoff
   - Channel management with prefetch settings

2. **Message Producer** (`src/utils/rabbitmq/producer.js`)
   - Publishes messages to exchanges/queues
   - Supports priority, delay, and batch operations
   - Automatic message ID generation and metadata

3. **Message Consumer** (`src/utils/rabbitmq/consumer.js`)
   - Processes messages with error handling
   - Retry logic and dead letter queue support
   - Concurrent processing with configurable workers

4. **Queue Manager** (`src/utils/rabbitmq/index.js`)
   - High-level interface for queue operations
   - Built-in handlers for common use cases
   - Health checks and graceful shutdown

### Queue Types
- **default**: General purpose messages
- **notifications**: Email, SMS, push notifications
- **processing**: Background jobs (reports, exports, cleanup)
- **dead_letter**: Failed messages after retry exhaustion

## Configuration

### Environment Variables
```bash
# RabbitMQ Connection
RABBITMQ_URL=amqp://localhost:5672
RABBITMQ_EXCHANGE=bandung_backend_exchange

# Queue Names
RABBITMQ_QUEUE_DEFAULT=default_queue
RABBITMQ_QUEUE_NOTIFICATIONS=notifications_queue
RABBITMQ_QUEUE_PROCESSING=processing_queue
RABBITMQ_QUEUE_DLQ=dead_letter_queue

# Consumer Options
RABBITMQ_PREFETCH=10
RABBITMQ_RETRY_ATTEMPTS=3
RABBITMQ_RETRY_DELAY=5000
RABBITMQ_HEARTBEAT=60
```

### Docker Compose (Local Development)
```yaml
version: '3.8'
services:
  rabbitmq:
    image: rabbitmq:3.12-management
    hostname: rabbitmq
    ports:
      - "5672:5672"     # AMQP port
      - "15672:15672"   # Management UI
    environment:
      RABBITMQ_DEFAULT_USER: admin
      RABBITMQ_DEFAULT_PASS: admin123
    volumes:
      - rabbitmq_data:/var/lib/rabbitmq

volumes:
  rabbitmq_data:
```

## API Endpoints

### Queue Management
- `GET /api/queue/status` - Get queue status and statistics
- `GET /api/queue/metrics` - Get Prometheus metrics (authenticated)

### Message Publishing
- `POST /api/queue/test/publish` - Send test message
- `POST /api/queue/notification` - Queue notification
- `POST /api/queue/job` - Queue processing job
- `POST /api/queue/bulk` - Bulk message publishing

### Example Requests

#### Send Test Message
```bash
curl -X POST http://localhost:8010/api/queue/test/publish \\
  -H "Content-Type: application/json" \\
  -d '{
    "queueType": "default",
    "message": {
      "title": "Test Message",
      "body": "Hello RabbitMQ!"
    },
    "priority": 5
  }'
```

#### Queue Notification
```bash
curl -X POST http://localhost:8010/api/queue/notification \\
  -H "Content-Type: application/json" \\
  -d '{
    "type": "push",
    "recipient": "user123",
    "title": "Welcome!",
    "message": "Welcome to Bandung Backend"
  }'
```

#### Queue Processing Job
```bash
curl -X POST http://localhost:8010/api/queue/job \\
  -H "Content-Type: application/json" \\
  -d '{
    "jobType": "report_generation",
    "data": {
      "reportType": "monthly",
      "month": "2025-12"
    },
    "priority": 3
  }'
```

## Programmatic Usage

### Publishing Messages
```javascript
const { queueManager } = require('./src/utils/rabbitmq');

// Send notification
await queueManager.sendNotification({
  type: 'email',
  recipient: 'user@example.com',
  title: 'Hello',
  message: 'Your report is ready'
});

// Queue processing job
await queueManager.queueJob({
  jobType: 'data_export',
  data: { userId: 123, format: 'csv' }
});

// Direct queue publish
await queueManager.publish('default', {
  action: 'process_data',
  payload: { id: 456 }
}, {
  priority: 8,
  delay: 30000 // 30 seconds delay
});
```

### Custom Message Handlers
```javascript
const { MessageConsumer } = require('./src/utils/rabbitmq');

const consumer = new MessageConsumer();

// Register custom handler
consumer.registerHandler('custom', async (payload, context) => {
  console.log('Processing custom message:', payload);
  console.log('Message ID:', context.messageId);
  
  // Process the message
  await processCustomData(payload);
  
  // Return success (message will be acked)
  return { processed: true };
}, {
  concurrency: 5,
  prefetch: 10
});
```

## Monitoring

### Health Checks
RabbitMQ status is included in:
- `/health` - Overall health check
- `/health/readiness` - Readiness probe

### Metrics (Prometheus)
- `rabbitmq_messages_published_total` - Published message count by queue
- `rabbitmq_messages_processed_total` - Processed message count by queue  
- `rabbitmq_connection_status` - Connection status (1=connected, 0=disconnected)
- `rabbitmq_active_channels` - Number of active channels
- `rabbitmq_queue_depth` - Messages in queues

### Management UI
Access RabbitMQ management interface at http://localhost:15672
- Username: `admin`
- Password: `admin123`

## Error Handling

### Retry Logic
- Failed messages are retried up to `RABBITMQ_RETRY_ATTEMPTS` times
- Exponential backoff delay between retries
- After exhausting retries, messages go to dead letter queue

### Dead Letter Queue
- Failed messages are routed to `dead_letter_queue`
- Manual inspection and reprocessing available
- Prevents message loss and system blocking

### Circuit Breaker
```javascript
// Automatic failure detection
if (consecutiveFailures > threshold) {
  // Stop processing and alert
  logger.error('RabbitMQ circuit breaker opened');
}
```

## Production Deployment

### RabbitMQ Cluster
For production, deploy RabbitMQ cluster with:
- Multiple nodes for high availability
- Persistent storage for durability
- SSL/TLS encryption
- Memory and disk monitoring

### Scaling
- **Horizontal**: Add more consumer instances
- **Vertical**: Increase prefetch and concurrency
- **Queue partitioning**: Split by queue type or geography

### Best Practices
1. **Message Design**: Keep messages small and include only necessary data
2. **Idempotency**: Ensure message handlers can be safely retried
3. **Monitoring**: Set up alerts for queue depth and processing errors
4. **Backup**: Regular backup of RabbitMQ data and configuration

## Troubleshooting

### Common Issues
1. **Connection refused**: Check RabbitMQ service status
2. **Queue not found**: Verify queue configuration and setup
3. **Messages stuck**: Check consumer errors and dead letter queue
4. **Memory issues**: Monitor queue depth and consumer performance

### Debug Mode
Enable debug logging:
```bash
LOG_LEVEL=debug npm start
```

### Queue Inspection
```bash
# List queues
rabbitmqctl list_queues

# Purge queue (development only)
rabbitmqctl purge_queue notifications_queue
```