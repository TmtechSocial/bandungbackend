const axios = require("axios");
const CAMUNDA_API = process.env.CAMUNDA_API;

// Cache untuk menyimpan process definition agar tidak perlu fetch berulang
const processDefinitionCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 menit

async function getProcessDefinition(processDefinitionKey) {
  // Check cache first
  const cacheKey = processDefinitionKey;
  const cached = processDefinitionCache.get(cacheKey);
  
  if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
    // console.log(`ðŸ“¦ Using cached process definition for: ${processDefinitionKey}`);
    return cached.data;
  }

  try {
    // console.log(`ðŸ” Fetching process definition for: ${processDefinitionKey}`);
    
    const response = await axios.get(
      `/engine-rest/process-definition/key/${processDefinitionKey}/xml`,
      {
        baseURL: CAMUNDA_API,
        headers: { "Content-Type": "application/json" },
        timeout: 10000, // 10 second timeout
      }
    );

    const processDefinition = response.data;
    
    // Cache the result
    processDefinitionCache.set(cacheKey, {
      data: processDefinition,
      timestamp: Date.now()
    });

    // console.log(`âœ… Process definition fetched for: ${processDefinitionKey}`);
    return processDefinition;
    
  } catch (error) {
    console.error(`âŒ Error fetching process definition for ${processDefinitionKey}:`, error.message);
    throw new Error(`Failed to fetch process definition: ${error.message}`);
  }
}

function isMultiClaimEnabled(bpmn20Xml) {
  try {
    if (!bpmn20Xml || typeof bpmn20Xml !== 'string') {
      return false;
    }

    // Parse XML untuk mencari extension properties
    const multiClaimRegex = /<camunda:property\s+name="multiClaim"\s+value="true"\s*\/>/i;
    const hasMultiClaim = multiClaimRegex.test(bpmn20Xml);
    
    // console.log(`ðŸ” Multi-claim check result: ${hasMultiClaim}`);
    return hasMultiClaim;
    
  } catch (error) {
    console.error('âŒ Error parsing BPMN XML for multi-claim:', error);
    return false;
  }
}

async function checkTaskMultiClaim(taskDefinitionKey) {
  try {
    // Extract process definition key from task definition key
    const processDefinitionKey = extractProcessDefinitionKey(taskDefinitionKey);
    
    // console.log(`ðŸ” Extracting process definition key:`);
    // console.log(`   Task Definition Key: ${taskDefinitionKey}`);
    // console.log(`   Process Definition Key: ${processDefinitionKey}`);
    
    if (!processDefinitionKey) {
      console.warn(`âš ï¸ Could not extract process definition key from: ${taskDefinitionKey}`);
      return false;
    }

    const processDefinition = await getProcessDefinition(processDefinitionKey);
    
    if (!processDefinition || !processDefinition.bpmn20Xml) {
      console.warn(`âš ï¸ No BPMN XML found for process: ${processDefinitionKey}`);
      return false;
    }

    const isMultiClaim = isMultiClaimEnabled(processDefinition.bpmn20Xml);
    // console.log(`ðŸŽ¯ Task ${taskDefinitionKey} multi-claim enabled: ${isMultiClaim}`);
    
    return isMultiClaim;
    
  } catch (error) {
    console.error(`âŒ Error checking multi-claim for task ${taskDefinitionKey}:`, error.message);
    return false; // Default to single claim on error
  }
}

function extractProcessDefinitionKey(taskDefinitionKey) {
  if (!taskDefinitionKey || typeof taskDefinitionKey !== 'string') {
    return null;
  }

  // Extracting process definition key dari task definition key
  // Format: DIVISI.PROCESS.TASK
  // Contoh: "MIRORIM_OPERASIONAL.MULTI_CLAIM.USER1" -> "MIRORIM_OPERASIONAL.MULTI_CLAIM"
  // Untuk XML, kita perlu DIVISI.PROCESS (tanpa TASK)
  
  const parts = taskDefinitionKey.split('.');
  
  if (parts.length >= 3) {
    // Format: DIVISI.PROCESS.TASK -> return DIVISI.PROCESS
    return `${parts[0]}.${parts[1]}`;
  } else if (parts.length === 2) {
    // Format: DIVISI.PROCESS -> return DIVISI.PROCESS
    return taskDefinitionKey;
  } else {
    // Format: SINGLE_NAME -> return as is
    return taskDefinitionKey;
  }
}

// Fungsi untuk mendapatkan semua task definitions dengan multi-claim info
async function getTasksWithMultiClaimInfo(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return [];
  }

  const tasksWithMultiClaim = [];
  const processedKeys = new Set(); // Untuk menghindari duplicate checks

  for (const task of tasks) {
    if (!task.taskDefinitionKey) {
      tasksWithMultiClaim.push({
        ...task,
        multiClaim: false,
        multiClaimEnabled: false // Keep both for backward compatibility
      });
      continue;
    }

    const processDefKey = extractProcessDefinitionKey(task.taskDefinitionKey);

    // console.log(`ðŸ” Processing task: ${task.taskDefinitionKey}`);
    // console.log(`ðŸ“‹ Extracted process definition key: ${processDefKey}`);
    
    // Skip jika sudah pernah di-check untuk process yang sama
    let multiClaimEnabled = false;
    if (!processedKeys.has(processDefKey)) {
      multiClaimEnabled = await checkTaskMultiClaim(task.taskDefinitionKey);
      processedKeys.add(processDefKey);
      // console.log(`âœ… Multi-claim check for ${processDefKey}: ${multiClaimEnabled}`);
    } else {
      // Gunakan hasil dari task sebelumnya dengan process definition yang sama
      const previousTask = tasksWithMultiClaim.find(t => 
        extractProcessDefinitionKey(t.taskDefinitionKey) === processDefKey
      );
      multiClaimEnabled = previousTask ? (previousTask.multiClaim || previousTask.multiClaimEnabled) : false;
      // console.log(`ðŸ“‹ Using cached result for ${processDefKey}: ${multiClaimEnabled}`);
    }

    tasksWithMultiClaim.push({
      ...task,
      multiClaim: multiClaimEnabled,
      multiClaimEnabled // Keep both for backward compatibility
    });
  }

  return tasksWithMultiClaim;
}

// Clear cache function (untuk maintenance)
function clearProcessDefinitionCache() {
  processDefinitionCache.clear();
  // console.log('ðŸ§¹ Process definition cache cleared');
}

module.exports = {
  getProcessDefinition,
  isMultiClaimEnabled,
  checkTaskMultiClaim,
  extractProcessDefinitionKey,
  getTasksWithMultiClaimInfo,
  clearProcessDefinitionCache
};
