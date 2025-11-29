const axios = require("axios");
const CAMUNDA_API = process.env.CAMUNDA_API;
const { fetchAllTasks } = require("./camundaTask");
const { broadcastTaskEvent } = require("../websocket/websocketServer");
const { checkTaskMultiClaim } = require("./processDefinition");

async function getTaskByInstanceAndKey(instance, taskDefinitionKey) {
  const response = await axios.get(
    `/engine-rest/task?processInstanceId=${instance}&taskDefinitionKey=${taskDefinitionKey}`,
    {
      baseURL: CAMUNDA_API,
      headers: { "Content-Type": "application/json" },
    }
  );

  const taskList = response.data;
  if (!taskList || taskList.length === 0) {
    throw new Error(
      "No task found for the given instance and taskDefinitionKey."
    );
  }

  return taskList[0];
}

// Function to check if user already has tasks with same taskDefinitionKey
async function checkUserExistingTasks(userId, taskDefinitionKey) {
  try {
    const response = await axios.get(
      `/engine-rest/task?assignee=${userId}&taskDefinitionKey=${taskDefinitionKey}`,
      {
        baseURL: CAMUNDA_API,
        headers: { "Content-Type": "application/json" },
      }
    );

    return response.data || [];
  } catch (error) {
    console.error("❌ Error checking user existing tasks:", error.message);
    return [];
  }
}

async function claimTask(request, reply, websocketManager) {
  const { instance, taskDefinitionKey, userId } = request.body;
  
  console.log("📝 Claim request received:", { instance, taskDefinitionKey, userId });
  
  if (!instance || !taskDefinitionKey || !userId) {
    return reply.status(400).send({
      error: "Missing required fields: instance, taskDefinitionKey, userId",
    });
  }

  try {
    const task = await getTaskByInstanceAndKey(instance, taskDefinitionKey);
    console.log("📋 Task found for claiming:", { id: task.id, name: task.name, assignee: task.assignee });
    
    // Check if task is already claimed by someone else
    if (task.assignee && task.assignee !== userId) {
      console.log("⚠️ Task already claimed by another user:", task.assignee);
      return reply.status(409).send({
        error: `Task is already claimed by another user: ${task.assignee}`,
        currentAssignee: task.assignee
      });
    }
    
    // Check if task is already claimed by the same user
    if (task.assignee === userId) {
      console.log("⚠️ Task already claimed by the requesting user:", userId);
      return reply.status(400).send({
        error: "Task is already claimed by you",
        currentAssignee: task.assignee
      });
    }

    // NEW: Check multi-claim settings and existing tasks
    const isMultiClaim = await checkTaskMultiClaim(taskDefinitionKey);
    console.log(`🔍 Multi-claim enabled for ${taskDefinitionKey}: ${isMultiClaim}`);

    if (!isMultiClaim) {
      // For non-multi-claim tasks, check if user already has ANY task with same taskDefinitionKey
      const existingTasks = await checkUserExistingTasks(userId, taskDefinitionKey);
      
      if (existingTasks.length > 0) {
        console.log(`⚠️ User ${userId} already has ${existingTasks.length} task(s) with taskDefinitionKey: ${taskDefinitionKey}`);
        const existingTaskInstances = existingTasks.map(t => t.processInstanceId).join(', ');
        
        return reply.status(409).send({
          error: `You cannot claim this task. This task type (${taskDefinitionKey}) does not support multi-claim and you already have claimed task(s) in instance(s): ${existingTaskInstances}`,
          currentAssignee: task.assignee,
          multiClaim: false,
          existingTasks: existingTasks.map(t => ({
            id: t.id,
            processInstanceId: t.processInstanceId,
            name: t.name
          }))
        });
      }
    }
    
    console.log("ekseksusiiii", task.id);
    console.log("eksuksiii", userId);
    
    const response = await axios.post(
      `/engine-rest/task/${task.id}/claim`,
      { userId },
      {
        baseURL: CAMUNDA_API,
        headers: { "Content-Type": "application/json" },
      }
    );

    console.log("✅ Task claimed successfully:", task.id);

    // WebSocket broadcasting for real-time updates
    try {
      broadcastTaskEvent({
        type: "CLAIMED",
        taskId: task.id,
        userId,
        taskName: task.name || taskDefinitionKey,
        processInstanceId: instance,
        taskDefinitionKey,
        assignee: userId,
        multiClaim: isMultiClaim,
        businessKey1: "",
        businessKey2: "",
        businessKey3: "",
        timestamp: new Date().toISOString()
      });
    } catch (broadcastError) {
      console.log("📡 WebSocket broadcast failed (non-critical):", broadcastError.message);
    }

    // Simple response without complex broadcasting
    return reply.send({
      status: response.status,
      message: "Task successfully claimed",
      taskId: task.id,
      assignee: userId,
      processInstanceId: instance,
      taskDefinitionKey,
      multiClaim: isMultiClaim
    });
  } catch (error) {
    console.error("❌ Claim Error:", error.message);
    return reply
      .status(500)
      .send({ error: "Failed to claim task", details: error.message });
  }
}

async function unclaimTask(request, reply, websocketManager) {
  const { instance, taskDefinitionKey, userId } = request.body;
  
  console.log("📝 Unclaim request received:", { instance, taskDefinitionKey, userId });
  
  if (!instance || !taskDefinitionKey || !userId) {
    return reply.status(400).send({
      error: "Missing required fields: instance, taskDefinitionKey, userId",
    });
  }

  try {
    const task = await getTaskByInstanceAndKey(instance, taskDefinitionKey);
    console.log("📋 Task found for unclaiming:", { id: task.id, name: task.name, assignee: task.assignee });
    
    if (!task.assignee) {
      return reply
        .status(400)
        .send({ error: "Task is not currently claimed by any user." });
    }

    if (task.assignee !== userId) {
      return reply.status(403).send({
        error: `Task is assigned to another user: ${task.assignee}. You cannot unclaim it.`,
      });
    }

    // Get multi-claim status for response
    const isMultiClaim = await checkTaskMultiClaim(taskDefinitionKey);

    const response = await axios.post(
      `/engine-rest/task/${task.id}/unclaim`,
      {},
      {
        baseURL: CAMUNDA_API,
        headers: { "Content-Type": "application/json" },
      }
    );

    console.log("✅ Task unclaimed successfully:", task.id);

    // WebSocket broadcasting for real-time updates
    try {
      broadcastTaskEvent({
        type: "UNCLAIMED",
        taskId: task.id,
        userId,
        taskName: task.name || taskDefinitionKey,
        processInstanceId: instance,
        taskDefinitionKey,
        assignee: null,
        multiClaim: isMultiClaim,
        businessKey1: "",
        businessKey2: "",
        businessKey3: "",
        timestamp: new Date().toISOString()
      });
    } catch (broadcastError) {
      console.log("📡 WebSocket broadcast failed (non-critical):", broadcastError.message);
    }

    // Simple response without complex broadcasting
    return reply.send({
      status: response.status,
      message: "Task successfully unclaimed",
      taskId: task.id,
      assignee: null,
      processInstanceId: instance,
      taskDefinitionKey,
      multiClaim: isMultiClaim
    });
  } catch (error) {
    console.error("❌ Unclaim Error:", error.message);
    return reply
      .status(500)
      .send({ error: "Failed to unclaim task", details: error.message });
  }
}

module.exports = {
  claimTask,
  unclaimTask,
};

