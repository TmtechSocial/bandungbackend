const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")();
const GRAPHQL_API = process.env.GRAPHQL_API;
const SERVER_INVENTREE = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;
const CAMUNDA_API = process.env.CAMUNDA_API;
const axios = require("axios");
async function distributeQuantity(quantityArr, quantity_input_partial) {
  const result = new Array(quantityArr.length).fill(0);

  // 1️⃣ cek apakah ada yang sama persis
  const exactIndex = quantityArr.findIndex(
    qty => qty === quantity_input_partial
  );

  if (exactIndex !== -1) {
    result[exactIndex] = quantity_input_partial;
    return result;
  }

  // 2️⃣ cek apakah semua qty > quantity_input_partial
  if (quantityArr.every(qty => qty > quantity_input_partial)) {
    result[0] = quantity_input_partial;
    return result;
  }

  // 3️⃣ sebar dari index 0
  let remaining = quantity_input_partial;

  for (let i = 0; i < quantityArr.length && remaining > 0; i++) {
    const take = Math.min(quantityArr[i], remaining);
    result[i] = take;
    remaining -= take;
  }

  return result;
}

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
        const quantityVar = await axios.get(
          `${CAMUNDA_API}engine-rest/process-instance/${item.proc_inst_id}/variables/quantity`
        );
        const source_stock = await axios.get(
          `${CAMUNDA_API}engine-rest/process-instance/${item.proc_inst_id}/variables/source_stock`
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
        const stockpkArr = JSON.parse(source_stock.data.value);
        const quantityArr = JSON.parse(quantityVar.data.value);
        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          // Query update GraphQL
          for (const product of item.products) {
            if (product.is_partial) {
              const quantity_input_partial = product.quantity_input_partial || 0;
              const distributedQtys = await distributeQuantity(quantityArr, quantity_input_partial);
              for (let i = 0; i < quantityArr.length; i++) {
                if (distributedQtys[i] == 0) continue;
                let destLocationPk = null;
                try {
                  const res = await inventree.get(
                    `/stock/location/?name=${product.location_id}`
                  );
                  destLocationPk = res.data.results[0]?.pk || null;
                } catch {
                  destLocationPk = null;
                }
                const transferPayload = {
                  items: [
                    {
                      pk: Number(stockpkArr[i]),
                      status: product.location_id.includes("RE") ? 65 : 10,
                      quantity: distributedQtys[i],
                    },
                  ],
                  notes: `Transfer Mutasi | Proc ID: ${item.proc_inst_id}`,
                  location: destLocationPk,
                };

                const { data: stockData } = await inventree.post(
                  "/stock/transfer/",
                  transferPayload
                );
                console.log("stockData", stockData);
              }
            } else {
              for (let i = 0; i < quantityArr.length; i++) {
                let destLocationPk = null;
                if (quantityArr[i] == 0) continue;
                try {
                  const res = await inventree.get(
                    `/stock/location/?name=${product.location_id}`
                  );
                  destLocationPk = res.data.results[0]?.pk || null;
                } catch {
                  destLocationPk = null;
                }
                const transferPayload = {
                  items: [
                    {
                      pk: Number(stockpkArr[i]),
                      status: product.location_id.includes("RE") ? 65 : 10,
                      quantity: quantityArr[i],
                    },
                  ],
                  notes: `Transfer Mutasi | Proc ID: ${item.proc_inst_id}`,
                  location: destLocationPk,
                };

                const { data: stockData } = await inventree.post(
                  "/stock/transfer/",
                  transferPayload
                );
                console.log("stockData", stockData);
              }
            }

            const dataQuery = {
              graph: {
                method: "mutate",
                endpoint: GRAPHQL_API,
                gqlQuery: `mutation MyMutation($proc_inst_id: String!, $id: Int!, $quantity: Int!, $user: String!, $source_id: String!, $status: String!, $date: timestamp!, $quantity_physical: Int!, $quantity_data: Int!, $type: String!, $file: String!) {
  update_mutasi_request_details(where: {request_id: {_eq: $id}, source_id: {_eq: $source_id}, type: {_eq: $type}}, _set: {updated_by: $user, updated_at: $date, quantity: $quantity, quantity_physical: $quantity_physical, quantity_data: $quantity_data}) {
    affected_rows
  }
  update_mutasi_request(where: {proc_inst_id: {_eq: $proc_inst_id}}, _set: {status: $status, evidence_placement: $file}) {
    affected_rows
  }
}
`,
                variables: {
                  proc_inst_id: item.proc_inst_id,
                  status: "Completed",
                  type: "destination",
                  id: item.id,
                  user: item.updated_by,
                  date: item.updated_at,
                  quantity: product.quantity_placing || 0,
                  source_id: product.source_id,
                  quantity_physical: product.quantity_fisik || 0,
                  quantity_data: item.quantity_data || 0,
                  file: item.evidence[0] || ""
                },
              },
              query: [],
            };

            console.log("dataQuery", dataQuery);

            // Jalankan query (tunggal, bukan array), jangan pakai .map
            const responseQuery = await configureQuery(fastify, dataQuery);

            console.log("responseQuery", responseQuery);
          }

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
