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
        const oldPartIds = (item.products || []).map(p => p.part_pk);
console.log("oldPartIds", oldPartIds);

const newPartIds = (item.new_products || []).map(p => p.new_part_pk);
console.log("newPartIds", newPartIds);

         const partIds = [...oldPartIds, ...newPartIds];
         console.log("partIds", partIds);
         
        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {
              part_ids: {
        value: JSON.stringify(partIds), // ⬅️ stringify array
        type: "Object",
        valueInfo: {
          objectTypeName: "java.util.ArrayList",
          serializationDataFormat: "application/json",
        },
      },
            },
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
                    $task_def_key: String!
                  ) {
                    insert_mi_logs(
                      objects: {
                        created_at: $created_at, 
                        created_by: $created_by, 
                        invoice: $invoice, 
                        part_pk: $part,
                        task_def_key: $task_def_key
                      }
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
                  part: product.part_pk
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
                      $unit: String!,
                      $new_product: Boolean!
                    ) {
                      insert_mi_products(
                        objects: {
                          created_at: $created_at, 
                          created_by: $created_by, 
                          invoice: $invoice, 
                          part_pk: $part,
                          quantity_order: $quantity, 
                          unit: $unit,
                          new_product: $new_product
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
                    new_product: true
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
