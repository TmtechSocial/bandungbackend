const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")();
const dotenv = require("dotenv");
const axios = require("axios");

dotenv.config();

const GRAPHQL_API = process.env.GRAPHQL_API;
const SERVER_INVENTREE = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;

const eventHandlers = {
  async onSubmit(data, process, eventKey) {
    const results = [];

    for (const item of data) {
      const instanceId = item.proc_inst_id ?? null;

      try {
        // --- Kirim ke Camunda ---
        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: instanceId,
          variables: {
            variables: {
              adjustmentRetail: {
                value: Boolean(item.adjustmentRetail),
                type: "Boolean",
              },
            },
          },
        };

        const responseCamunda = await camundaConfig(dataCamunda, instanceId, process);

        // --- Jika Camunda sukses ---
        if ([200, 204].includes(responseCamunda.status)) {
          const inventree = axios.create({
            baseURL: `${SERVER_INVENTREE}/api`,
            headers: {
              Authorization: `Token ${INVENTREE_API_TOKEN}`,
              "Content-Type": "application/json",
            },
            timeout: 10000,
          });

          const dataQuery = [];

          // --- Loop produk ---
          for (const product of item.products || []) {
            try {
              // --- Jika tidak ada adjustmentRetail, maka lakukan transfer stok ---
              if (!item.adjustmentRetail) {
                const today = new Date();
const batchDate = `${String(today.getDate()).padStart(2, "0")}-${String(
  today.getMonth() + 1
).padStart(2, "0")}-${today.getFullYear()}`;

                const transferPayload = {
                  items: [
                    {
                      pk: Number(product.stock_item_wip),
                      batch: batchDate,
                      quantity: Number(product.quantity_placement),
                    },
                  ],
                  notes: `Transfer Retur Retail | Invoice: ${item.invoice} | Proc ID: ${item.proc_inst_id}`,
                  location: product.location_id,
                };

                // --- Lakukan transfer stok ---
                const { data: stockTransfer } = await inventree.post(
                  "/stock/transfer/",
                  transferPayload
                );
                console.log("✅ Stock transfer success:", stockTransfer);

                // --- Ambil stok di lokasi tujuan ---
                const { data: stockItems } = await inventree.get(
                  `/stock/?location=${product.location_id}&part=${product.part_pk}`
                );

                const stockPKs =
                  stockItems?.results?.map((stock) => stock.pk).filter(Boolean) || [];

                if (stockPKs.length > 0) {
                  const mergePayload = {
                    items: stockPKs.map((pk) => ({ item: pk })),
                    location: product.location_id,
                    notes: `Merge stok Retail Retur | Proc inst ID: ${item.proc_inst_id}`,
                  };

                  console.log("📦 mergePayload:", JSON.stringify(mergePayload, null, 2));

                  await inventree.post(`/stock/merge/`, mergePayload);
                } else {
                  console.warn(
                    `⚠️ Tidak ada stok ditemukan untuk merge di lokasi ${product.location_id} part ${product.part_pk}`
                  );
                }

              }

              // --- Tambahkan GraphQL Mutation ---
              dataQuery.push({
                graph: {
                  method: "mutate",
                  endpoint: GRAPHQL_API,
                  gqlQuery: `
                    mutation UpdateQuantity($id: Int!, $quantity: Int!) {
                      update_mo_retur_placement(
                        where: { id: { _eq: $id } },
                        _set: { quantity_placement: $quantity }
                      ) {
                        affected_rows
                      }
                    }
                  `,
                  variables: {
                    id: Number(product.id),
                    quantity: Number(product.quantity_placement),
                  },
                },
                query: [],
              });
            } catch (productError) {
              console.error(
                `❌ Error memproses produk ${product.part_pk}:`,
                productError.response?.data || productError.message
              );
            }
          }

          // --- Jalankan semua query GraphQL secara paralel ---
          const responseQuery = await Promise.all(
            dataQuery.map((query) => configureQuery(fastify, query))
          );

          results.push({
            message: "✅ Event processed successfully",
            camunda: responseCamunda.data,
            database: responseQuery.map((r) => r.data),
          });
        } else {
          console.warn(`⚠️ Camunda response status: ${responseCamunda.status}`);
        }
      } catch (error) {
        console.error(`❌ Error executing handler for event: ${eventKey}`, error);
        results.push({ error: error.message, instanceId });
      }
    }

    return results;
  },

  async onChange(data) {
    console.log("⚙️ Handling onChange with data:", data);
    return { message: "onChange executed", data };
  },
};

// --- Main handler ---
const handle = async (eventData) => {
  const { eventKey, data, process } = eventData;
  console.log("📦 Received eventData:", eventData);

  if (!eventHandlers[eventKey]) {
    throw new Error(`No handler found for event: ${eventKey}`);
  }

  try {
    return await eventHandlers[eventKey](data, process, eventKey);
  } catch (error) {
    console.error(`❌ Error executing handler for event: ${eventKey}`, error);
    throw error;
  }
};

module.exports = { handle };
