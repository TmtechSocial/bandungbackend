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


        console.log("item", item);
        

        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {
            },
          },
        };
        
        const responseCamunda = await camundaConfig(dataCamunda, instanceId, process);
        console.log("responseCamunda", responseCamunda);
        if (responseCamunda.status === 200 || responseCamunda.status === 204) {

          // const dataQuery = {
          //   graph: {
          //     method: "mutate",
          //     endpoint: GRAPHQL_API,
          //     gqlQuery: `mutation MyMutation($proc_inst_id: String!, $sku_toko: String!, $status_picked: String!) { update_mo_order(where: { proc_inst_id: { _eq: $proc_inst_id }, sku_toko: { _eq: $sku_toko } }, _set: { picked_status: $status_picked }) { affected_rows } }`,
          //     variables: {
          //       test_loop: item.products.length > 0
          //         ? item.products
          //             .filter(product => product.check === true) // Filter products where checkbox is true
          //             .map(product => ({
          //               proc_inst_id: instanceId,
          //               sku_toko: product.sku_toko,
          //               status_picked: "picked" // Set the status picked to 'picked' for these items
          //             }))
          //         : []
          //     }
          //   },
          //   query: [],
          // };
          // console.log("item.products", item.products);

          const dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `mutation MyMutation($proc_inst_id: String!, $sku_toko: String!, $status_picked: String!) { update_mo_order_shop( where: { proc_inst_id: { _eq: $proc_inst_id }, sku_toko: { _eq: $sku_toko }}, _set: { picked_status: $status_picked } ) { affected_rows }}`,
              variables: {
                proc_inst_id: instanceId,
                sku_toko: product.sku_toko,
                status_picked: "picked"
              }
            },
            query: [],
          };

          console.log("dataQuery", dataQuery);

          // Jalankan semua query secara paralel
        //   const responseQuery = await configureQuery(fastify, dataQuery);

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
