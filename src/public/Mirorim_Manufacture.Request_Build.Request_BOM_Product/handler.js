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
        let instanceId = item.parent_inst_id || null; 

        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.parent_inst_id,
          variables: {
            variables: {
              parent_inst_id: { value: item.parent_inst_id, type: "String" },
              date_request: { value: item.bom_requested_at, type: "String" }
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
              gqlQuery: `mutation InsertManufacturePick($proc_inst_id: String!, $sub_part_id: Int!, $date: timestamp!, $bo_id: Int!, $quantity: numeric!) { insert_manufacture_picking_items(objects: {part_id: $sub_part_id, build_order_id: $bo_id, quantity: $quantity}) { affected_rows } update_manufacture_request(where: {parent_inst_id: {_eq: $proc_inst_id}}, _set: {bom_requested_at: $date}) { affected_rows } }`,
              variables: {
                proc_inst_id: instanceId,
                bo_id: item.id,
                date: item.bom_requested_at,
                sub_part_id: product.sub_part_id,
                quantity: product.quantity_request_bom
              }
            },
            query: [],
          }));

          console.log("dataQuery", dataQuery);

          // Jalankan semua query secara paralel
          const responseQuery = await Promise.all(
            dataQuery.map(query => configureQuery(fastify, query))
          );

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
