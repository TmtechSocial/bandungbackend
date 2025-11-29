// NOTE: admin.initializeApp() harus dipanggil di server.js sebelum file ini digunakan!
const admin = require("firebase-admin");
const db = admin.firestore();

// Fungsi untuk menulis event ke Firestore dengan detail lengkap
async function broadcastTaskEvent({ 
  type, 
  taskId, 
  userId, 
  taskName, 
  processInstanceId,
  taskDefinitionKey,
  assignee,
  businessKey1,
  businessKey2,
  businessKey3
}) {
  try {
    // Filter out undefined values
    const cleanEvent = {
      type: type || "UNKNOWN",
      taskId: taskId || "",
      userId: userId || "",
      taskName: taskName || "",
      processInstanceId: processInstanceId || "",
      taskDefinitionKey: taskDefinitionKey || "",
      assignee: assignee || null,
      businessKey1: businessKey1 || "",
      businessKey2: businessKey2 || "",
      businessKey3: businessKey3 || "",
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: new Date().toISOString(),
    };

    // Validate required fields
    if (!cleanEvent.type || !cleanEvent.processInstanceId || !cleanEvent.taskDefinitionKey) {
      throw new Error(`Missing required fields: type=${cleanEvent.type}, processInstanceId=${cleanEvent.processInstanceId}, taskDefinitionKey=${cleanEvent.taskDefinitionKey}`);
    }

    console.log("📡 Broadcasting task event:", cleanEvent);
    
    const docRef = await db.collection("taskEvents").add(cleanEvent);
    console.log("✅ Task event broadcasted with ID:", docRef.id);
    
    return { ...cleanEvent, id: docRef.id };
  } catch (error) {
    console.error("❌ Error broadcasting task event:", error);
    throw error;
  }
}

// Fungsi untuk broadcast multiple tasks (untuk bulk operations)
async function broadcastBulkTaskEvents(events) {
  try {
    const batch = db.batch();
    const refs = [];
    
    events.forEach(event => {
      const docRef = db.collection("taskEvents").doc();
      refs.push(docRef);
      
      batch.set(docRef, {
        ...event,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: new Date().toISOString(),
      });
    });
    
    await batch.commit();
    console.log(`✅ Bulk broadcasted ${events.length} task events`);
    
    return refs.map((ref, index) => ({ ...events[index], id: ref.id }));
  } catch (error) {
    console.error("❌ Error bulk broadcasting task events:", error);
    throw error;
  }
}

module.exports = { 
  broadcastTaskEvent, 
  broadcastBulkTaskEvents 
};
