const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")();
const dotenv = require("dotenv");
const SERVER_INVENTREE = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;
const INVENTREE_LOCATION_WIP_INBOUND = process.env.INVENTREE_LOCATION_WIP_INBOUND;
const INVENTREE_LOCATION_WIP_RETAIL = process.env.INVENTREE_LOCATION_WIP_RETAIL;
const INVENTREE_LOCATION_WIP_WHOLESALE = process.env.INVENTREE_LOCATION_WIP_WHOLESALE;
const INVENTREE_LOCATION_WIP_REJECT = process.env.INVENTREE_LOCATION_WIP_REJECT;

const axios = require("axios");
const { transferStock } = require("../../utils/inventree/inventreeActions");

dotenv.config();
const GRAPHQL_API = process.env.GRAPHQL_API;

const eventHandlers = {
  async onSubmit(data, eventKey) {
    const results = [];

    for (const item of data) {
      try {
        const instanceId = item.proc_inst_id || null;

        const dataCamunda = {
          type: "start",
          endpoint: `/engine-rest/process-definition/key/Mirorim_Stock.Trigger_Staging_Inbound/start`,
          variables: {
            variables: {
              uniqueTrx: { value: item.unique_trx, type: "String" },
            },
            businessKey: `${item.unique_trx}:${item.created_at}:${item.created_by}`,
          },
        };

        const responseCamunda = await camundaConfig(dataCamunda, instanceId);

        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
              // const instanceId = responseCamunda.data.processInstanceId;

          const inventree = axios.create({
            baseURL: `${SERVER_INVENTREE}/api`,
            headers: {
              Authorization: `Token ${INVENTREE_API_TOKEN}`,
              "Content-Type": "application/json",
            },
            timeout: 10000,
          });

          const { data: stockItems } = await inventree.get(
            `/stock/?location=${INVENTREE_LOCATION_WIP_INBOUND}&part=${item.part_pk}&status=10`
          );

          const { data: stockItemsReject } = await inventree.get(
            `/stock/?location=${INVENTREE_LOCATION_WIP_INBOUND}&part=${item.part_pk}&status=65`
          );

          const stockItemId =
            stockItems.results.length > 0 ? stockItems.results[0].pk : null;
          const stockItemIdReject =
            stockItemsReject.results.length > 0
              ? stockItemsReject.results[0].pk
              : null;

          const dataQuery = [];

          // --- Loop untuk products ---
          for (const product of item.products) {
            // Grouping quantity berdasarkan type
            const groupedByType = {};

            for (const inbound of product.id_to_inboud_product_id) {
              const typeKey = inbound.type.toLowerCase();
              if (!groupedByType[typeKey]) {
                groupedByType[typeKey] = {
                  totalQuantity: 0,
                  type: inbound.type,
                  inbound_product_id: inbound.inbound_product_id,
                };
              }
              groupedByType[typeKey].totalQuantity += inbound.quantity_inbound;
            }

            // Loop hasil grouping untuk buat transfer payload dan query
            for (const [typeKey, group] of Object.entries(groupedByType)) {
              
              const locationId = group.type.toLowerCase() === "reject" ? INVENTREE_LOCATION_WIP_REJECT : group.type.toLowerCase() === "wholesale" ? INVENTREE_LOCATION_WIP_WHOLESALE : INVENTREE_LOCATION_WIP_RETAIL;
              const stockPk = group.type.toLowerCase() === "reject" ? stockItemIdReject : stockItemId
              const notes = `Transfer WIP Staging Inbound ${group.type}`

              // 🔄 Transfer Stock Item di Inventree
              const stockTransfer = await transferStock(
            stockPk,
            group.totalQuantity,
            locationId,
            notes
          );

            console.log("stock Transfer", stockTransfer);

              // 🔄 GraphQL mutate untuk update_mi_placement per type
              dataQuery.push({
                graph: {
                  method: "mutate",
                  endpoint: GRAPHQL_API,
                  gqlQuery: `mutation MyMutation($updated_at: timestamp!, $updated_by: String!, $type: String!, $id: Int!) {
  update_mi_placement(where: {type: {_eq: $type}, inbound_product_id: {_eq: $id}}, _set: {updated_at: $updated_at, updated_by: $updated_by}) {
    affected_rows
  }
}
`,
                  variables: {
                    updated_at: item.created_at,
                    updated_by: item.created_by,
                    type: group.type,
                    id: group.inbound_product_id,
                  },
                },
                query: [],
              });
            }
          }

          // Jalankan semua query secara paralel
          const responseQuery = await Promise.all(
            dataQuery.map((query) => configureQuery(fastify, query))
          );

          console.log("responseQuery", JSON.stringify(responseQuery, null, 2));

          results.push({
            message: "✅ Create event processed successfully",
            camunda: responseCamunda.data,
            database: responseQuery,
          });
        }
      } catch (error) {
  console.error(
    `❌ Error executing handler for event: ${eventKey}`,
    error
  );
  throw error;
}
    }

    return results;
  },

  async onChange(data) {
    console.log("⚙️ Handling onChange with data:", data);
    return { message: "onChange executed", data };
  },
};

/**
 * ⛓️ Handler utama
 */
const handle = async (eventData) => {
  const { eventKey, data } = eventData;
  console.log("📥 Received eventData", eventData);

  if (!eventHandlers[eventKey]) {
    throw new Error(`❌ No handler found for event: ${eventKey}`);
  }

  try {
    return await eventHandlers[eventKey](data, eventKey);
  } catch (error) {
    console.error(`❌ Error executing handler for event: ${eventKey}`, error);
    throw error;
  }
};

module.exports = { handle };
