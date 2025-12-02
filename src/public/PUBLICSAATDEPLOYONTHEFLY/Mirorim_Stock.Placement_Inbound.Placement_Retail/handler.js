const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const GRAPHQL_API = process.env.GRAPHQL_API;
const SERVER_INVENTREE = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;
const axios = require("axios");

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];

    for (const item of data) {
      try {
        const instanceId = item.proc_inst_id || null;

        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {},
          },
        };

        const responseCamunda = await camundaConfig(
          dataCamunda,
          instanceId,
          process
        );

        if (responseCamunda.status === 200 || responseCamunda.status === 204) {

          const inventree = axios.create({
            baseURL: `${SERVER_INVENTREE}/api`,
            headers: {
              Authorization: `Token ${INVENTREE_API_TOKEN}`,
              "Content-Type": "application/json",
            },
            timeout: 10000,
          });

          
          const dataQuery = [];
          
          // --- Loop untuk existing products ---
          for (const product of item.products) {
            // 🔄 Transfer Stock Item di Inventree 
             const transferPayload = {
                items: [
                  {
                    pk: Number(item.stock_item_id),
                    quantity: product.quantity_placement,
                  },
                ],
                notes: `Transfer Inbound Retail | Proc ID: ${item.proc_inst_id}`,
                location: product.location_id,
              };

const { data: stockData } = await inventree.post(
  "/stock/transfer/",
  transferPayload
);

console.log("stockData", stockData);


            dataQuery.push({
              graph: {
                method: "mutate",
                endpoint: GRAPHQL_API,
                gqlQuery: `mutation MyMutation(
  $updated_at: timestamp!, 
  $updated_by: String!, 
  $id: Int!, 
  $quantity: Int!
) {
  update_mi_placement(
    where: {id: {_eq: $id}}, 
    _set: {
      quantity_placement: $quantity, 
      updated_at: $updated_at, 
      updated_by: $updated_by
    }
  ) {
    affected_rows
  }
}
`,
                variables: {
                  updated_at: item.updated_at,
                  updated_by: item.updated_by,
                  id: product.id,
                  quantity: product.quantity_placement,
                },
              },
              query: [],
            });
          }
          console.log("dataQuery", JSON.stringify(dataQuery, null, 2));

          // Jalankan semua query secara paralel
          const responseQuery = await Promise.all(
            dataQuery.map((query) => configureQuery(fastify, query))
          );

console.log("responseQuery", JSON.stringify(responseQuery, null, 2));

          results.push({
            message: "Create event processed successfully",
            camunda: responseCamunda.data,
            database: responseQuery.map((r) => r.data),
          });
        }
      } catch (error) {
        console.error(`❌ Error executing handler for event: ${error.message}`, error);
      }
    }

    return results;
  },

  async onChange(data) {
    console.log("⚙️ Handling onChange with data:", data);
    return { message: "onChange executed", data };
  },
};

const handle = async (eventData) => {
  const { eventKey, data, process } = eventData;
  console.log("eventData", eventData);

  if (!eventHandlers[eventKey]) {
    throw new Error(`No handler found for event: ${eventKey}`);
  }

  try {
    return await eventHandlers[eventKey](data, process);
  } catch (error) {
    console.error(`Error executing handler for event: ${eventKey}`, error);
    throw error;
  }
};

module.exports = { handle };

