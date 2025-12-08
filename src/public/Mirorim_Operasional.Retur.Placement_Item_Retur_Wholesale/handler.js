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
      try {
        const instanceId = item.proc_inst_id ?? null;

        // --- Kirim ke Camunda ---
        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: instanceId,
          variables: {
            variables: {
              adjustmentWholesale: {
                value: Boolean(item.adjustmentRetail),
                type: "Boolean",
              },
            },
          },
        };

        const responseCamunda = await camundaConfig(
          dataCamunda,
          instanceId,
          process
        );

        // --- Jika berhasil dari Camunda ---
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
          for (const product of item.products) {
            // Jika tidak ada adjustment retail, maka transfer stok
            if (!item.adjustmentRetail) {
              const transferPayload = {
                items: [
                  {
                    pk: Number(product.stock_item_wip),
                    quantity: product.quantity_placement,
                  },
                ],
                notes: `Transfer Retur Wholesale | Invoice: ${item.invoice} | Proc ID: ${item.proc_inst_id}`,
                location: product.location_id,
              };

              try {
                const { data: stockData } = await inventree.post(
                  "/stock/transfer/",
                  transferPayload
                );
                console.log("✅ Stock transfer success:", stockData);
              } catch (transferErr) {
                console.error("❌ Stock transfer error:", transferErr.message);
              }
            }

            // --- GraphQL Mutation ---
            dataQuery.push({
              graph: {
                method: "mutate",
                endpoint: GRAPHQL_API,
                gqlQuery: `
                  mutation UpdateQuantity($id: Int!, $quantity: Int!, $evidence: String!) {
                    update_mo_retur_placement(
                      where: { id: { _eq: $id } },
                      _set: { quantity_placement: $quantity, evidence: $evidence }
                    ) {
                      affected_rows
                    }
                  }
                `,
                variables: {
                  id: Number(product.id),
                  quantity: Number(product.quantity_placement),
                  evidence: item.evidence[0] || "",
                },
              },
              query: [],
            });
          }

          // --- Jalankan semua query sekaligus ---
          const responseQuery = await Promise.all(
            dataQuery.map((query) => configureQuery(fastify, query))
          );

          results.push({
            message: "✅ Event processed successfully",
            camunda: responseCamunda.data,
            database: responseQuery.map((r) => r.data),
          });
        }
      } catch (error) {
        console.error(
          `❌ Error executing handler for event: ${eventKey}`,
          error.message
        );
        results.push({ error: error.message });
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
    console.error(
      `❌ Error executing handler for event: ${eventKey}`,
      error.message
    );
    throw error;
  }
};

module.exports = { handle };
