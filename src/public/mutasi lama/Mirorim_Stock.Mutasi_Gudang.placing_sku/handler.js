const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")();
const GRAPHQL_API = process.env.GRAPHQL_API;

const eventHandlers = {
  async onSubmit(data, process, eventKey) {
    const results = [];
    for (const item of data) {
      try {
        let instanceId = item.parent_inst_id || null;

        console.log("📥 Data form placing_sku:", item.products);
        const destination = (item.products || []).map((product) => ({
          destination_id: product.sku_id,
          quantity: product.quantity,
          quantity_tambah: product.quantity_tambah,
        }));
        console.log("📥 Data destination:", destination);

        // Prepare data untuk complete task di Camunda
        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`, // {taskId} seharusnya diganti sesuai implementasi camundaConfig
          instance: item.proc_inst_id,
          variables: {
            variables: {
              destination: {
                value: JSON.stringify(destination),
                type: "String",
              },
            },
          },
        };

        // Kirim request ke Camunda
        const responseCamunda = await camundaConfig(
          dataCamunda,
          instanceId,
          process
        );

        console.log("responseCamunda", responseCamunda);

        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          // Query update GraphQL
          const dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
                mutation MyMutation($id: Int!, $user: String!, $date: timestamp!) {
                  update_mutasi_request_details(
                    where: { 
                      request_id: { _eq: $id }, 
                      type: { _eq: "destination" } 
                    },
                    _set: { updated_by: $user, updated_at: $date }
                  ) {
                    affected_rows
                  }
                }
              `,
              variables: {
                id: item.id, 
                user: item.updated_by, 
                date: item.updated_at, 
              },
            },
            query: [],
          };

          console.log("dataQuery", dataQuery);

          // Jalankan query (tunggal, bukan array), jangan pakai .map
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

  async onChange(data, process, eventKey) {
    console.log(`Handling ${eventKey} with data:`, data);
    // Implementasi onChange
    return { message: `${eventKey} executed`, data };
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
