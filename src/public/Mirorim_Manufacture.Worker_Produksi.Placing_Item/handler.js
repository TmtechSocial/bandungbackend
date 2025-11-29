const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
require("dotenv").config(); // <-- kalau di Node.js
const axios = require("axios");
const GRAPHQL_API = process.env.GRAPHQL_API;
const SERVER_INVENTREE = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];
    for (const item of data) {
      try {
        let taskId;
        let instanceId = item.proc_inst_id || null;

        const getPk = async (item) => {
          console.log("🚀 getPk dijalankan untuk reference:", item.reference);
          try {
            const baseURL = SERVER_INVENTREE;
            const token = INVENTREE_API_TOKEN;
            console.log(`Base URL: ${baseURL}, Token: ${token}`);
            if (!baseURL || !token) {
              throw new Error(
                "SERVER_INVENTREE atau INVENTREE_API_TOKEN belum di-set"
              );
            }

            const axiosInstance = axios.create({
              baseURL,
              headers: {
                Authorization: `Token ${token}`,
                "Content-Type": "application/json",
              },
            });

            // Cari PK berdasarkan reference
            const responseSku = await axiosInstance.get(
              `/api/build/?reference=${encodeURIComponent(item.reference)}`
            );

            const skuResults = responseSku.data.results;

            if (!skuResults || skuResults.length === 0) {
              console.error("❌ Lokasi PK tidak ditemukan dari Reference");
              return null;
            }

            const buildId = skuResults[0].pk;
            const partName = skuResults[0].part_name || null;
            const partPk = buildId;
            const endpointFinish = `/api/build/${buildId}/complete/`;

            // Payload hasil produksi (finish)
            const payloadFinish = {
              outputs: [
                {
                  output: item.stock_item_id_finish,
                },
              ],
              location: item.destination_finish,
              status_custom_key: 10,
              notes: `Hasil Produksi Proc Inst Id : ${item.proc_inst_id}`,
            };

            // Kirim payload finish
            console.log("📦 Mengirim payload finish:", payloadFinish);
            const resFinish = await axiosInstance.post(
              endpointFinish,
              payloadFinish
            );
            console.log("✅ Response Finish:", resFinish.data);

            const descriptionLocation = await axiosInstance.get(
              `/api/stock/location/${encodeURIComponent(item.destination_finish)}/`
            );

            const description = descriptionLocation.data.description || "";
            console.log("📍 Description Location:", description);

            if (description === "TOKO") {
              try {
  const responseStock = await axiosInstance.get(
    `/api/stock/?location=${item.destination_finish}&part=${item.part_pk}`
  );

  const stockResults = responseStock.data?.results || responseStock.data || [];
  const stockPKs = Array.isArray(stockResults)
    ? stockResults.map((stock) => stock.pk).filter(Boolean)
    : [];
    console.log("resultss", stockResults);
    console.log("resultss pk", stockPKs);
    

  if (stockPKs.length === 0) {
    console.warn(
      `⚠️ Tidak ada stok ditemukan untuk merge di lokasi ${item.destination_finish} part ${item.part_pk}`
    );
  } else {
    const mergePayload = {
      items: stockPKs.map((pk) => ({ item: pk })),
      location: item.destination_finish,
      notes: `Merge stock Retail From Produksi | Proc ID: ${item.proc_inst_id}`,
    };

    console.log("📦 mergePayload:", JSON.stringify(mergePayload, null, 2));

    const mergeResponse = await axiosInstance.post(`/api/stock/merge/`, mergePayload);
    console.log("✅ Merge sukses:", mergeResponse.data);
  }
} catch (mergeError) {
  console.error(
    "❌ Gagal merge stok di Inventree:",
    mergeError.response?.data || mergeError.message
  );
}

            }

            // Kalau ada reject, kirim payload reject
            if (item.quantity_reject > 0) {
              const payloadReject = {
                outputs: [
                  {
                    output: item.stock_item_id_reject,
                  },
                ],
                location: item.destination_reject,
                status_custom_key: 65,
                notes: `Hasil Produksi Proc Inst Id : ${item.proc_inst_id}`,
              };

              console.log("📦 Mengirim payload reject:", payloadReject);
              const resReject = await axiosInstance.post(
                endpointFinish,
                payloadReject
              );
              console.log("✅ Response Reject:", resReject.data);
            }

            console.log("✅ Id PK:", partPk);
            console.log("📍 Endpoint Finish:", endpointFinish);

            return { partPk, partName };
          } catch (error) {
            console.error(
              "❌ Error mengambil part PK, name, atau posting payload:",
              error
            );
            return null;
          }
        };

        // contoh pemanggilan
        const result = await getPk(item);

        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {
            },
          },
        };

        const responseCamunda = await camundaConfig(
          dataCamunda,
          instanceId,
          process
        );
        console.log("responseCamunda", responseCamunda);
        if (responseCamunda.status === 200 || responseCamunda.status === 204) {

          const dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: ``,
              variables: {},
            },
            query: [],
          };

          const responseQuery = await configureQuery(fastify, dataQuery);

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
