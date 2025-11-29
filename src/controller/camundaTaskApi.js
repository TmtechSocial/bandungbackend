const axios = require("axios");
const groupTaskMap = require("./groupTaskMap");

// Fungsi untuk mengambil task Camunda berdasarkan proc_inst_id
async function fetchCamundaTasksByProcInstId(procInstId) {
  const camundaUrl = process.env.CAMUNDA_API_URL || "https://mirorim.ddns.net:6789/api/engine-rest/";
  try {
  //console.log("test ambil")
    const response = await axios.get(`${camundaUrl}task?processInstanceId=${procInstId}`);
    
    //console.log("response", response)
    return response.data;
  } catch (error) {
    throw new Error("Gagal mengambil data task dari Camunda: " + error.message);
  }
}

module.exports = { fetchCamundaTasksByProcInstId };
