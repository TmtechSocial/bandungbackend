const WebSocket = require('ws');

class WebSocketManager {
  constructor(server) {
    this.wss = new WebSocket.Server({ server });
    this.clients = new Map(); // Map untuk menyimpan connection berdasarkan userId
    
    this.wss.on('connection', (ws, req) => {
      console.log('New WebSocket connection established');
      
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          
          if (data.type === 'register' && data.userId) {
            // Register client dengan userId
            this.clients.set(data.userId, ws);
            console.log(`User ${data.userId} registered for WebSocket notifications`);
            
            ws.send(JSON.stringify({
              type: 'registration_success',
              userId: data.userId,
              timestamp: new Date().toISOString()
            }));
          }
        } catch (error) {
          console.error('Error processing WebSocket message:', error);
        }
      });
      
      ws.on('close', () => {
        // Remove client dari map ketika connection ditutup
        for (const [userId, client] of this.clients.entries()) {
          if (client === ws) {
            this.clients.delete(userId);
            console.log(`User ${userId} disconnected from WebSocket`);
            break;
          }
        }
      });
      
      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });
    });
  }

  // Broadcast message ke semua connected clients
  broadcastToAll(message) {
    const messageString = JSON.stringify(message);
    
    this.wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageString);
      }
    });
    
    console.log(`📡 Broadcasted message to ${this.wss.clients.size} clients:`, message);
  }

  // Send message ke specific user
  sendToUser(userId, message) {
    const client = this.clients.get(userId);
    
    if (client && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
      console.log(`📡 Sent message to user ${userId}:`, message);
      return true;
    } else {
      console.log(`⚠️ User ${userId} not connected or connection not ready`);
      return false;
    }
  }

  // Broadcast task claim/unclaim events
  broadcastTaskEvent(eventData) {
    const message = {
      type: 'task_update',
      event: eventData.type, // CLAIMED atau UNCLAIMED
      taskId: eventData.taskId,
      userId: eventData.userId,
      taskName: eventData.taskName,
      processInstanceId: eventData.processInstanceId,
      taskDefinitionKey: eventData.taskDefinitionKey,
      assignee: eventData.assignee,
      timestamp: new Date().toISOString()
    };

    // Broadcast ke semua clients
    this.broadcastToAll(message);
  }

  // Get connection stats
  getStats() {
    return {
      totalConnections: this.wss.clients.size,
      registeredUsers: this.clients.size,
      registeredUserIds: Array.from(this.clients.keys())
    };
  }
}

module.exports = WebSocketManager;