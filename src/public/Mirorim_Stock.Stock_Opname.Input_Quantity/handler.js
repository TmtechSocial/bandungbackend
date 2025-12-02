const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const axios = require("axios");
const GRAPHQL_API = process.env.GRAPHQL_API;
const INVENTREE_API_URL = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];
    for (const item of data) {
      try {
        let taskId;
        let instanceId = item.proc_inst_id || null;

       const inventreeResponse = await axios.get(
      `${INVENTREE_API_URL}/api/stock/`,
      {
        params: {
          location: item.location_id,
          part: item.part_id,
        },
        headers: {
          Authorization: `Token ${INVENTREE_API_TOKEN}`, // sesuaikan token
          "Content-Type": "application/json",
        },
      }
    );

    console.log("Calling InvenTree API:", {
  url: `${INVENTREE_API_URL}/api/stock/`,
  params: {
    location: item.location_id,
    part: item.part_id,
  }
});

    const stockItems = inventreeResponse.data?.results || [];
    const quantity_system = stockItems.reduce(
      (sum, item) => sum + (item.quantity || 0),
      0
    );
    console.log("quantity system", quantity_system);
    

        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {
              quantity_counted: {
                value: item.quantity_counted,
                type: "String",
              },
              quantity_system: { value: quantity_system, type: "String" },
            },
          },
        };

        const responseCamunda = await camundaConfig(
          dataCamunda,
          instanceId,
          process
        );
        console.log("responseCamunda", responseCamunda);
        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          // const instanceId = responseCamunda.data.processInstanceId;
          const dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
                mutation InsertStockOpnameLogs($proc_inst_id: String!, $quantity_input: numeric!, $task_def_key: String!, $status: String!, $user: String!, $created_at: timestamp!, $evidence: String!, $quantity_data: numeric!) {
                insert_stock_opname_logs(objects: {proc_inst_id: $proc_inst_id, quantity_input: $quantity_input, task_def_key: $task_def_key, user: $user, created_at: $created_at, evidence: $evidence, quantity_data: $quantity_data}) {
                  affected_rows
                }
                update_stock_opname(where: {proc_inst_id: {_eq: $proc_inst_id}}, _set: {status: $status}) {
                  affected_rows
                }
              }     
              `,
              variables: {
                proc_inst_id: item.proc_inst_id,
                quantity_input: item.quantity_counted,
                user: item.user,
                status: item.quantity_counted === quantity_system ? "Finish" : "Recount",
                task_def_key: "Mirorim_Stock.Stock_Opname.Input_Quantity",
                created_at: new Date(
                  new Date().getTime() + 7 * 60 * 60 * 1000
                ).toISOString(),
                evidence: item.evidence[0] || "",
                quantity_data: quantity_system || 0,
              },
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
  console.error(`Error executing onSubmit handler`, error);
  console.log(`GraphQL error:`, error?.response?.data || error.message);
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
