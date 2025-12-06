module.exports = {
  apps: [
    {
      name: 'bandung-backend',
      script: './src/server.js',
      instances: 'max', // Use all available CPU cores
      exec_mode: 'cluster',
      
      // Environment specific settings
      env: {
        NODE_ENV: 'development',
        PORT: 8010
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 8010,
        LOG_LEVEL: 'info'
      },
      
      // Performance settings
      max_memory_restart: '1G',
      node_args: '--max-old-space-size=1024',
      
      // Logging
      log_file: './logs/pm2-combined.log',
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      
      // Restart settings
      autorestart: true,
      watch: false, // Set to true for development
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000,
      
      // Health monitoring
      health_check_http: {
        url: 'http://localhost:8010/health/liveness',
        max_redirect: 3,
        timeout: 5000
      },
      
      // Advanced settings
      kill_timeout: 30000, // Time to wait before force killing
      wait_ready: true, // Wait for app to be ready before considering it online
      listen_timeout: 10000,
      
      // Environment variables
      source_map_support: true,
      instance_var: 'INSTANCE_ID',
      
      // Graceful shutdown
      kill_signal: 'SIGTERM'
    }
  ],
  
  deploy: {
    production: {
      user: 'deploy',
      host: ['your-production-server.com'],
      ref: 'origin/main',
      repo: 'git@github.com:your-org/bandung-backend.git',
      path: '/var/www/bandung-backend',
      'post-deploy': 'npm install --production && pm2 reload ecosystem.config.js --env production',
      'pre-setup': 'mkdir -p /var/www/bandung-backend/shared/logs'
    },
    
    staging: {
      user: 'deploy',
      host: ['your-staging-server.com'],
      ref: 'origin/develop',
      repo: 'git@github.com:your-org/bandung-backend.git',
      path: '/var/www/bandung-backend-staging',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env staging'
    }
  }
};