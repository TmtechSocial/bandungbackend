const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const GRAPHQL_API = process.env.GRAPHQL_API;

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
          const dataQuery = [];

          // --- Loop untuk existing products ---
          for (const product of item.products) {
            dataQuery.push({
              graph: {
                method: "mutate",
                endpoint: GRAPHQL_API,
                gqlQuery: `
                  mutation MyMutation(
                    $created_at: timestamp!, 
                    $created_by: String!, 
                    $invoice: String!, 
                    $part: Int!, 
                    $quantity: Int!, 
                    $task_def_key: String!
                  ) {
                    insert_mi_logs(
                      objects: {
                        created_at: $created_at, 
                        created_by: $created_by, 
                        invoice: $invoice, 
                        part_pk: $part, 
                        quantity: $quantity, 
                        task_def_key: $task_def_key
                      }
                    ) {
                      affected_rows
                    }
                    update_mi_products(
                      where: {part_pk: {_eq: $part}, invoice: {_eq: $invoice}}, 
                      _set: {quantity_received: $quantity}
                    ) {
                      affected_rows
                    }
                  }
                `,
                variables: {
                  created_at: item.created_at,
                  created_by: item.created_by,
                  task_def_key: "Mirorim_Stock.Inbound_Process.Konversi_Item",
                  invoice: item.invoice,
                  part: product.part_pk,
                  quantity: product.quantity_received,
                },
              },
              query: [],
            });
          }

          // --- Loop untuk new_products (hanya kalau ada datanya) ---
          if (
            item.new_products &&
            Array.isArray(item.new_products) &&
            item.new_products.length > 0
          ) {
            for (const newProduct of item.new_products) {
              dataQuery.push({
                graph: {
                  method: "mutate",
                  endpoint: GRAPHQL_API,
                  gqlQuery: `
                    mutation InsertNewProduct(
                      $created_at: timestamp!, 
                      $created_by: String!, 
                      $invoice: String!, 
                      $part: Int!,
                      $quantity: Int!, 
                      $unit: String!
                    ) {
                      insert_mi_products(
                        objects: {
                          created_at: $created_at, 
                          created_by: $created_by, 
                          invoice: $invoice, 
                          part_pk: $part,
                          quantity_received: $quantity, 
                          unit: $unit
                        }
                      ) {
                        affected_rows
                      }
                    }
                  `,
                  variables: {
                    created_at: item.created_at,
                    created_by: item.created_by,
                    invoice: item.invoice,
                    part: newProduct.new_part_pk,
                    quantity: newProduct.quantity,
                    unit: newProduct.unit || "pcs",
                  },
                },
                query: [],
              });
            }
          }

          console.log("dataQuery", dataQuery);

          // Jalankan semua query secara paralel
          const responseQuery = await Promise.all(
            dataQuery.map((query) => configureQuery(fastify, query))
          );

          console.log("responseQuery", responseQuery);

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
