const axios = require("axios");

// Use CAMUNDA_API_URL env var as base for REST calls
const camundaUrl =
  process.env.CAMUNDA_API || "http://localhost:8080/engine-rest/";

/**
 * Fetch user groups from Camunda REST API
 * @param {string} userId - The user ID to fetch groups for
 * @returns {Promise<Array>} Array of group objects with id, name, and type
 */
module.exports.fetchUserGroups = async (userId) => {
  // console.log("🔍 Fetching groups for user via Camunda REST API:", userId);

  try {
    // Camunda REST: GET /group?member=<userId>
    const url = `${camundaUrl}engine-rest/group?member=${userId}`;
    const resp = await axios.get(url, { timeout: 10000 });

    // console.log("📥 Camunda REST API response:", resp);

    const groups = Array.isArray(resp.data)
      ? resp.data.map((g) => ({
          id: g.id,
          name: g.name || g.id,
          type: g.type || "",
        }))
      : [];

    // console.log(`✅ Found ${groups.length} groups for user ${userId} via REST`);
    // console.log("📋 Groups:", groups.map((g) => g.name).join(", "));

    return groups;
  } catch (err) {
    console.error(
      "❌ Error fetching user groups from Camunda REST API:",
      err.message || err
    );
    throw new Error(
      `Failed to fetch user groups from Camunda API: ${err.message}`
    );
  }
};

// backward-compatible no-op
module.exports.closePool = async () => {
  // nothing to close for REST-based implementation
};
