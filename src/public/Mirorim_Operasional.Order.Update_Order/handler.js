const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const GRAPHQL_API = process.env.GRAPHQL_API

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];
    for (const item of data) {
      try {
        let taskId;
        let instanceId = item.proc_inst_id || null;

        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {
              items: {
                value: JSON.stringify(
                  item.products.map(product => ({
                    before: {
                      sku_toko: product.sku_toko,
                      quantity_order: product.quantity_order,
                    },
                    after: {
                      sku_toko: product.sku_toko_change,
                      quantity_order: product.quantity_order_change,
                    }
                  }))
                ),
                type: "Json"
              },
              refund_decision: { value: item.refund_decision, type: "String" }
            },
          },
        };

        const responseCamunda = await camundaConfig(dataCamunda, instanceId, process);
        if (responseCamunda.status === 200 || responseCamunda.status === 204) {

          const dataQuery = [];

          // Looping semua products
          for (const product of item.products) {
            let quantity_convert = product.quantity_order_change;

            // bikin sku lowercase
            const skuLower = product.sku_toko.toLowerCase();

            // cari angka setelah "pack-"
            const match = skuLower.match(/pack-(\d+)/);
            
            if (match) {
              const packSize = parseInt(match[1], 10);
              quantity_convert = packSize * product.quantity_order_change;
            }

            dataQuery.push({
              graph: {
                method: "mutate",
                endpoint: GRAPHQL_API,
                gqlQuery: `mutation MyMutation(
                  $proc_inst_id: String!, 
                  $sku_toko: String!, 
                  $quantity_order: Int!, 
                  $quantity_change: Int!, 
                  $picked_status: String, 
                  $task: String!
                ) { 
                  update_mo_order_shop(
                    where: {proc_inst_id: {_eq: $proc_inst_id}, sku_toko: {_eq: $sku_toko}}, 
                    _set: {
                      quantity_order: $quantity_order, 
                      quantity_convert: $quantity_change, 
                      picked_status : $picked_status
                    }
                  ) { affected_rows } 
                  update_mo_order(
                    where: {proc_inst_id: {_eq: $proc_inst_id}}, 
                    _set: {task_def_key: $task}
                  ) { affected_rows } 
                }`,
                variables: {
                  proc_inst_id: instanceId,
                  sku_toko: product.sku_toko,
                  quantity_order: product.quantity_order_change,
                  quantity_change: quantity_convert,
                  picked_status: product.quantity_order_change === 0 ? "picked" : product.quantity_order_change !== product.quantity_order ? null : "picked",
                  task:
                    item.refund_decision === "picker"
                      ? "Mirorim_Operasional.Order.Adjustment_Order"
                      : "Mirorim_Operasional.Order.Box",
                },
              },
              query: [],
            });
          }

          const responseQuery = await Promise.all(
            dataQuery.map(query => configureQuery(fastify, query))
          );

          // const responseQuery = await configureQuery(fastify, dataQuery);
console.log("response detail:", JSON.stringify(responseQuery, null, 2));

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
