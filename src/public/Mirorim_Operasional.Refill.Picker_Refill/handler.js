const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const GRAPHQL_API = process.env.GRAPHQL_API

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];
    for (const item of data) {
      try {
        let taskId;
        let instanceId = item.proc_inst_id || null; 

        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {
              quantity_approve: { value: item.quantity_approve, type: "integer" },
            },
          },
        };

        const responseCamunda = await camundaConfig(dataCamunda, instanceId, process);
        console.log("responseCamunda", responseCamunda);
        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          // const instanceId = responseCamunda.data.processInstanceId;
          const dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `mutation MyMutation($proc_inst_id: String!, $quantity: Int!, $task_def_key: String!, $created_at: timestamp!, $created_by: String!, $id: Int!) {
  update_mo_refill(where: {proc_inst_id: {_eq: $proc_inst_id}}, _set: {quantity_approve: $quantity}) {
    affected_rows
  }
  insert_mo_refill_detail(objects: {quantity: $quantity, created_at: $created_at, created_by: $created_by, task_def_key: $task_def_key, refill_id: $id}) {
    affected_rows
  }
}`,
              variables: {
                proc_inst_id: item.proc_inst_id,
                id: item.id,
                quantity: item.quantity_approve,
                task_def_key: "Mirorim_Operasional.Refill.Picker_Refill",
                created_at: item.date,
                created_by: item.name_employee,
              }
            },
            query: [],
          };      

          const responseQuery = await configureQuery(fastify, dataQuery);

          results.push({
            message: "Create event processed successfully",
            camunda: responseCamunda.data,
            database: responseQuery.data,
          });
        }
      } catch (error) {
        console.error(`Error executing handler for event: ${eventKey}`, error);
        throw error;
      }
    }

    return results;
  },

  async onChange(data) {
    console.log("Handling onChange with data:", data);
    // Implementasi onChange
    return { message: "onChange executed", data };
  },
};

const handle = async (eventData) => {
  const { eventKey, data, process } = eventData;
  console.log("eventData", eventData);

  if (!eventHandlers[eventKey]) {
    throw new Error(`No handler found for event: ${eventKey}`);
  }

  // Panggil handler yang sesuai berdasarkan event
  try {
    return await eventHandlers[eventKey](data, process);
  } catch (error) {
    console.error(`Error executing handler for event: ${eventKey}`, error);
    throw error;
  }
};

module.exports = { handle };
