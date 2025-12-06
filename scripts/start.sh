#!/bin/bash

# Bandung Backend Start Script
# This script starts the application with proper environment setup

set -e  # Exit on any error

# Configuration
APP_NAME="bandung-backend"
APP_DIR="/var/www/bandung-backend"
NODE_ENV="${NODE_ENV:-production}"
PM2_INSTANCES="${PM2_INSTANCES:-max}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
}

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    error "Do not run this script as root"
    exit 1
fi

# Check Node.js version
check_node_version() {
    if ! command -v node &> /dev/null; then
        error "Node.js is not installed"
        exit 1
    fi
    
    NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        error "Node.js version 18 or higher is required. Current version: $(node --version)"
        exit 1
    fi
    
    log "Node.js version check passed: $(node --version)"
}

# Check PM2
check_pm2() {
    if ! command -v pm2 &> /dev/null; then
        warn "PM2 is not installed. Installing PM2..."
        npm install -g pm2
    fi
    
    log "PM2 version: $(pm2 --version)"
}

# Check environment file
check_environment() {
    if [ ! -f ".env" ]; then
        if [ -f ".env.example" ]; then
            warn ".env file not found. Copying from .env.example"
            cp .env.example .env
            error "Please configure .env file with your settings"
            exit 1
        else
            error ".env file not found and no .env.example available"
            exit 1
        fi
    fi
    
    log "Environment file check passed"
}

# Check dependencies
check_dependencies() {
    if [ ! -d "node_modules" ]; then
        log "Installing dependencies..."
        npm install --production
    fi
    
    log "Dependencies check passed"
}

# Create necessary directories
create_directories() {
    mkdir -p logs
    mkdir -p uploads
    log "Directories created/verified"
}

# Pre-flight checks
pre_flight_checks() {
    log "Running pre-flight checks..."
    
    # Check disk space (require at least 1GB free)
    DISK_USAGE=$(df . | tail -1 | awk '{print $5}' | sed 's/%//')
    if [ "$DISK_USAGE" -gt 95 ]; then
        error "Disk usage is ${DISK_USAGE}%. Require at least 5% free space."
        exit 1
    fi
    
    # Check memory (require at least 1GB free)
    FREE_MEM=$(free -m | awk 'NR==2{printf "%.0f", $7*100/$2}')
    if [ "$FREE_MEM" -lt 10 ]; then
        warn "Low memory available: ${FREE_MEM}%"
    fi
    
    # Check if port is available
    if netstat -tuln | grep -q ":8010 "; then
        error "Port 8010 is already in use"
        exit 1
    fi
    
    log "Pre-flight checks completed"
}

# Start application with PM2
start_application() {
    log "Starting ${APP_NAME}..."
    
    # Stop existing instance if running
    pm2 delete $APP_NAME 2>/dev/null || true
    
    # Start with PM2
    if [ -f "config/ecosystem.config.js" ]; then
        pm2 start config/ecosystem.config.js --env $NODE_ENV
    else
        pm2 start src/server.js --name $APP_NAME --instances $PM2_INSTANCES --env $NODE_ENV
    fi
    
    # Save PM2 configuration
    pm2 save
    
    log "Application started successfully"
}

# Verify application is running
verify_application() {
    log "Verifying application startup..."
    
    # Wait for application to start
    sleep 10
    
    # Check health endpoint
    if curl -f http://localhost:8010/health/liveness > /dev/null 2>&1; then
        log "Health check passed - application is running correctly"
    else
        error "Health check failed - application may not be running correctly"
        pm2 logs $APP_NAME --lines 20
        exit 1
    fi
}

# Main execution
main() {
    log "Starting ${APP_NAME} deployment..."
    
    check_node_version
    check_pm2
    check_environment
    check_dependencies
    create_directories
    pre_flight_checks
    start_application
    verify_application
    
    log "Application startup completed successfully!"
    log "View logs with: pm2 logs ${APP_NAME}"
    log "Monitor with: pm2 monit"
    log "Health check: curl http://localhost:8010/health"
}

# Run main function
main "$@"