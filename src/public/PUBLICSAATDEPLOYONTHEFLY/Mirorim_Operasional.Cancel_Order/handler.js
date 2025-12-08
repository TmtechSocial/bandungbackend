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
          endpoint: `/engine-rest/process-definition/key/Mirorim_Operasional.Cancel_Order/start`,
          // instance: item.proc_inst_id, // jika menggunakan complete maka dibutuhkan instance
          variables: {
            variables: {
              invoice: { value: item.invoice, type: "string" }
            },
            // businessKey: `${item.id_employee}:${item.refill_type}:${item.refill_date}`,
          },
        };

        console.log("halooo")

        const responseCamunda = await camundaConfig(dataCamunda, instanceId);
        console.log("responseCamunda", responseCamunda);
        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          const instanceId = responseCamunda.data.processInstanceId;
          console.log("item", item);
          
           const dataQuery = {
             graph: {
               method: "mutate",
               endpoint: GRAPHQL_API,
               gqlQuery: `mutation MyMutation($invoice: String!, $task: String!) { update_mo_order(where: {invoice: {_eq: $invoice}}, _set: {task_def_key: $task}) { affected_rows } }`,
               variables: {
                 invoice: item.invoice,
                 task: "Mirorim_Operasional.Cancel_Order"
               }
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

