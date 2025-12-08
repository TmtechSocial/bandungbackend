const axios = require("axios");
const CAMUNDA_API = process.env.CAMUNDA_API

async function camundaConfig(dataCamunda, instance, process) {
  try {
    const { type, endpoint, variables, instance } = dataCamunda;
    //console.log("dataCamunda", dataCamunda);

    if (type === "start") {
      apiEndpoint = endpoint;
      payload = variables || {};
    } else if (type === "complete") {
      if (!instance) {
        throw new Error("Instance ID is required to complete a task.");
      }
      const taskResponse = await axios.get(
        `/engine-rest/task?processInstanceId=${instance}&taskDefinitionKey=${process}`,
        {
          baseURL: CAMUNDA_API,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      //console.log("taskResponse", taskResponse);

      const taskList = taskResponse.data;
      if (taskList.length === 0) {
        throw new Error(`No task found for the instance ID: ${instance}`);
      }

      const taskId = taskList[0].id;
      //console.log("taskId", taskId);

      apiEndpoint = endpoint.replace("{taskId}", taskId);
      //console.log("apiEndpoint", apiEndpoint);
      payload = variables || {};
    } else {
      throw new Error(
        "Unsupported type. Only 'start' or 'complete' are allowed."
      );
    }

    const response = await axios.post(apiEndpoint, payload, {
      baseURL: CAMUNDA_API,
      headers: {
        "Content-Type": "application/json",
      },
    });

    // console.log("response", JSON.stringify(response.data, null, 2));

    if (type === "start") {
      return {
        status: response.status,
        data: {
          processInstanceId: response.data.id || response.data[0].processInstance.id,
          definitionId: response.data.definitionId || response.data[0].processInstance.definitionId,
        },
      };
    } else if (type === "complete") {
      return {
        status: response.status,
        data: {
          message: "Task completed successfully.",
        },
      };
    }
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
}

module.exports = camundaConfig;
