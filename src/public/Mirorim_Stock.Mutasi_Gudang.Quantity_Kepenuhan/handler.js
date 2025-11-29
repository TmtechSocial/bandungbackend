const { Source } = require("graphql");
const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const axios = require("axios");
const GRAPHQL_API = process.env.GRAPHQL_API;
const SERVER_INVENTREE = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;

const eventHandlers = {
  async onSubmit(data, process, eventKey) {
    const results = [];
    for (const item of data) {
      try {
        let instanceId = item.parent_inst_id || null;
        // Mengirim data ke Camunda untuk menyelesaikan task
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
        console.log("responseCamunda", responseCamunda);
        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          // Update untuk setiap produk (detail) secara individual
          const dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
                gqlQuery: `mutation MyMutation(
                  $proc_inst_id: String!
                  $quantity: Int!
                  $date: timestamp!
                  $user: String!
                ) {
                  update_mutasi_request_details(
                    where: {
                      type: { _eq: "source" }
                      mutasi_request: { proc_inst_id: { _eq: $proc_inst_id } }
                    }
                    _set: {
                      quantity_movement: $quantity
                      updated_by: $user
                      updated_at: $date
                    }
                  ) {
                    affected_rows
                  }
                }
              `,
              variables: {
                proc_inst_id: item.proc_inst_id,
                quantity: item.quantity_adjust,
                date: item.updated_at,
                user: item.updated_by
              },
            },
            query: [],
          };
          console.log("dataQuery", dataQuery);
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
        console.log(`graphql error: ${error.dataQuery}`);

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
    return await eventHandlers[eventKey](data, process, eventKey);
  } catch (error) {
    console.error(`Error executing handler for event: ${eventKey}`, error);
    throw error;
  }
};

module.exports = { handle };
