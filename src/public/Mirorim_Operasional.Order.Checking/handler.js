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

        const quantityOrders = item.products.map(product => product.quantity_order);
        const quantityChecks = item.products.map(product => product.quantity_check);
        
        console.log("Isi quantity_order:", quantityOrders);
        console.log("Isi quantity_check:", quantityChecks);


        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {
              quantity_order: { value: quantityOrders, type: "String" },
              quantity_check: { value: quantityChecks, type: "String" },
            },
          },
        };
        
        const responseCamunda = await camundaConfig(dataCamunda, instanceId, process);
        console.log("responseCamunda", responseCamunda);
        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          let responseQuery;
          for (const itemData of item.products) {
            console.log("itemData", itemData.action);
            if (itemData.action) {
              responseQuery = await configureQuery(fastify, {
                graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `mutation MyMutation($proc_inst_id: String!, $sku_toko: String!, $quantity_check: Int!, $time_stamp_check: timestamp!, $date: timestamp!, $task: String!, $notes: String!, $item_mismatch: Boolean!, $user_checker: String!) { update_mo_order_shop(where: {proc_inst_id: {_eq: $proc_inst_id}, sku_toko: {_eq: $sku_toko}}, _set: {quantity_check: $quantity_check, notes: $notes, item_mismatch: $item_mismatch}) { affected_rows } update_mo_order(where: {proc_inst_id: {_eq: $proc_inst_id}}, _set: {checked_at: $date, task_def_key: $task, user_checker: $user_checker, time_stamp_check: $time_stamp_check}) { affected_rows } }`,
              variables: {
                proc_inst_id: instanceId,
                date: item.checked_at,
                sku_toko: itemData.sku_toko,
		quantity_check: itemData.quantity_check ?? 0,
                item_mismatch: itemData.action,
                notes: itemData.notes,
                user_checker: item.user_checker,
                time_stamp_check: item.time_stamp_check,
                task: item.products.some(itemData => itemData.quantity_order !== itemData.quantity_check)
  ? "Mirorim_Operasional.Order.Wasit"
  : "Mirorim_Operasional.Order.Packing"
              }
            },
            query: [],
          }
              )
            }else{
              responseQuery = await configureQuery(fastify,{
                graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `mutation MyMutation($proc_inst_id: String!, $sku_toko: String!, $quantity_check: Int!, $time_stamp_check: timestamp!, $date: timestamp!, $task: String!, $user_checker: String!) { update_mo_order_shop(where: {proc_inst_id: {_eq: $proc_inst_id}, sku_toko: {_eq: $sku_toko}}, _set: {quantity_check: $quantity_check}) { affected_rows } update_mo_order(where: {proc_inst_id: {_eq: $proc_inst_id}}, _set: {checked_at: $date, task_def_key: $task, user_checker: $user_checker, time_stamp_check: $time_stamp_check}) { affected_rows } }`,
              variables: {
                proc_inst_id: instanceId,
                date: item.checked_at,
                sku_toko: itemData.sku_toko,
		quantity_check: itemData.quantity_check ?? 0,
                user_checker: item.user_checker,
                time_stamp_check: item.time_stamp_check,
                task: item.products.some(itemData => itemData.quantity_order !== itemData.quantity_check)
  ? "Mirorim_Operasional.Order.Wasit"
  : "Mirorim_Operasional.Order.Packing"
              }
            },
            query: [],
          }
              )
            }
          }

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
