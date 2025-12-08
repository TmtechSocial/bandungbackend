const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")();
const dotenv = require("dotenv");
const SERVER_INVENTREE = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;
const axios = require("axios");

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
          endpoint: `/engine-rest/process-definition/key/Mirorim_Stock.Trigger_Staging_Area_Retail/start`,
          variables: {
            variables: {
              invoice: { value: item.invoice, type: "String" },
              part_id: { value: item.part_pk, type: "Integer" },
            },
            businessKey: `${item.proc_inst_id}:${item.created_at}:${item.created_by}`,
          },
        };

        const responseCamunda = await camundaConfig(dataCamunda, instanceId);
        console.log("✅ Camunda response", responseCamunda?.data || responseCamunda);

        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
        //     const instanceId = responseCamunda.data.processInstanceId;

          const inventree = axios.create({
            baseURL: `${SERVER_INVENTREE}/api`,
            headers: {
              Authorization: `Token ${INVENTREE_API_TOKEN}`,
              "Content-Type": "application/json",
            },
            timeout: 10000,
          });

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
              const status = group.type.toLowerCase() === "reject" ? 65 : 10;

              // 🔄 Transfer Stock Item di Inventree
              const transferPayload = {
                items: [
                  {
                    pk: Number(product.stock_item_id),
                    quantity: group.totalQuantity,
                    status: status,
                  },
                ],
                notes: `Transfer WIP Staging Retail | Proc ID: ${item.proc_inst_id}`,
                location: 1000003,
              };

              const { data: stockData } = await inventree.post(
                "/stock/transfer/",
                transferPayload
              );

              console.log("stockData", stockData);

              // 🔎 Ambil stock terbaru dari lokasi & part
              const { data: getData } = await inventree.get(
                `/stock/?location=1000003&part=${item.part_pk}&ordering=-updated&limit=1`
              );

              // Tentukan stock_item_id baru
              let newStockItemId = null;
              if (getData?.results?.length > 0) {
                newStockItemId = getData.results[0].pk;
              }

              console.log("newwwwwstockkk", newStockItemId);

              // 🔄 GraphQL mutate untuk update_mi_placement per type
              dataQuery.push({
                graph: {
                  method: "mutate",
                  endpoint: GRAPHQL_API,
                  gqlQuery: `mutation MyMutation($updated_at: timestamp!, $updated_by: String!, $type: String!, $stock_item_id: Int!, $id: Int!) {
  update_mi_placement(where: {type: {_eq: $type}, inbound_product_id: {_eq: $id}}, _set: {stock_item_id: $stock_item_id, updated_at: $updated_at, updated_by: $updated_by}) {
    affected_rows
  }
}
`,
                  variables: {
                    updated_at: item.created_at,
                    updated_by: item.created_by,
                    type: group.type, // dari grouping
                    stock_item_id: newStockItemId,
                    id: group.inbound_product_id,
                  },
                },
                query: [],
              });
            }
          }

          console.log("dataQuery", JSON.stringify(dataQuery, null, 2));

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

