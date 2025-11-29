const axios = require("axios");
const CAMUNDA_API = process.env.CAMUNDA_API;
const { fetchAllTasks } = require("./camundaTask");

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

async function claimTask(request, reply) {
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
    
    const response = await axios.post(
      `/engine-rest/task/${task.id}/claim`,
      { userId },
      {
        baseURL: CAMUNDA_API,
        headers: { "Content-Type": "application/json" },
      }
    );

    console.log("✅ Task claimed successfully:", task.id);

    // Simple broadcasting to Firestore for real-time updates
    try {
      const { broadcastTaskEvent } = require('../firebase/firestoreBroadcaster');
      await broadcastTaskEvent({
        type: "CLAIMED",
        taskId: task.id,
        userId,
        taskName: task.name || taskDefinitionKey,
        processInstanceId: instance,
        taskDefinitionKey,
        assignee: userId,
        businessKey1: "",
        businessKey2: "",
        businessKey3: "",
        timestamp: new Date().toISOString()
      });
    } catch (broadcastError) {
      console.log("📡 Firestore broadcast failed (non-critical):", broadcastError.message);
    }

    // Simple response without complex broadcasting
    return reply.send({
      status: response.status,
      message: "Task successfully claimed",
      taskId: task.id,
      assignee: userId,
      processInstanceId: instance,
      taskDefinitionKey
    });
  } catch (error) {
    console.error("❌ Claim Error:", error.message);
    return reply
      .status(500)
      .send({ error: "Failed to claim task", details: error.message });
  }
}

async function unclaimTask(request, reply) {
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

    const response = await axios.post(
      `/engine-rest/task/${task.id}/unclaim`,
      {},
      {
        baseURL: CAMUNDA_API,
        headers: { "Content-Type": "application/json" },
      }
    );

    console.log("✅ Task unclaimed successfully:", task.id);

    // Simple broadcasting to Firestore for real-time updates
    try {
      const { broadcastTaskEvent } = require('../firebase/firestoreBroadcaster');
      await broadcastTaskEvent({
        type: "UNCLAIMED",
        taskId: task.id,
        userId,
        taskName: task.name || taskDefinitionKey,
        processInstanceId: instance,
        taskDefinitionKey,
        assignee: null,
        businessKey1: "",
        businessKey2: "",
        businessKey3: "",
        timestamp: new Date().toISOString()
      });
    } catch (broadcastError) {
      console.log("📡 Firestore broadcast failed (non-critical):", broadcastError.message);
    }

    // Simple response without complex broadcasting
    return reply.send({
      status: response.status,
      message: "Task successfully unclaimed",
      taskId: task.id,
      assignee: null,
      processInstanceId: instance,
      taskDefinitionKey
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
