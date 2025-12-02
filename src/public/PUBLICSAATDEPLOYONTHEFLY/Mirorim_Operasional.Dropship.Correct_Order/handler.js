const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")();
const GRAPHQL_API = process.env.GRAPHQL_API;

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];
    for (const item of data) {
      try {
        let instanceId = item.proc_inst_id || null;

        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: instanceId,
          variables: {
            variables: {
              // tambahkan variable jika diperlukan
            },
          },
        };

        const responseCamunda = await camundaConfig(dataCamunda, instanceId, process);
        console.log("responseCamunda", responseCamunda);

        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          const dataQuery = item.products.map(product => ({
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
                mutation UpdateDropShip(
                  $proc_inst_id: String!,
                  $sku_toko: String!,
                  $sku_toko_change: String!,
                  $quantity_change: Int!,
                  $status: String!
                ) {
                  update_mo_dropship(
                    where: {
                      proc_inst_id: { _eq: $proc_inst_id },
                      sku: { _eq: $sku_toko },
                      status: { _eq: $status }
                    },
                    _set: {
                      quantity: $quantity_change,
                      sku: $sku_toko_change
                    }
                  ) {
                    affected_rows
                  }
                }
              `,
              variables: {
                proc_inst_id: instanceId,
                sku_toko: product.sku,
                sku_toko_change: product.sku_toko_change,
                quantity_change: product.quantity_order_change,
                status: "Correction"
              }
            },
            query: [],
          }));

          console.log("dataQuery", dataQuery);

          const responseQuery = await Promise.all(
            dataQuery.map(query => configureQuery(fastify, query))
          );

          results.push({
            message: "Create event processed successfully",
            camunda: responseCamunda.data || null,
            database: responseQuery,
          });
        }
      } catch (error) {
        console.error("Error executing handler for event: onSubmit", error);
        throw error;
      }
    }

    return results;
  },

  async onChange(data) {
    console.log("Handling onChange with data:", data);
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

