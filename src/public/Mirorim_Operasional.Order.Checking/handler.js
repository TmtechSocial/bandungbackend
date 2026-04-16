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
const productsPayload = item.products.map(product => ({
  sku_toko: product.sku_toko,
  quantity_order: product.quantity_order,
  part_pk: product.part_pk,
  weight_per_pcs: product.weight_per_pcs,
  product_tolerance: product.product_tolerance,
  threshold_per_item: product.threshold_per_item,
  unit_berat: product.unit_berat,
  tipe_berat: product.tipe_berat,
  quantity_convert: product.quantity_convert,
  action: product.action,
  is_valid_check: product.is_valid_check,
  quantity_check: product.quantity_check,
  quantity_convert_result: product.quantity_convert_result,
}));

        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {
              all_products_valid: { value: item.all_products_valid, type: "Boolean" },
              products_payload: { value: JSON.stringify(productsPayload), type: "Object",
          valueInfo: {
            serializationDataFormat: "application/json",
            objectTypeName: "java.util.ArrayList",
          },
        }
            },
          },
        };

        const responseCamunda = await camundaConfig(dataCamunda, instanceId, process);
        console.log("responseCamunda", responseCamunda);
        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          let responseQuery;

          const nextTask = item.all_products_valid
              ? "Mirorim_Operasional.Order.Packing"
              : "Mirorim_Operasional.Order.Wasit";

          for (const product of item.products) {
              const finalQuantityCheck = product.item_valid === true ? product.quantity_checked : product.quantity_convert_result || 0;
              console.log("finalQuantityCheck", finalQuantityCheck); // finalQuantityCheck

            if (product.action) {
              responseQuery = await configureQuery(fastify, {
                graph: {
                  method: "mutate",
                  endpoint: GRAPHQL_API,
                  gqlQuery: `mutation MyMutation($proc_inst_id: String!, $sku_toko: String!, $quantity_check: Int, $time_stamp_check: timestamp!, $date: timestamp!, $task: String!, $notes: String!, $item_mismatch: Boolean!, $item_valid: Boolean!, $user_checker: String!, $input_type: String!) {
                              update_mo_order_shop(where: {proc_inst_id: {_eq: $proc_inst_id}, sku_toko: {_eq: $sku_toko}}, _set: {quantity_check: $quantity_check, notes: $notes, item_mismatch: $item_mismatch, item_valid: $item_valid, input_type: $input_type}) {
                                affected_rows
                              }
                              update_mo_order(where: {proc_inst_id: {_eq: $proc_inst_id}}, _set: {checked_at: $date, task_def_key: $task, user_checker: $user_checker, time_stamp_check: $time_stamp_check}) {
                                affected_rows
                              }
                            }
`,
                  variables: {
                    proc_inst_id: instanceId,
                    date: item.checked_at,
                    sku_toko: product.sku_toko,
                    quantity_check: finalQuantityCheck,
                    item_mismatch: product.action,
                    item_valid: product.is_valid_check,
                    notes: product.notes,
                    user_checker: item.user_checker,
                    input_type: product.unit_berat,
                    time_stamp_check: item.time_stamp_check,
                    task: nextTask
                  }
                },
                query: [],
              }
              )
            } else {
              responseQuery = await configureQuery(fastify, {
                graph: {
                  method: "mutate",
                  endpoint: GRAPHQL_API,
                  gqlQuery: `mutation MyMutation($proc_inst_id: String!, $sku_toko: String!, $quantity_check: Int, $time_stamp_check: timestamp!, $date: timestamp!, $task: String!, $user_checker: String!, $item_valid: Boolean!, $input_type: String!) {
                              update_mo_order_shop(where: {proc_inst_id: {_eq: $proc_inst_id}, sku_toko: {_eq: $sku_toko}}, _set: {quantity_check: $quantity_check, item_valid: $item_valid, input_type: $input_type}) {
                                affected_rows
                              }
                              update_mo_order(where: {proc_inst_id: {_eq: $proc_inst_id}}, _set: {checked_at: $date, task_def_key: $task, user_checker: $user_checker, time_stamp_check: $time_stamp_check}) {
                                affected_rows
                              }
                            }
`,
                  variables: {
                    proc_inst_id: instanceId,
                    date: item.checked_at,
                    sku_toko: product.sku_toko,
                    quantity_check: finalQuantityCheck,
                    user_checker: item.user_checker,
                    item_valid: product.is_valid_check,
                    input_type: product.unit_berat,
                    time_stamp_check: item.time_stamp_check,
                    task: nextTask
                  }
                },
                query: [],
              }
              )
            }

            if (!responseQuery || !responseQuery.data) {
              throw new Error(`Failed to update database for sku_toko: ${product.sku_toko}`);
            }
          }

          results.push({
            message: "Create event processed successfully",
            database: responseQuery.data,
          });
        } else {
          throw new Error(`Camunda task completion failed with status: ${responseCamunda.status}`);
        }
      } catch (error) {
        console.error(`Error executing handler for event onSubmit:`, error);
        console.log(`graphql error:`, error.dataQuery || error.message);

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
