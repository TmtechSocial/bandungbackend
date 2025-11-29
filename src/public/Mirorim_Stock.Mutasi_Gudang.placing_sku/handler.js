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

        console.log("📥 Data form placing_sku:", item);
        const destination = (item.products || []).map((product) => ({
          destination_id: product.sku_id,
          quantity_fisik: product.quantity_fisik,
          quantity_placing: product.quantity_placing,
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
              kepenuhan: {
                value: item.products[0]?.kepenuhan ?? null,
                type: "boolean",
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
          for (const product of item.products) {
          const dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
                mutation MyMutation($id: Int!, $quantity: Int!, $user: String!, $sku_id: String!, $date: timestamp!, $quantity_physical: Int!, $quantity_data: Int!) {
                  update_mutasi_request_details(
                    where: { 
                      request_id: { _eq: $id }, 
                      sku_id: { _eq: $sku_id },
                      type: { _eq: "destination" } 
                    },
                    _set: { updated_by: $user, updated_at: $date, quantity_movement: $quantity, quantity_physical: $quantity_physical, quantity_data: $quantity_data }
                  ) {
                    affected_rows
                  }
                }
              `,
              variables: {
                id: item.id, 
                user: item.updated_by, 
                date: item.updated_at, 
                quantity: product.quantity_placing, 
                sku_id: product.sku_id,
                quantity_physical: product.quantity_fisik || 0,
                quantity_data: product.quantity_data || 0,
              },
            },
            query: [],
          };

          console.log("dataQuery", dataQuery);

          // Jalankan query (tunggal, bukan array), jangan pakai .map
          const responseQuery = await configureQuery(fastify, dataQuery);

          console.log("responseQuery", responseQuery);
        }

          results.push({
            message: "Create event processed successfully",
            camunda: responseCamunda.data
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
