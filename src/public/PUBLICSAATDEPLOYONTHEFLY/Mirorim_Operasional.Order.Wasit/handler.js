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
        console.log("items", JSON.stringify(item, null, 2));

        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {
              decision: { value: item.decision, type: "String" },
            },
          },
        };
        
        const responseCamunda = await camundaConfig(dataCamunda, instanceId, process);
        console.log("responseCamunda", responseCamunda);
        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          // Update wasit column for each product based on checkbox state
          const productsToUpdate = item.products.filter(product => product.picker || product.checker);
          
          const dataQuery = productsToUpdate.map(product => ({
            graph: {
              method: "mutate", 
              endpoint: GRAPHQL_API,
              gqlQuery: `mutation UpdateWasit($proc_inst_id: String!, $sku_toko: String!, $wasit: String!) {
                update_mo_order_shop(
                  where: {
                    proc_inst_id: {_eq: $proc_inst_id},
                    sku_toko: {_eq: $sku_toko}
                  },
                  _set: {
                    wasit: $wasit
                  }
                ) {
                  affected_rows
                }
              }`,
              variables: {
                proc_inst_id: instanceId,
                sku_toko: product.sku_toko,
                wasit: product.picker ? "picker" : "checker"
              }
            },
            query: []
          }));

          // Update task in mo_order table
          dataQuery.push({
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API, 
              gqlQuery: `mutation MyMutation($proc_inst_id: String!, $task: String!) {   
                update_mo_order(
                  where: {proc_inst_id: {_eq: $proc_inst_id}},
                  _set: {task_def_key: $task}
                ) {
                  affected_rows
                }
              }`,
              variables: {
                proc_inst_id: instanceId,
                task: item.decision === "picker" ? "Mirorim_Operasional.Order.Adjustment_Pick" : "Mirorim_Operasional.Order.Checking"
              }
            },
            query: []
          });

          const responseQueries = await Promise.all(
            dataQuery.map(query => configureQuery(fastify, query))
          );

          results.push({
            message: "Create event processed successfully",
            database: responseQueries.map(res => res.data),
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

