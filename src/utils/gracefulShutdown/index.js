const logger = require('../logger');
const config = require('../../config');

/**
 * Graceful Shutdown Handler
 * Manages clean application shutdown with proper resource cleanup
 */
class GracefulShutdown {
  constructor() {
    this.isShuttingDown = false;
    this.resources = new Map();
    this.activeTasks = new Set();
    this.shutdownTimeout = config.get('worker.gracefulShutdownTimeout');
    this.setupSignalHandlers();
  }

  /**
   * Setup signal handlers for graceful shutdown
   */
  setupSignalHandlers() {
    // Handle SIGTERM (Docker, Kubernetes, systemd)
    process.on('SIGTERM', () => {
      logger.lifecycle('SIGTERM received', { signal: 'SIGTERM' });
      this.shutdown('SIGTERM');
    });

    // Handle SIGINT (Ctrl+C)
    process.on('SIGINT', () => {
      logger.lifecycle('SIGINT received', { signal: 'SIGINT' });
      this.shutdown('SIGINT');
    });

    // Handle SIGUSR2 (nodemon)
    process.on('SIGUSR2', () => {
      logger.lifecycle('SIGUSR2 received', { signal: 'SIGUSR2' });
      this.shutdown('SIGUSR2');
    });
  }

  /**
   * Register a resource for cleanup during shutdown
   */
  registerResource(name, cleanupFn, priority = 0) {
    this.resources.set(name, {
      cleanup: cleanupFn,
      priority,
      name
    });
    
    logger.debug('Resource registered for cleanup', { 
      resource: name, 
      priority 
    });
  }

  /**
   * Register an active task
   */
  registerTask(taskId, taskInfo = {}) {
    if (this.isShuttingDown) {
      throw new Error('Cannot register new tasks during shutdown');
    }

    const task = {
      id: taskId,
      startTime: Date.now(),
      ...taskInfo
    };

    this.activeTasks.add(task);
    
    logger.debug('Task registered', { 
      taskId,
      activeTasks: this.activeTasks.size 
    });

    // Return cleanup function
    return () => this.unregisterTask(taskId);
  }

  /**
   * Unregister a completed task
   */
  unregisterTask(taskId) {
    const task = Array.from(this.activeTasks).find(t => t.id === taskId);
    if (task) {
      this.activeTasks.delete(task);
      
      const duration = Date.now() - task.startTime;
      logger.debug('Task completed', { 
        taskId,
        duration: `${duration}ms`,
        activeTasks: this.activeTasks.size 
      });
    }
  }

  /**
   * Wait for all active tasks to complete
   */
  async waitForActiveTasks() {
    if (this.activeTasks.size === 0) {
      return;
    }

    logger.info('Waiting for active tasks to complete', {
      activeTasks: this.activeTasks.size
    });

    const startTime = Date.now();
    const maxWaitTime = this.shutdownTimeout * 0.7; // Use 70% of total timeout

    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        
        if (this.activeTasks.size === 0) {
          clearInterval(checkInterval);
          logger.info('All tasks completed', {
            elapsed: `${elapsed}ms`
          });
          resolve();
        } else if (elapsed > maxWaitTime) {
          clearInterval(checkInterval);
          logger.warn('Timeout waiting for tasks', {
            remainingTasks: this.activeTasks.size,
            elapsed: `${elapsed}ms`
          });
          resolve();
        }
      }, 1000);
    });
  }

  /**
   * Cleanup all registered resources
   */
  async cleanupResources() {
    logger.info('Starting resource cleanup', {
      resourceCount: this.resources.size
    });

    // Sort resources by priority (higher priority cleaned up first)
    const sortedResources = Array.from(this.resources.values())
      .sort((a, b) => b.priority - a.priority);

    const cleanupPromises = sortedResources.map(async (resource) => {
      const startTime = Date.now();
      
      try {
        logger.debug('Cleaning up resource', { resource: resource.name });
        await resource.cleanup();
        
        const duration = Date.now() - startTime;
        logger.debug('Resource cleanup completed', { 
          resource: resource.name,
          duration: `${duration}ms`
        });
      } catch (error) {
        logger.error('Resource cleanup failed', error, { 
          resource: resource.name 
        });
      }
    });

    // Wait for all cleanups with timeout
    try {
      await Promise.race([
        Promise.all(cleanupPromises),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Cleanup timeout')), this.shutdownTimeout * 0.3)
        )
      ]);
      
      logger.info('Resource cleanup completed');
    } catch (error) {
      logger.error('Resource cleanup timeout or error', error);
    }
  }

  /**
   * Main shutdown process
   */
  async shutdown(signal) {
    if (this.isShuttingDown) {
      logger.warn('Shutdown already in progress');
      return;
    }

    this.isShuttingDown = true;
    const shutdownStart = Date.now();

    logger.lifecycle('Graceful shutdown initiated', { 
      signal,
      activeTasks: this.activeTasks.size,
      registeredResources: this.resources.size
    });

    try {
      // Step 1: Stop accepting new work
      logger.info('Phase 1: Stopping new work acceptance');
      
      // Step 2: Wait for active tasks to complete
      logger.info('Phase 2: Waiting for active tasks');
      await this.waitForActiveTasks();

      // Step 3: Cleanup resources
      logger.info('Phase 3: Cleaning up resources');
      await this.cleanupResources();

      const shutdownDuration = Date.now() - shutdownStart;
      logger.lifecycle('Graceful shutdown completed', {
        signal,
        duration: `${shutdownDuration}ms`
      });

      // Exit successfully
      process.exit(0);
      
    } catch (error) {
      const shutdownDuration = Date.now() - shutdownStart;
      logger.error('Graceful shutdown failed', error, {
        signal,
        duration: `${shutdownDuration}ms`
      });

      // Force exit after failure
      setTimeout(() => {
        logger.error('Forced exit due to shutdown failure');
        process.exit(1);
      }, 5000);
    }
  }

  /**
   * Force shutdown (emergency)
   */
  forceShutdown(reason = 'Force shutdown requested') {
    logger.warn('Force shutdown initiated', { reason });
    
    // Give a short time for cleanup
    setTimeout(() => {
      logger.error('Force shutdown - exiting now');
      process.exit(1);
    }, 5000);
  }

  /**
   * Get shutdown status
   */
  getStatus() {
    return {
      isShuttingDown: this.isShuttingDown,
      activeTasks: Array.from(this.activeTasks).map(task => ({
        id: task.id,
        runtime: Date.now() - task.startTime
      })),
      registeredResources: Array.from(this.resources.keys())
    };
  }

  /**
   * Check if system can accept new work
   */
  canAcceptWork() {
    return !this.isShuttingDown;
  }
}

// Export singleton instance
const gracefulShutdown = new GracefulShutdown();

/**
 * Decorator for wrapping async functions with task tracking
 */
function withTaskTracking(taskPrefix = 'task') {
  return function(target, propertyKey, descriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function(...args) {
      if (!gracefulShutdown.canAcceptWork()) {
        throw new Error('System is shutting down, cannot accept new work');
      }

      const taskId = `${taskPrefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const cleanup = gracefulShutdown.registerTask(taskId, {
        method: propertyKey,
        args: args.length
      });

      try {
        const result = await originalMethod.apply(this, args);
        return result;
      } finally {
        cleanup();
      }
    };

    return descriptor;
  };
}

module.exports = {
  gracefulShutdown,
  withTaskTracking
};