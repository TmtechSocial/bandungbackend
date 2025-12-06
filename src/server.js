// Enhanced Worker Service with Complete Production Features
const config = require('./config');
const logger = require('./utils/logger');
const { errorHandler } = require('./utils/errorHandler');
const { gracefulShutdown } = require('./utils/gracefulShutdown');
const { healthChecker } = require('./utils/healthCheck');
const { metricsCollector } = require('./utils/metrics');
const { queueManager } = require('./utils/rabbitmq');

// Initialize Fastify with proper configuration
const fastify = require("fastify")({ 
  logger: false, // We use our custom logger
  requestIdHeader: 'x-request-id',
  requestIdLogLabel: 'reqId',
  disableRequestLogging: true // We'll handle this manually
});

// Load configuration and validate environment
logger.lifecycle('Application starting', {
  version: config.get('app.version'),
  environment: config.get('app.env'),
  nodeVersion: process.version
});

// Core imports
const { authenticate } = require("./middleware/authenticate");
const loginRoutes = require("./routes/login");
const protectedRoutes = require("./routes/routesConfig");
const fastifyMultipart = require("@fastify/multipart");
const fastifyCors = require("@fastify/cors");
const cookie = require("@fastify/cookie");
const cron = require("node-cron");
const http = require("http");

// WebSocket imports
const {
  initializeWebSocketServer,
} = require("./utils/websocket/websocketServer");
const WebSocketManager = require("./utils/websocket/websocketManager");

// Firebase Admin SDK
let admin;
try {
  admin = require("firebase-admin");
  const serviceAccountPath = config.get('firebase.serviceAccountPath');
  const serviceAccount = require(serviceAccountPath);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  
  logger.info('Firebase Admin SDK initialized successfully');
} catch (error) {
  logger.error('Failed to initialize Firebase Admin SDK', error);
}

// Import FCM utilities
const { sendFcmToClients } = require("./utils/firebase/fcmSender");
global.sendFcmToClients = sendFcmToClients;

// Register error handler
fastify.setErrorHandler(errorHandler.handleFastifyError.bind(errorHandler));

// Register request logging and metrics middleware
fastify.addHook('preHandler', async (request, reply) => {
  request.startTime = Date.now();
});

fastify.addHook('onResponse', async (request, reply) => {
  const responseTime = Date.now() - request.startTime;
  
  // Log the request
  logger.request(
    request.method,
    request.url,
    reply.statusCode,
    responseTime,
    request.user?.id
  );
  
  // Record metrics
  metricsCollector.recordHttpRequest(
    request.method,
    request.routerPath || request.url,
    reply.statusCode,
    responseTime
  );
});

// CORS configuration
fastify.register(fastifyCors, {
  origin: config.isDevelopment() ? "*" : config.get('api.allowedOrigins'),
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization", "cmis-auth"],
  credentials: true,
});

// Register Middleware
fastify.decorate("authenticate", authenticate);
fastify.register(cookie, {
  secret: config.get('security.cookieSecret'),
  hook: "onRequest",
});

// Health Check Endpoints
fastify.get("/health", async (request, reply) => {
  try {
    const healthStatus = await healthChecker.getHealthStatus();
    const statusCode = healthStatus.status === 'unhealthy' ? 503 : 200;
    return reply.code(statusCode).send(healthStatus);
  } catch (error) {
    logger.error('Health check failed', error);
    return reply.code(500).send({
      status: 'error',
      message: 'Health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

fastify.get("/health/liveness", async (request, reply) => {
  const livenessStatus = await healthChecker.getLivenessStatus();
  return reply.send(livenessStatus);
});

fastify.get("/health/readiness", async (request, reply) => {
  try {
    const readinessStatus = await healthChecker.getReadinessStatus();
    const statusCode = readinessStatus.status === 'not-ready' ? 503 : 200;
    return reply.code(statusCode).send(readinessStatus);
  } catch (error) {
    logger.error('Readiness check failed', error);
    return reply.code(503).send({
      status: 'not-ready',
      message: 'Readiness check failed',
      timestamp: new Date().toISOString()
    });
  }
});

// Metrics endpoint for Prometheus
fastify.get("/metrics", async (request, reply) => {
  try {
    const metrics = await metricsCollector.getMetrics();
    return reply
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(metrics);
  } catch (error) {
    logger.error('Metrics collection failed', error);
    return reply.code(500).send('Metrics unavailable');
  }
});

// Endpoint untuk menerima token FCM dari frontend dan simpan ke database
const { updateKaryawanFcmToken } = require("./utils/firebase/fcmTokenUtils");
fastify.post("/register-fcm", errorHandler.wrapAsync(async (request, reply) => {
  const { token, userId } = request.body;
  
  logger.info('FCM token registration attempt', { userId });
  
  if (!token || !userId) {
    logger.warn('FCM registration failed - missing parameters', { userId, hasToken: !!token });
    return reply
      .code(400)
      .send({ success: false, error: "Missing token or userId" });
  }
  
  try {
    const result = await updateKaryawanFcmToken(userId, token);
    logger.info('FCM token registered successfully', { userId, result });
    
    // Record business metric
    metricsCollector.recordBusinessEvent('fcm_token_registered');
    
    reply.send({ success: true, result });
  } catch (error) {
    logger.error('FCM token registration failed', error, { userId });
    metricsCollector.recordError('FCMRegistrationError', 'fcm');
    throw error;
  }
}));

// Register Routes
fastify.register(loginRoutes);
fastify.register(require('./routes/queue'), { prefix: '/api' });
fastify.register(fastifyMultipart, {
  limits: {
    fileSize: config.get('upload.maxSize'),
  },
});

// Register protectedRoutes with WebSocket Manager context
fastify.register(async function (fastify, options) {
  fastify.decorate("websocketManager", fastify.websocketManager);
  await fastify.register(protectedRoutes);
});

// Root endpoint with application info
fastify.get("/", async (request, reply) => {
  const uptime = process.uptime();
  const memoryUsage = process.memoryUsage();
  
  reply.send({ 
    message: "Bandung Backend Worker Service",
    version: config.get('app.version'),
    environment: config.get('app.env'),
    uptime: `${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`,
    memory: {
      used: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
      total: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`
    },
    timestamp: new Date().toISOString()
  });
});

// Function to implement exponential backoff
async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Import Camunda service with error handling
// try {
//   require("./utils/camunda/camundaService");
//   logger.info('Camunda service initialized successfully');
// } catch (error) {
//   logger.error('Failed to initialize Camunda service', error);
// }

// Enhanced Server Startup with Full Worker Service Features
const start = async () => {
  try {
    logger.lifecycle('Server startup initiated');
    
    // Register shutdown handlers
    gracefulShutdown.registerResource('fastify-server', async () => {
      logger.info('Closing Fastify server');
      await fastify.close();
    }, 10);
    
    gracefulShutdown.registerResource('health-checker', async () => {
      logger.info('Stopping health checker');
      healthChecker.stop();
    }, 5);

    // RabbitMQ graceful shutdown is already registered in queueManager.initialize()
    
    // Initialize RabbitMQ
    try {
      await queueManager.initialize();
      logger.info('RabbitMQ initialized successfully');
    } catch (error) {
      if (config.isProduction()) {
        throw error; // Fail fast in production
      } else {
        logger.warn('RabbitMQ initialization failed, continuing in development mode', error);
      }
    }

    // Start health checker
    healthChecker.start();
    logger.info('Health checker started');
    
    // Start server
    const port = config.get('app.port');
    const host = config.get('app.host');
    
    const server = await fastify.listen({ port, host });
    logger.lifecycle('HTTP server started', { 
      port, 
      host, 
      url: `http://${host}:${port}` 
    });

    // Initialize WebSocket server
    try {
      const httpServer = fastify.server;
      initializeWebSocketServer(httpServer);
      logger.lifecycle('WebSocket server initialized', { 
        port: config.get('websocket.port') 
      });
    } catch (wsError) {
      logger.error('WebSocket server initialization failed', wsError);
    }

    // Log startup completion
    const startupTime = Date.now() - parseInt(process.env.STARTUP_TIME || Date.now());
    logger.lifecycle('Application startup completed', {
      startupTime: `${startupTime}ms`,
      pid: process.pid,
      environment: config.get('app.env'),
      version: config.get('app.version')
    });

    // Log available endpoints
    logger.info('Available endpoints', {
      health: `http://${host}:${port}/health`,
      metrics: `http://${host}:${port}/metrics`,
      api: `http://${host}:${port}/`
    });

    return server;
    
  } catch (error) {
    logger.error('Server startup failed', error);
    
    // Ensure proper cleanup on startup failure
    try {
      await fastify.close();
    } catch (closeError) {
      logger.error('Error during cleanup', closeError);
    }
    
    process.exit(1);
  }
};

// Set startup time for metrics
process.env.STARTUP_TIME = Date.now().toString();

start();

