const { Source } = require("graphql");
const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
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
          instance: item.proc_inst_id,
          variables: {
            variables: {
              compare_success: { value: item.compare_success, type: "boolean" },
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
                mutation MyMutation(
                  $id: Int!,
                  $qc_at: timestamp!,
                  $qc_by: String!,
                  $quantity_check: numeric!,
                  $reason: String!,
                  $source: String!,
                  $status: String!
                ) {
                  insert_manufacture_qc_items(
                    objects: {
                      manufacture_picking_items_id: $id,
                      qc_at: $qc_at,
                      qc_by: $qc_by,
                      quantity_check: $quantity_check,
                      reason: $reason,
                      source: $source,
                      status: $status
                    }
                  ) {
                    affected_rows
                  }
                }
              `,
              variables: {
                id: product.id,
                quantity_check: product.quantity_check || 0,
                reason: product.reason || "",
                qc_at: item.checked_at,
                qc_by: item.user_checker,
                source: 'Compare Manufacture',
                status: (product.quantity_check !== product.quantity || Boolean(product.action)) ? "Failed QC" : "Done QC"
              },
            },
            query: [],
          }));

          console.log("dataQuery", dataQuery);

          // Jalankan query GraphQL secara berurutan dengan for...of
          const responseQuery = [];
          for (const query of dataQuery) {
            try {
              const res = await configureQuery(fastify, query);
              responseQuery.push(res);
            } catch (err) {
              console.error("Error saat eksekusi query GraphQL:", err);
              throw err; // hentikan proses jika error
            }
          }

          console.log("responseQuery", responseQuery);

          results.push({
            message: "Create event processed successfully",
            camunda: responseCamunda.data,
            database: responseQuery,
          });
        }
      } catch (error) {
        console.error(`Error executing handler for event: onSubmit`, error);
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

  // Panggil handler yang sesuai
  try {
    return await eventHandlers[eventKey](data, process);
  } catch (error) {
    console.error(`Error executing handler for event: ${eventKey}`, error);
    throw error;
  }
};

module.exports = { handle };

