const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const GRAPHQL_API = process.env.GRAPHQL_API;

const eventHandlers = {
  async onSubmit(data) {
    const results = [];
    for (const item of data) {
      try {
        let taskId;
        let instanceId = item.proc_inst_id || null; 

        const dataCamunda = {
          type: "start",
          endpoint: `/engine-rest/process-definition/key/Mirorim_Operasional.Retur/start`,
          // instance: item.proc_inst_id, // jika menggunakan complete maka dibutuhkan instance
          variables: {
            variables: {
              resi: { value: item.resi, type: "string" },
              courier: { value: item.courier, type: "string" }
            },
            businessKey: `${item.resi}:${item.courier}:${item.retur_date}`,
          },
        };

        const responseCamunda = await camundaConfig(dataCamunda, instanceId);
        console.log("responseCamunda", responseCamunda);
        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          const instanceId = responseCamunda.data.processInstanceId;
          console.log("item", item);
          
          const dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `mutation InsertReturReceive($proc_inst_id: String!, $courier: String!, $courier_name: String!, $task_def_key: String!, $resi_retur: String!, $retur_date: timestamp!) { insert_mo_retur_receive(objects: {proc_inst_id: $proc_inst_id, courier: $courier, courier_name: $courier_name, task_def_key: $task_def_key, resi_retur: $resi_retur, retur_date: $retur_date}) { affected_rows } }`,
              variables: {
                proc_inst_id: instanceId,
                courier: item.courier,
                courier_name: item.courier_name,
                task_def_key: "Mirorim_Operasional.Retur.Match_Invoice_MP",
                resi_retur: item.resi,
                retur_date: item.retur_date,
              },
            },
            query: [],
          };

          const responseQuery = await configureQuery(fastify, dataQuery);
          console.log("responseQuery", responseQuery);

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
  const { eventKey, data } = eventData;
  console.log("eventData", eventData); 

  if (!eventHandlers[eventKey]) {
    throw new Error(`No handler found for event: ${eventKey}`);
  }

  // Panggil handler yang sesuai berdasarkan event
  try {
    return await eventHandlers[eventKey](data);
  } catch (error) {
    console.error(`Error executing handler for event: ${eventKey}`, error);
    throw error;
  }
};

module.exports = { handle };

