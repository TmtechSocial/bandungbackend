const fastify = require("fastify")({ logger: false });
require("dotenv").config();
const { authenticate } = require("./middleware/authenticate");
const loginRoutes = require("./routes/login");
const protectedRoutes = require("./routes/routesConfig");
const fastifyMultipart = require("@fastify/multipart");
const fastifyCors = require("@fastify/cors");
const cookie = require("@fastify/cookie");
const cron = require("node-cron");
// const http = require("http");

// WebSocket Server
const {
  initializeWebSocketServer,
} = require("./utils/websocket/websocketServer");
const http = require("http");

// WebSocket Manager
const WebSocketManager = require("./utils/websocket/websocketManager");

// Firebase Admin SDK
const admin = require("firebase-admin");
const serviceAccount = require("../firebase-service-account.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Import fungsi kirim FCM dari utils/firebase/fcmSender.js
const { sendFcmToClients } = require("./utils/firebase/fcmSender");
global.sendFcmToClients = sendFcmToClients;

fastify.register(fastifyCors, {
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization", "cmis-auth"],
  credentials: true,
});

// Register Middleware
fastify.decorate("authenticate", authenticate);
fastify.register(cookie, {
  secret: process.env.COOKIE_SECRET,
  hook: "onRequest",
});

// Endpoint untuk menerima token FCM dari frontend dan simpan ke database
const { updateKaryawanFcmToken } = require("./utils/firebase/fcmTokenUtils");
fastify.post("/register-fcm", async (request, reply) => {
  const { token, userId } = request.body;
  console.log("token", token);
  console.log("userId", userId);
  if (!token || !userId) {
    return reply
      .code(400)
      .send({ success: false, error: "Missing token or userId" });
  }
  try {
    const result = await updateKaryawanFcmToken(userId, token);
    console.log("FCM registration result:", result);
    reply.send({ success: true, result });
  } catch (err) {
    reply.code(500).send({ success: false, error: err.message });
  }
});

// Register Routes
fastify.register(loginRoutes);
fastify.register(fastifyMultipart, {
  limits: {
    fileSize: 50 * 1024 * 1024, // Maksimum 50MB
  },
});

// Register protectedRoutes with WebSocket Manager context
fastify.register(async function (fastify, options) {
  fastify.decorate("websocketManager", fastify.websocketManager);
  await fastify.register(protectedRoutes);
});

// Root endpoint
fastify.get("/", async (request, reply) => {
  reply.send({ message: "Halo anda sudah terhubung dengan server!" });
});

// Function to implement exponential backoff
async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
// Import Camunda service
require("./utils/camunda/camundaService");

// Start server
const start = async () => {
  try {
    const server = await fastify.listen({ port: 8010, host: "0.0.0.0" });
    fastify.log.info(`Server berjalan di http://localhost:8010`);

    // Initialize WebSocket server
    const httpServer = fastify.server;
    initializeWebSocketServer(httpServer);
    console.log("🔗 WebSocket server initialized on port 5000");
  } catch (err) {
    fastify.log.error("Failed to start server:", err);
    process.exit(1);
  }
};

start();

