const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")();
const GRAPHQL_API = process.env.GRAPHQL_API;
const SERVER_INVENTREE = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;
const CAMUNDA_API = process.env.CAMUNDA_API;
const axios = require("axios");

const inventree = axios.create({
  baseURL: `${SERVER_INVENTREE}/api`,
  headers: {
    Authorization: `Token ${INVENTREE_API_TOKEN}`,
    "Content-Type": "application/json",
  },
  timeout: 10000,
});

const eventHandlers = {
  async onSubmit(data, process, eventKey) {
    const results = [];
    for (const item of data) {
      try {
        let instanceId = item.proc_inst_id || null;

        const destinationVar = await axios.get(
          `${CAMUNDA_API}engine-rest/process-instance/${item.proc_inst_id}/variables/destination_type`
        );
        const destinationType = destinationVar.data.value;
        console.log("destination_type:", destinationType);

        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`, // {taskId} seharusnya diganti sesuai implementasi camundaConfig
          instance: item.proc_inst_id,
          variables: {
            variables: {},
          },
        };

        // Kirim request ke Camunda
        const responseCamunda = await camundaConfig(
          dataCamunda,
          instanceId,
          process
        );

        console.log("responseCamunda", responseCamunda);

        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          // Query update GraphQL
            let destLocationPk = null;
            try {
              const res = await inventree.get(
                `/stock/location/?name=${item.destination}`
              );
              destLocationPk = res.data.results?.[0]?.pk || null;
            } catch {
              destLocationPk = null;
            }

            const transferPayload = {
              items: [
                {
                  pk: Number(item.source_id_wip),
                  status: item.destination.includes("RE") ? 65 : 10,
                  quantity: item.quantity_input,
                },
              ],
              notes: `Transfer Mutasi | Proc ID: ${item.proc_inst_id}`,
              location: destLocationPk,
            };

            const { data: stockData } = await inventree.post(
              "/stock/transfer/",
              transferPayload
            );

            if (destinationType === "Retail") {
              try {
                const { data: stockItems } = await inventree.get(
                  `/stock/?location=${destLocationPk}&part=${item.part_id}`
                );

                const stockPKs = stockItems?.results
                  ?.map((stock) => stock.pk)
                  .filter(Boolean);

                if (!stockPKs.length) {
                  console.warn(
                    `⚠️ Tidak ada stok ditemukan untuk merge di lokasi ${destLocationPk} part ${item.part_id}`
                  );
                } else {
                  // 🟢 Gunakan 'item' bukan 'pk'
                  const mergePayload = {
                    items: stockPKs.map((pk) => ({ item: pk })),
                    location: destLocationPk,
                    notes: `Merge stok Retail | Proc inst ID: ${item.proc_inst_id}`,
                  };

                  console.log(
                    "📦 mergePayload:",
                    JSON.stringify(mergePayload, null, 2)
                  );

                  const mergeResponse = await inventree.post(
                    `/stock/merge/`,
                    mergePayload
                  );
                }
              } catch (mergeError) {
                console.error(
                  "❌ Gagal merge stok di Inventree:",
                  mergeError.response?.data || mergeError.message
                );
              }
            }

            const dataQuery = {
              graph: {
                method: "mutate",
                endpoint: GRAPHQL_API,
                gqlQuery: `mutation MyMutation($proc_inst_id: String!, $quantity_physical: Int!, $quantity_data: Int!, $status: String!, $file: String!) {
                  update_internal_consolidation_process
(where: {proc_inst_id: {_eq: $proc_inst_id}}, _set: {quantity_physical: $quantity_physical, quantity_data: $quantity_data, status: $status, evidence_placement: $file}) {
                    affected_rows
                  }
                }
`,
                variables: {
                  proc_inst_id: item.proc_inst_id,
                  quantity_physical: item.quantity_physical || 0,
                  quantity_data: item.total_quantity_system || 0,
                  status: "Completed",
                  file: item.evidence?.[0] || ""
                },
              },
              query: [],
            };

            console.log("dataQuery", dataQuery);

            // Jalankan query (tunggal, bukan array), jangan pakai .map
            const responseQuery = await configureQuery(fastify, dataQuery);

            console.log("responseQuery", responseQuery);
          

          results.push({
            message: "Create event processed successfully",
            camunda: responseCamunda.data,
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

  async onChange(data, process, eventKey) {
    console.log(`Handling ${eventKey} with data:`, data);
    // Implementasi onChange
    return { message: `${eventKey} executed`, data };
  },
};

const handle = async (eventData) => {
  const { eventKey, data, process } = eventData;

  console.log("eventData", eventData);

  if (!eventHandlers[eventKey]) {
    throw new Error(`No handler found for event: ${eventKey}`);
  }

  try {
    return await eventHandlers[eventKey](data, process, eventKey);
  } catch (error) {
    console.error(`Error executing handler for event: ${eventKey}`, error);
    throw error;
  }
};

module.exports = { handle };
