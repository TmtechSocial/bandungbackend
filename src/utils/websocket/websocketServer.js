const WebSocket = require('ws');

let wss = null;
let connectedClients = new Map(); // Store clients with their user info

// Initialize WebSocket server
function initializeWebSocketServer(server) {
  wss = new WebSocket.Server({ 
    server,
    path: '/ws'
  });

  wss.on('connection', (ws, request) => {
    // console.log('📡 New WebSocket connection established');
    
    // Handle client identification
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        
        if (data.type === 'identify') {
          // Store client with user info
          connectedClients.set(ws, {
            userId: data.userId,
            groups: data.groups || [],
            connectionTime: new Date().toISOString()
          });
          
          // console.log(`👤 Client identified: ${data.userId}, Groups: ${JSON.stringify(data.groups)}`);
          
          // Send confirmation
          ws.send(JSON.stringify({
            type: 'identified',
            success: true,
            timestamp: new Date().toISOString()
          }));
        }
      } catch (error) {
        console.error('❌ Error parsing WebSocket message:', error);
      }
    });

    ws.on('close', () => {
      const clientInfo = connectedClients.get(ws);
      if (clientInfo) {
        console.log(`📤 Client disconnected: ${clientInfo.userId}`);
        connectedClients.delete(ws);
      }
    });

    ws.on('error', (error) => {
      console.error('❌ WebSocket error:', error);
      connectedClients.delete(ws);
    });
  });

  console.log('🔗 WebSocket server initialized');
  return wss;
}

// Broadcast task event to connected clients
function broadcastTaskEvent(eventData) {
  if (!wss) {
    console.warn('⚠️ WebSocket server not initialized');
    return;
  }

  const message = JSON.stringify({
    type: 'task_event',
    data: {
      ...eventData,
      timestamp: new Date().toISOString()
    }
  });

  let sentCount = 0;
  let failedCount = 0;

  connectedClients.forEach((clientInfo, ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(message);
        sentCount++;
      } catch (error) {
        console.error(`❌ Failed to send to client ${clientInfo.userId}:`, error);
        failedCount++;
      }
    } else {
      // Remove disconnected clients
      connectedClients.delete(ws);
      failedCount++;
    }
  });

  // console.log(`📡 Broadcasted task event: ${eventData.type} - Sent: ${sentCount}, Failed: ${failedCount}`);
}

// Get connected clients info
function getConnectedClients() {
  const clients = [];
  connectedClients.forEach((clientInfo, ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      clients.push({
        userId: clientInfo.userId,
        groups: clientInfo.groups,
        connectionTime: clientInfo.connectionTime
      });
    }
  });
  return clients;
}

// Send message to specific user
function sendToUser(userId, message) {
  let sent = false;
  connectedClients.forEach((clientInfo, ws) => {
    if (clientInfo.userId === userId && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          type: 'direct_message',
          data: message,
          timestamp: new Date().toISOString()
        }));
        sent = true;
      } catch (error) {
        console.error(`❌ Failed to send direct message to ${userId}:`, error);
      }
    }
  });
  return sent;
}

module.exports = {
  initializeWebSocketServer,
  broadcastTaskEvent,
  getConnectedClients,
  sendToUser
};
