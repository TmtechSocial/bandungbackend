const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const GRAPHQL_API = process.env.GRAPHQL_API;
const SERVER_INVENTREE = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;
const INVENTREE_LOCATION_WIP_WHOLESALE = process.env.INVENTREE_LOCATION_WIP_WHOLESALE;
const { transferStock } = require("../../utils/inventree/inventreeActions");
const axios = require("axios");

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];

    for (const item of data) {
      try {
        const instanceId = item.proc_inst_id || null;
        const evidence = JSON.stringify(item.evidence) ||  [];

        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {
              evidence_placement_inbound_wholesale: { value: evidence, type: "String" },
            },
          },
        };

        const responseCamunda = await camundaConfig(
          dataCamunda,
          instanceId,
          process
        );

        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          const inventree = axios.create({
            baseURL: `${SERVER_INVENTREE}/api`,
            headers: {
              Authorization: `Token ${INVENTREE_API_TOKEN}`,
              "Content-Type": "application/json",
            },
            timeout: 10000,
          });

          const { data: stockItems } = await inventree.get(
            `/stock/?location=${INVENTREE_LOCATION_WIP_WHOLESALE}&part=${item.part_pk}&status=10`
          );

          const stockItemId = stockItems.results.length > 0 ? stockItems.results[0].pk : null;

          const dataQuery = [];

          // --- Loop untuk existing products ---
          for (const product of item.products) {
            const quantity = product.quantity_placement;
            const locationId = product.location_id;
            const notes = `Transfer Inbound Wholesale | Proc ID: ${item.proc_inst_id}`;
            // 🔄 Transfer Stock Item di Inventree

            const stockTransfer = await transferStock(
            stockItemId,
            quantity,
            locationId,
            notes
          );

            console.log("stock Transfer", stockTransfer);

            dataQuery.push({
              graph: {
                method: "mutate",
                endpoint: GRAPHQL_API,
                gqlQuery: `mutation MyMutation(
  $updated_at: timestamp!, 
  $updated_by: String!, 
  $id: Int!, 
  $quantity: Int!
) {
  update_mi_placement(
    where: {id: {_eq: $id}}, 
    _set: {
      quantity_placement: $quantity, 
      updated_at: $updated_at, 
      updated_by: $updated_by
    }
  ) {
    affected_rows
  }
}
`,
                variables: {
                  updated_at: item.updated_at,
                  updated_by: item.updated_by,
                  id: product.id,
                  quantity: product.quantity_placement,
                },
              },
              query: [],
            });
          }
          console.log("dataQuery", JSON.stringify(dataQuery, null, 2));

          // Jalankan semua query secara paralel
          const responseQuery = await Promise.all(
            dataQuery.map((query) => configureQuery(fastify, query))
          );

          console.log("responseQuery", JSON.stringify(responseQuery, null, 2));

          results.push({
            message: "Create event processed successfully",
            camunda: responseCamunda.data,
            database: responseQuery.map((r) => r.data),
          });
        }
      } catch (error) {
        console.error(
          `❌ Error executing handler for event: ${error.message}`,
          error
        );
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
