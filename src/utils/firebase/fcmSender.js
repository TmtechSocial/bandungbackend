const admin = require("firebase-admin");

// Fungsi kirim FCM ke client
async function sendFcmToClients(tokens, payload) {
  if (!tokens || tokens.length === 0) return;
  try {
    const stringifiedData = {};
    for (const key in payload.data) {
      stringifiedData[key] = String(payload.data[key]);
    }

    console.log("payload", JSON.stringify(payload, null, 2));
    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: payload.notification,
      // data: payload.data || {},
    });
    console.log("🚀 FCM response:", JSON.stringify(response, null, 2));
    console.log(
      "FCM sent:",
      response.successCount,
      "success,",
      response.failureCount,
      "failed"
    );
    return response;
  } catch (err) {
    console.error("FCM send error:", err);
    throw err;
  }
}

module.exports = { sendFcmToClients };
