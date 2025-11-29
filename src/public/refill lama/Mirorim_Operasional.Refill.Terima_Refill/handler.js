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

        //console.log("di refill")

        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {
              terima_refill: { value: item.terima_refill, type: "boolean" },
              quantity_approve: {value: item.quantity_approve, type: "Integer"},
            },
          },
        };

        const responseCamunda = await camundaConfig(dataCamunda, instanceId, process);
        //console.log("responseCamunda", responseCamunda);
        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          // const instanceId = responseCamunda.data.processInstanceId;
            const dataQuery = {
              graph: {
                method: "mutate",
                endpoint: GRAPHQL_API,
                gqlQuery: `mutation MyMutation($proc_inst_id: String!, $quantity_approve: Int!, $notes: String, $stock_pk: Int!, $task_def_key: String!) { update_mo_refill(where: { proc_inst_id: { _eq: $proc_inst_id } }, _set: { reject_notes: $notes, quantity_approve: $quantity_approve, stock_pk_resource: $stock_pk, task_def_key: $task_def_key }) { affected_rows } }`,
                variables: {
                  proc_inst_id: item.proc_inst_id,
                  quantity_approve: item.quantity_approve,
                  notes: item.notes || '',
                  stock_pk: item.source_location,
                  task_def_key: item.terima_refill ? "Mirorim_Operasional.Refill.Print_Invoice" : "Reject"
                },
              },
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
        //console.log( `graphql error: ${error.dataQuery}`);
        
        throw error;
      }
    }

    return results;
  },

  async onChange(data) {
    //console.log("Handling onChange with data:", data);
    // Implementasi onChange
    return { message: "onChange executed", data };
  },
};

const handle = async (eventData) => {
  const { eventKey, data, process } = eventData;
  //console.log("eventData", eventData);

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
