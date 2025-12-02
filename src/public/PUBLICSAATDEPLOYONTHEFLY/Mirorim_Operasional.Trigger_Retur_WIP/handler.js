const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")();
const axios = require("axios");
const GRAPHQL_API = process.env.GRAPHQL_API;
const SERVER_INVENTREE = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;

const eventHandlers = {
  async onSubmit(data) {
    const results = [];

    for (const item of data) {
      try {
        const instanceId = item.proc_inst_id || null;

        // 🔹 setup axios instance untuk Inventree
        const inventree = axios.create({
          baseURL: `${SERVER_INVENTREE}/api`,
          headers: {
            Authorization: `Token ${INVENTREE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          timeout: 10000,
        });

        // 🔹 1. Cek apakah resi valid (belum diproses)
        const checkQuery = {
          graph: {
            method: "query",
            endpoint: GRAPHQL_API,
            gqlQuery: `
              query MyQuery($resi_retur: String!) {
                mo_retur_receive(
                  where: {
                    resi_retur: { _eq: $resi_retur },
                    status_staging: { _is_null: true }
                  }
                ) {
                  invoice
                  resi_retur
                }
              }
            `,
            variables: { resi_retur: item.resi_retur },
          },
          query: [],
        };

        const checkResponse = await configureQuery(fastify, checkQuery);
        const checkData = checkResponse.data[0].graph;
        const moRetur = checkData.mo_retur_receive || [];

        if (moRetur.length === 0) {
          throw new Error(`Resi ${item.resi_retur} tidak ditemukan atau sudah diproses`);
        }

        const dataCamunda = {
          type: "start",
          endpoint: `/engine-rest/process-definition/key/Mirorim_Operasional.Trigger_Retur_WIP/start`,
          variables: {
            variables: {
              resi_retur: { value: item.resi_retur, type: "String" },
            },
          },
        };
        const responseCamunda = await camundaConfig(dataCamunda, instanceId);
        console.log("🌀 responseCamunda:", responseCamunda.status);
        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          console.log("✅ Camunda berhasil dijalankan untuk resi:", item.resi_retur);
          for (const product of item.products) {
            try {
              const stockUrl = `/stock/?batch=${product.invoice}&part=${product.part_pk}&location=6217&ordering=-updated`;
              console.log("🔎 GET:", stockUrl);

              const stockRes = await inventree.get(stockUrl);
              const stocks = stockRes.data?.results || stockRes.data;

              if (!stocks || stocks.length === 0) {
                console.warn(`⚠️ Tidak ada stok ditemukan untuk part_pk ${product.part_pk} dan batch ${product.invoice}`);
                continue;
              }

              const stockPk = stocks[0].pk;
              console.log(`✅ Stock PK ditemukan: ${stockPk}`);
              const transferBody = {
                items: [
                  {
                    pk: stockPk,
                    quantity: product.quantity_retur,
                  },
                ],
                location: 6223,
                notes: `Transfer retur untuk resi ${product.resi_retur}`,
              };

              const transferRes = await inventree.post(`/stock/transfer/`, transferBody);
              console.log(`🚚 Transfer success untuk ${product.product_name}:`, transferRes.status);
              const updateQuery = {
                graph: {
                  method: "mutate",
                  endpoint: GRAPHQL_API,
                  gqlQuery: `
                  mutation updateWipRetur($invoice: String!, $part_pk: Int!, $stock_item_wip: Int!) {
                    update_mo_retur(
                      where: { invoice: { _eq: $invoice }, part_pk: { _eq: $part_pk } },
                      _set: { stock_item_wip: $stock_item_wip }
                    ) {
                      affected_rows
                    }
                  }
        `,
                  variables: {
                    invoice: product.invoice,
                    part_pk: product.part_pk,
                    stock_item_wip: stockPk,
                  },
                },
                query: [],
              };
              await configureQuery(fastify, updateQuery);
              console.log(`🧩 Update berhasil untuk invoice ${product.invoice} part_pk ${product.part_pk}`);
            } catch (err) {
              console.error(`❌ Error transfer part ${product.part_pk}:`, err.response?.data || err.message);
            }
          }
          const updateQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
                mutation UpdateReturStatus($resi: String!) {
                  update_mo_retur_receive(
                    where: { resi_retur: { _eq: $resi } },
                    _set: { status_staging: "Processed" }
                  ) {
                    affected_rows
                  }
                }
              `,
              variables: { resi: item.resi_retur },
            },
            query: [],
          };
          const updateResponse = await configureQuery(fastify, updateQuery);
          console.log("🧾 updateResponse:", JSON.stringify(updateResponse, null, 2));
          results.push({
            message: "✅ Process sukses — Camunda dijalankan, stok ditransfer ke WIP, dan status diperbarui",
            resi_retur: item.resi_retur,
          });
        }
      } catch (error) {
        console.error(`❌ Error executing onSubmit:`, error);
        throw error;
      }
    }

    return results;
  },

  async onChange(data) {
    console.log("Handling onChange with data:", data);
    return { message: "onChange executed", data };
  },
};

const handle = async (eventData) => {
  const { eventKey, data } = eventData;
  console.log("eventData", eventData);

  if (!eventHandlers[eventKey]) {
    throw new Error(`No handler found for event: ${eventKey}`);
  }

  try {
    return await eventHandlers[eventKey](data);
  } catch (error) {
    console.error(`Error executing handler for event: ${eventKey}`, error);
    throw error;
  }
};

module.exports = { handle };
