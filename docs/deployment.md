# Bandung Backend - Production Deployment Guide

## Overview
This guide provides comprehensive instructions for deploying the Bandung Backend worker service in production environments.

## Prerequisites

### System Requirements
- **Node.js**: >= 18.0.0
- **PostgreSQL**: >= 12.0
- **Memory**: Minimum 2GB RAM (4GB recommended)
- **Storage**: 10GB minimum (SSD recommended)
- **Network**: Access to Camunda, GraphQL, and external APIs

### Dependencies
- Docker (optional but recommended)
- PM2 for process management
- Nginx for reverse proxy (optional)
- Monitoring tools (Prometheus, Grafana)

## Environment Setup

### 1. Environment Variables
Copy `.env.example` to `.env` and configure all required variables:

```bash
cp .env.example .env
```

#### Required Environment Variables
```bash
# Application
NODE_ENV=production
APP_NAME=bandung-backend
APP_VERSION=1.0.0
PORT=8010
HOST=0.0.0.0
LOG_LEVEL=info

# Database
DB_HOST=your-db-host
DB_PORT=5432
DB_USER=your-db-user
DB_PASSWORD=your-secure-password
DB_NAME=your-db-name
DB_INVENTREE=inventree
DB_MAX_CONNECTIONS=20
DB_CONNECTION_TIMEOUT=30000

# Security
JWT_SECRET=your-very-secure-jwt-secret
COOKIE_SECRET=your-secure-cookie-secret

# External Services
CAMUNDA_API=http://your-camunda-host:8080/
GRAPHQL_API=http://your-graphql-host:9000/v1/graphql
SERVER_INVENTREE=http://your-inventree-host:8004
INVENTREE_API_TOKEN=your-inventree-token

# Monitoring (optional)
METRICS_ENABLED=true
METRICS_PORT=9090
HEALTH_CHECK_INTERVAL=30000

# Graceful Shutdown
GRACEFUL_SHUTDOWN_TIMEOUT=30000
WORKER_CONCURRENCY=5
```

### 2. Directory Structure
```
bandung-backend/
├── src/
├── logs/                    # Application logs (created automatically)
├── uploads/                 # File uploads (created automatically)
├── config/
│   ├── production.json     # Production-specific config
│   └── ecosystem.config.js # PM2 configuration
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
├── scripts/
│   ├── start.sh
│   ├── stop.sh
│   └── health-check.sh
└── docs/
    └── deployment.md
```

## Installation Methods

### Method 1: Direct Installation

1. **Clone and Install Dependencies**
```bash
git clone <repository-url>
cd bandung-backend
npm install --production
```

2. **Database Setup**
```bash
# Create databases if not exists
createdb your-db-name
createdb inventree
```

3. **Configure Environment**
```bash
cp .env.example .env
# Edit .env with your values
```

4. **Start Application**
```bash
npm run start
```

### Method 2: Docker Deployment

1. **Build Docker Image**
```bash
docker build -t bandung-backend:latest -f docker/Dockerfile .
```

2. **Run with Docker Compose**
```bash
docker-compose -f docker/docker-compose.yml up -d
```

### Method 3: PM2 Process Manager (Recommended)

1. **Install PM2 Globally**
```bash
npm install -g pm2
```

2. **Start with PM2**
```bash
pm2 start config/ecosystem.config.js --env production
```

3. **Save PM2 Configuration**
```bash
pm2 save
pm2 startup
```

## Production Configuration Files

### PM2 Ecosystem Configuration
Location: `config/ecosystem.config.js`

### Docker Configuration
Location: `docker/Dockerfile` and `docker/docker-compose.yml`

### Nginx Configuration (Optional)
For load balancing and SSL termination.

## Monitoring and Health Checks

### Health Check Endpoints
- **Liveness**: `GET /health/liveness`
- **Readiness**: `GET /health/readiness` 
- **Full Health**: `GET /health`
- **Metrics**: `GET /metrics` (Prometheus format)

### Log Management
- Logs are automatically rotated using Winston
- Production logs are stored in JSON format
- Error logs are separated from general logs
- Log retention: 14 days for errors, 7 days for general logs

### Monitoring Integration
- Prometheus metrics exposed on `/metrics`
- Grafana dashboard templates available
- Alert rules for critical failures

## Security Considerations

### 1. Environment Security
- Never commit `.env` files
- Use strong, unique passwords
- Rotate secrets regularly
- Use environment-specific configurations

### 2. Network Security
- Configure firewall rules
- Use HTTPS in production
- Implement rate limiting
- Secure database connections

### 3. Application Security
- JWT tokens with proper expiration
- Input validation and sanitization
- SQL injection protection
- CORS configuration

## Performance Optimization

### 1. Database Optimization
- Connection pooling configured
- Query optimization
- Index optimization
- Connection limits set

### 2. Application Optimization
- Worker concurrency limits
- Memory usage monitoring
- CPU usage optimization
- Garbage collection tuning

### 3. Caching Strategy
- Redis integration (optional)
- In-memory caching for static data
- API response caching

## Backup and Recovery

### 1. Database Backup
```bash
# Daily backup script
pg_dump -h $DB_HOST -U $DB_USER $DB_NAME > backup_$(date +%Y%m%d).sql
```

### 2. Application Backup
- Configuration files
- Upload directories
- Log files (if needed)

### 3. Recovery Procedures
- Database restoration process
- Application rollback procedures
- Configuration recovery

## Troubleshooting

### Common Issues
1. **Database Connection Failures**
   - Check connection strings
   - Verify database accessibility
   - Check firewall rules

2. **Memory Issues**
   - Monitor heap usage
   - Check for memory leaks
   - Adjust worker concurrency

3. **Task Processing Issues**
   - Check Camunda connectivity
   - Verify task subscriptions
   - Monitor task queues

### Log Analysis
- Use structured logging for analysis
- Monitor error patterns
- Set up alerting for critical errors

### Performance Issues
- Monitor metrics dashboard
- Analyze slow queries
- Check external API response times

## Maintenance

### 1. Regular Updates
- Security patches
- Dependency updates
- Configuration updates

### 2. Health Monitoring
- Regular health checks
- Performance monitoring
- Capacity planning

### 3. Log Rotation
- Automatic log cleanup
- Archive old logs
- Monitor disk usage

## Support and Documentation

### Getting Help
- Check health check endpoints
- Review application logs
- Monitor metrics dashboard
- Check system resources

### Documentation
- API documentation
- Configuration reference
- Troubleshooting guides
- Performance tuning guides

## Scaling Considerations

### Horizontal Scaling
- Multiple worker instances
- Load balancer configuration
- Database connection management
- Shared storage for uploads

### Vertical Scaling
- Memory allocation
- CPU cores utilization
- Database performance tuning
- Network optimization

---

For additional support or questions, please refer to the project documentation or contact the development team.