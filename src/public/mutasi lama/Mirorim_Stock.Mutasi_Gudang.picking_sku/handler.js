const { Source } = require("graphql");
const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const GRAPHQL_API = process.env.GRAPHQL_API;

const eventHandlers = {
  async onSubmit(data, process, eventKey) {
    const results = [];
    for (const item of data) {
      try {
        let instanceId = item.parent_inst_id || null;

        console.log("item.id (request_id):", item.id); // undefined
        console.log("item.user:", item.user);
        console.log("item.date:", item.date);
        console.log("item.products:", item.products);

        const source = (item.products || []).map((product) => ({
          source_id: product.sku_id,
          quantity: product.quantity,
          quantity_sisa: product.quantity_sisa,
        }));
        console.log("📥 Data source:", source);

        // Mengirim data ke Camunda untuk menyelesaikan task
        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {
              quantity_total: { value: item.quantity, type: "Integer" },
              Source: {
                value: JSON.stringify(source), // stringify jadi JSON string
                type: "String",
              },
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
          // Update untuk setiap produk (detail) secara individual
          for (const product of item.products) {
            const dataQuery = {
              graph: {
                method: "mutate",
                endpoint: GRAPHQL_API,
                gqlQuery: `
                  mutation MyMutation($request_id: Int!, $sku_id: String!, $user: String!, $date: timestamp!) {
                    update_mutasi_request_details(
                      where: { 
                        request_id: { _eq: $request_id }, 
                        sku_id: { _eq: $sku_id },
                        type: { _eq: "source" }
                      },
                      _set: { updated_by: $user, updated_at: $date }
                    ) {
                      affected_rows
                    }   
                  }
                `,
                variables: {
                  request_id: product.request_id, // ambil dari product
                  sku_id: product.sku_id,
                  user: item.updated_by, // ganti dari updated_by
                  date: item.updated_at, // ganti dari updated_at
                },
              },
              query: [],
            };

            const responseQuery = await configureQuery(fastify, dataQuery);
            console.log(
              `Updated mutasi_request_details for request_id ${product.request_id} and sku_id ${product.sku_id}`,
              responseQuery
            );
          }

          results.push({
            message: "Create event processed successfully",
            camunda: responseCamunda.data,
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
