require("dotenv").config();
const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
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

        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {},
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
              gqlQuery: `mutation UpdateReturReceive($proc_inst_id: String!, $task_def_key: String!) {update_mo_retur_receive(where: {proc_inst_id: {_eq: $proc_inst_id}}, _set: {task_def_key: $task_def_key}) {affected_rows}}`,
              variables: {
                proc_inst_id: item.proc_inst_id,
                task_def_key: "Retur Selesai",
              },
            },
            query: [],
          };

          console.log("dataQuery", dataQuery);
          // Jalankan semua query secara paralel
        const responseQuery = await configureQuery(fastify, dataQuery);

          // Kirim add stock ke Inventree untuk setiap product
          const axios = require("axios");
          for (const product of item.products) {
            try {
              // Langsung gunakan pk dari form
              const stockPk = product.output_location;
              if (!stockPk) {
                console.warn(`Stock PK tidak ditemukan di data product`);
                continue;
              }
              // 2. Add stock
              const addPayload = {
                items: [
                  {
                    pk: stockPk,
                    quantity: product.quantity_retur,
                  },
                ],
                notes: `Retur Add Stock Invoice ${item.invoice} | Proc ID: ${item.proc_inst_id}`,
              };
              const addRes = await axios.post(
                `${SERVER_INVENTREE}/api/stock/add/`,
                addPayload,
                {
                  headers: {
                    Authorization: `Token ${INVENTREE_API_TOKEN}`,
                    "Content-Type": "application/json",
                  },
                }
              );
              console.log("Inventree add stock response:", addRes.data);
            } catch (err) {
              console.error(
                "Inventree add stock error:",
                err?.response?.data || err.message
              );
            }
          }

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

