const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")();
const dotenv = require("dotenv");
const axios = require("axios");

dotenv.config();

const SERVER_INVENTREE = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;
const GRAPHQL_API = process.env.GRAPHQL_API;

// 🔧 Axios instance untuk Inventree
const inventree = axios.create({
  baseURL: `${SERVER_INVENTREE}/api`,
  headers: {
    Authorization: `Token ${INVENTREE_API_TOKEN}`,
    "Content-Type": "application/json",
  },
});

const eventHandlers = {
  async onSubmit(data, eventKey) {
    const results = [];

    for (const item of data) {
      try {
        const instanceId = item.proc_inst_id || null;
        let wip = 0;
        if (item.trx_prefix === "RR") wip = 1000003;
        else if (item.trx_prefix === "RW") wip = 1000002;
        else if (item.trx_prefix === "RJ") wip = 6224;
        // 🔄 Start Camunda process
        const dataCamunda = {
          type: "start",
          endpoint: `/engine-rest/process-definition/key/Mirorim_Operasional.Trigger_Staging_Placement_Retur/start`,
          variables: {
            variables: {
              uniqueTrx: { value: item.unique_trx, type: "String" },
            },
          },
        };
        const responseCamunda = await camundaConfig(dataCamunda, instanceId);
        if (responseCamunda?.status === 200 || responseCamunda?.status === 204) {
          console.log("products", item.products);
          for (const product of item.products) {
            try {
              // 🚚 Transfer stok ke lokasi WIP
              const transferBody = {
                items: [
                  {
                    pk: product.stock_item_wip,
                    quantity: product.quantity_distributed,
                  },
                ],
                location: wip,
                notes: `Transfer Retur Ke WIP AREA untuk resi ${product.resi_retur}`,
              };

              const transferRes = await inventree.post(`/stock/transfer/`, transferBody);
              console.log(`🚚 Transfer success untuk ${product.product_name}:`, transferRes.status);
              const stockUrl = `/stock/?batch=${product.invoice}&part=${product.part_pk}&location=${wip}&ordering=-updated`;
              console.log("🔎 GET:", stockUrl);
              const stockRes = await inventree.get(stockUrl);
              const stocks = stockRes.data?.results || stockRes.data;
              if (!stocks || stocks.length === 0) {
                console.warn(`⚠️ Tidak ada stok ditemukan untuk part_pk ${product.part_pk} dan batch ${product.invoice}`);
                continue;
              }
              const stockPk = stocks[0].pk;
              const updateQuery = {
                graph: {
                  method: "mutate",
                  endpoint: GRAPHQL_API,
                  gqlQuery: `
                    mutation updateWipRetur($unique_trx: String!, $mo_retur_id: Int!, $stock_item_wip: Int!) {
                      update_mo_retur_placement(
                        where: { unique_trx: { _eq: $unique_trx }, mo_retur_id: { _eq: $mo_retur_id } },
                        _set: { stock_item_wip: $stock_item_wip }
                      ) {
                        affected_rows
                      }
                    }
                  `,
                  variables: {
                    unique_trx: item.unique_trx,
                    mo_retur_id: product.mo_retur_id,
                    stock_item_wip: stockPk,
                  },
                },
                query: [],
              };

              const responseQuery = await configureQuery(fastify, updateQuery);
              console.log(`🧩 Update berhasil untuk invoice ${product.invoice} part_pk ${product.part_pk}`);

              results.push({
                message: `✅ Transfer & update sukses untuk ${product.product_name}`,
                camunda: responseCamunda.data,
                database: responseQuery,
              });
            } catch (err) {
              console.error(`❌ Error transfer part ${product.part_pk}:`, err.response?.data || err.message);
            }
          }
        } else {
          console.warn(`⚠️ Camunda process gagal dijalankan untuk ${item.unique_trx}`);
        }
      } catch (error) {
        console.error(`❌ Error executing handler for event: ${eventKey}`, error);
        results.push({
          message: "❌ Failed to process item",
          error: error.message,
          item,
        });
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
  console.log("📥 Received eventData:", eventData);

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
