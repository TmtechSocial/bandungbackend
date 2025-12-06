const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config();

/**
 * Centralized Configuration Management
 * Validates and provides structured access to all environment variables
 */
class ConfigManager {
  constructor() {
    this.validateRequiredEnvs();
    this.config = this.buildConfig();
  }

  /**
   * Validates that all required environment variables are present
   */
  validateRequiredEnvs() {
    const required = [
      'DB_HOST',
      'DB_PORT', 
      'DB_USER',
      'DB_PASSWORD',
      'DB_NAME',
      'JWT_SECRET',
      'CAMUNDA_API',
      'GRAPHQL_API'
    ];

    const missing = required.filter(key => !process.env[key]);

    if (missing.length > 0) {
      const env = process.env.NODE_ENV || 'development';

      // In production we must fail fast. In non-production, warn and continue
      if (env === 'production') {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
      } else {
        // Provide a helpful console message so developer knows what's missing
        /* eslint-disable no-console */
        console.warn(`Config warning: Missing environment variables for ${env} environment: ${missing.join(', ')}. ` +
          `Create a .env file or set these variables. Continuing in ${env} mode.`);
        /* eslint-enable no-console */
      }
    }
  }

  /**
   * Builds the complete configuration object
   */
  buildConfig() {
    return {
      // Application Configuration
      app: {
        name: process.env.APP_NAME || 'bandung-backend',
        version: process.env.APP_VERSION || '1.0.0',
        env: process.env.NODE_ENV || 'development',
        port: parseInt(process.env.PORT) || 8010,
        host: process.env.HOST || '0.0.0.0',
        logLevel: process.env.LOG_LEVEL || 'info'
      },

      // Database Configuration
      database: {
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        name: process.env.DB_NAME,
        inventree: process.env.DB_INVENTREE || 'inventree',
        maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS) || 20,
        connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 30000
      },

      // External APIs
      api: {
        camunda: {
          baseUrl: process.env.CAMUNDA_API,
          timeout: parseInt(process.env.CAMUNDA_TIMEOUT) || 30000,
          retryAttempts: parseInt(process.env.CAMUNDA_RETRY_ATTEMPTS) || 3
        },
        graphql: {
          endpoint: process.env.GRAPHQL_API,
          timeout: parseInt(process.env.GRAPHQL_TIMEOUT) || 15000
        },
        inventree: {
          baseUrl: process.env.SERVER_INVENTREE,
          token: process.env.INVENTREE_API_TOKEN,
          tokenAdjustment: process.env.INVENTREE_API_TOKEN_ADJUSTMENT,
          timeout: parseInt(process.env.INVENTREE_TIMEOUT) || 30000
        },
        bigCapital: {
          baseUrl: process.env.BIGCAPITAL_API,
          token: process.env.BIGCAPITAL_TOKEN,
          organizationId: process.env.BIGCAPITAL_ORGANIZATION_ID,
          timeout: parseInt(process.env.BIGCAPITAL_TIMEOUT) || 30000
        },
        ldap: {
          url: process.env.LDAP_API,
          manageUrl: process.env.LDAP_API_MANAGE,
          base: process.env.LDAP_BASE,
          timeout: parseInt(process.env.LDAP_TIMEOUT) || 10000
        }
      },

      // Security Configuration
      security: {
        jwtSecret: process.env.JWT_SECRET,
        cookieSecret: process.env.COOKIE_SECRET || 'default-cookie-secret',
        saltRounds: parseInt(process.env.SALT_ROUNDS) || 10
      },

      // Worker Configuration
      worker: {
        camunda: {
          baseUrl: process.env.CAMUNDA_API + '/engine-rest',
          maxTasks: parseInt(process.env.CAMUNDA_MAX_TASKS) || 10,
          asyncResponseTimeout: parseInt(process.env.CAMUNDA_ASYNC_TIMEOUT) || 100,
          lockDuration: parseInt(process.env.CAMUNDA_LOCK_DURATION) || 300000,
          retryTimeout: parseInt(process.env.CAMUNDA_RETRY_TIMEOUT) || 60000
        },
        concurrency: parseInt(process.env.WORKER_CONCURRENCY) || 5,
        gracefulShutdownTimeout: parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT) || 30000
      },

      // Monitoring Configuration
      monitoring: {
        healthCheck: {
          interval: parseInt(process.env.HEALTH_CHECK_INTERVAL) || 30000,
          timeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT) || 5000
        },
        metrics: {
          enabled: process.env.METRICS_ENABLED === 'true',
          port: parseInt(process.env.METRICS_PORT) || 9090,
          prefix: process.env.METRICS_PREFIX || 'bandung_backend_'
        }
      },

      // File Upload Configuration
      upload: {
        maxSize: parseInt(process.env.MAX_FILE_SIZE) || (50 * 1024 * 1024), // 50MB
        allowedTypes: process.env.ALLOWED_FILE_TYPES?.split(',') || ['jpg', 'jpeg', 'png', 'pdf', 'doc', 'docx'],
        path: process.env.UPLOAD_PATH || './uploads'
      },

      // WebSocket Configuration
      websocket: {
        port: parseInt(process.env.WEBSOCKET_PORT) || 5000,
        maxConnections: parseInt(process.env.WS_MAX_CONNECTIONS) || 1000,
        heartbeatInterval: parseInt(process.env.WS_HEARTBEAT_INTERVAL) || 30000
      },

      // Firebase Configuration
      firebase: {
        projectId: process.env.FIREBASE_PROJECT_ID,
        serviceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '../firebase-service-account.json'
      },

      // Notification Configuration
      notification: {
        whatsapp: process.env.WHATSAPP_NOTIFICATION,
        fcm: {
          enabled: process.env.FCM_ENABLED !== 'false'
        }
      }
    };
  }

  /**
   * Gets configuration value by path (e.g., 'database.host')
   */
  get(path) {
    return path.split('.').reduce((obj, key) => obj?.[key], this.config);
  }

  /**
   * Gets the entire configuration object
   */
  getAll() {
    return this.config;
  }

  /**
   * Checks if running in production environment
   */
  isProduction() {
    return this.config.app.env === 'production';
  }

  /**
   * Checks if running in development environment  
   */
  isDevelopment() {
    return this.config.app.env === 'development';
  }

  /**
   * Gets database connection configuration
   */
  getDatabaseConfig() {
    return {
      user: this.config.database.user,
      host: this.config.database.host,
      database: this.config.database.name,
      password: this.config.database.password,
      port: this.config.database.port,
      max: this.config.database.maxConnections,
      connectionTimeoutMillis: this.config.database.connectionTimeout
    };
  }

  /**
   * Gets Inventree database connection configuration
   */
  getInventreeDbConfig() {
    return {
      user: this.config.database.user,
      host: this.config.database.host,
      database: this.config.database.inventree,
      password: this.config.database.password,
      port: this.config.database.port,
      max: this.config.database.maxConnections,
      connectionTimeoutMillis: this.config.database.connectionTimeout
    };
  }
}

// Export singleton instance
const config = new ConfigManager();
module.exports = config;