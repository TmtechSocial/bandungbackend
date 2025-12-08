// const axios = require("axios"); 
require("dotenv").config();
const { Client } = require("pg");
const { DB_USER, DB_PASSWORD, DB_HOST, DB_PORT } = process.env;
const { fetchCamundaTasksByProcInstId } = require("./camundaTaskApi");
const groupTaskMap = require("./groupTaskMap");

async function checkQRInstance(fastify, input, groups, userId) {
  const connectionString = `postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/proc_mirorim_operasional`;
  const client = new Client({ connectionString });

  try {
    await client.connect();

    let query, params;
      // Handle regular QR/resi case
      query = `
        SELECT task_def_key AS process, proc_inst_id AS instance
        FROM mo_order
        WHERE resi = $1 OR invoice = $1
      `;
      params = [input];

    const result = await client.query(query, params);

    if (result.rows.length === 0) {
      throw new Error("Resi tidak ditemukan.");
    }

    const procInstId = result.rows[0].instance;
    //console.log("procInstId", procInstId)
    // Ambil semua task dari Camunda untuk procInstId ini
    const camundaTasks = await fetchCamundaTasksByProcInstId(procInstId);
    //console.log("camunda tasks", camundaTasks)
    // Ambil semua task_def_key yang sedang aktif
    const activeTaskDefKeys = camundaTasks.map(task => task.taskDefinitionKey);
    //console.log("active task def keys", activeTaskDefKeys)
    //console.log("groups", groups)

    // Buat list task_def_key yang boleh diambil oleh group
    let allowedTaskDefKeys = [];
    if (Array.isArray(groups)) {
      groups.forEach(group => {
        const groupName = group.name || group; // Handle both object and string format
        //console.log(`Processing group: ${groupName}, taskMap entry:`, groupTaskMap[groupName]);
        if (groupTaskMap[groupName]) {
          allowedTaskDefKeys.push(...groupTaskMap[groupName]);
        }
      });
    }
    
    //console.log("allowedTaskDefKeys", allowedTaskDefKeys)
    // Filter task_def_key aktif yang boleh diambil oleh group user
    const availableForGroups = activeTaskDefKeys.filter(key => allowedTaskDefKeys.includes(key));
    //console.log("availableForGroups", availableForGroups)

    // Jika tidak ada task yang bisa diambil oleh group user, return 300
    if (availableForGroups.length === 0) {
      // Gabungkan nama group yang boleh akses task ini
      let allowedGroups = [];
      activeTaskDefKeys.forEach(key => {
        Object.entries(groupTaskMap).forEach(([group, keys]) => {
          if (keys.includes(key) && !allowedGroups.includes(group)) {
            allowedGroups.push(group);
          }
        });
      });
      throw { status: 300, message: `Invoice ini sedang dalam tahap proses Group ${allowedGroups.join(', ')}` };
    }    // Cek apakah task sudah di-claim
    const targetTaskDefKey = availableForGroups[0];
    const targetTask = camundaTasks.find(t => t.taskDefinitionKey === targetTaskDefKey);
    
    //console.log(`Checking claim status for task: ${targetTaskDefKey}, Task ID: ${targetTask?.id}, Assignee: ${targetTask?.assignee}`);
    
    if (targetTask && targetTask.assignee) {
      // Task sudah di-claim, cek apakah userId sama
      if (targetTask.assignee !== userId) {
        //console.log(`Task already claimed by different user. Current assignee: ${targetTask.assignee}, Requesting user: ${userId}`);
        throw { 
          status: 300, 
          message: `Task ini sudah di-claim oleh user ${targetTask.assignee}` 
        };
      }
      // Jika userId sama, lanjutkan tanpa claim ulang
      //console.log(`Task already claimed by same user: ${userId}. Proceeding without re-claiming.`);
    } else if (targetTask && userId) {
      // Task belum di-claim, lakukan claim
      //console.log(`Task not claimed yet. Claiming for user: ${userId}`);
      const axios = require("axios");
      const camundaUrl = process.env.CAMUNDA_API_URL || "http://localhost:8080/engine-rest/";
      
      try {
        await axios.post(`${camundaUrl}task/${targetTask.id}/claim`, { userId });
        //console.log(`Successfully claimed task ${targetTask.id} for user ${userId}`);
      } catch (claimError) {
        console.error("Error claiming task:", claimError.message);
        // Jika claim gagal, tetap lanjutkan tapi log error
      }
    }

    // Jika ada task yang bisa diakses, return hanya process (task def key yang boleh diakses) dan instance    // Jika ada task yang bisa diakses, return hanya process (task def key yang boleh diakses) dan instance
    return {
      status: 200,
      process: targetTaskDefKey,
      instance: procInstId
    };
  } catch (error) {
    if (error.status) {
      throw error;
    }
    throw new Error(error.message);
  } finally {
    await client.end();
  }
}

module.exports = { checkQRInstance };