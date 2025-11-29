const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")();
const fetch = require("node-fetch");
const axios = require("axios");
const { unclaimTask } = require("../../utils/camunda/camundaClaim");
const {
  trackStock,
  addStock,
  removeStock,
} = require("../../utils/inventree/inventreeActions");
const CAMUNDA_API = process.env.CAMUNDA_API;
const GRAPHQL_API = process.env.GRAPHQL_API;
const SERVER_INVENTREE = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;

const inventree = axios.create({
  baseURL: `${SERVER_INVENTREE}/api`,
  headers: {
    Authorization: `Token ${INVENTREE_API_TOKEN}`,
    "Content-Type": "application/json",
  },
  timeout: 10000,
});

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];

    for (const item of data) {
      try {
        let instanceId = item.proc_inst_id || null;
        // Kirim ke Camunda
        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {
              hitung_ulang: { value: item.decisionAdjusment, type: "boolean" },
              quantity_input: {
                value: item.decisionAdjusment
                  ? item.quantity_input
                  : item.quantity_adjust,
                type: "Integer",
              },
              quantity_staging: {
                value: item.decisionAdjusment
                  ? item.quantity_staging
                  : item.quantity_adjust,
                type: "Integer",
              },
            },
          },
        };

        const responseCamunda = await camundaConfig(
          dataCamunda,
          instanceId,
          process
        );

        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          let dataQuery;
          if (item.decisionAdjusment) {
            dataQuery = {
              graph: {
                method: "mutate",
                endpoint: GRAPHQL_API,
                gqlQuery: `mutation MyMutation(
  $created_at: timestamp!, 
  $created_by: String!, 
  $delivery_staging_id: Int!, 
  $quantity_input: Int!, 
  $task_def_key: String!
) {
  insert_delivery_staging_logs(
    objects: {
      created_at: $created_at, 
      created_by: $created_by, 
      delivery_staging_id: $delivery_staging_id, 
      quantity_input: $quantity_input, 
      task_def_key: $task_def_key
    }
  ) {
    affected_rows
  }
}
`,
                variables: {
                  created_at: item.created_at,
                  created_by: item.created_by,
                  delivery_staging_id: item.id,
                  quantity_input:
                    item.quantity_adjust ?? item.quantity_input ?? 0,
                  task_def_key:
                    "Mirorim_Warehouse.Generic_Staging.Adjusment_Quantity_Staging",
                },
              },
              query: [],
            };
          } else {
            const stockPrimaryVar = await axios.get(
              `${CAMUNDA_API}engine-rest/process-instance/${item.proc_inst_id}/variables/primary_stock`
            );
            const primaryStock = stockPrimaryVar.data.value;
            console.log("primaryStock:", primaryStock);

            const qtyPick = item.quantity_staging ?? 0;
            const qtyAdjust = item.quantity_adjust ?? 0;
            const stockpk = item.source_id;

            if (qtyAdjust === qtyPick) {
              console.log(
                `✅ Tidak ada adjustment untuk proc_inst_id: ${item.proc_inst_id}`
              );
            } else {
              // hanya lakukan adjustment jika unique_trx mengandung kata "Refill"
              if (
                (item.unique_trx && item.unique_trx.includes("Refill")) ||
                item.unique_trx
                  .split("|")
                  .pop()
                  .match(/[A-Za-z]/)
              ) {
                const selisih = qtyAdjust - qtyPick;

                const responseInventree = await inventree.post(
                  `/stock/${selisih > 0 ? "add" : "remove"}/`,
                  {
                    items: [
                      {
                        pk: stockpk,
                        quantity: Math.abs(selisih),
                      },
                    ],
                    notes: `Adjustment Staging QC Prepare | Selisih: ${selisih} | Proc Inst ID: ${item.proc_inst_id}`,
                  }
                );

                console.log(responseInventree.data);
              } else {
                const selisih = qtyAdjust - qtyPick;

                const notesAdd = `Adjustment Add Staging | Selisih: ${selisih} | Proc Inst ID: ${item.proc_inst_id}`;
                const notesRemove = `Adjustment Remove Staging | Selisih: ${selisih} | Proc Inst ID: ${item.proc_inst_id}`;

                if (selisih > 0) {
                  const stockTrackAdd = await trackStock(stockpk, notesAdd);
                  if (stockTrackAdd.count === 0) {
                    await addStock(stockpk, Math.abs(selisih), notesAdd);
                  } else {
                    console.log("Stock sudah pernah Add");
                  }

                  const stockTrackRemove = await trackStock(primaryStock, notesRemove);
                  if (stockTrackRemove.count === 0) {
                    await removeStock(primaryStock, Math.abs(selisih), notesRemove);
                  } else {
                    console.log("Stock sudah pernah Remove");
                  }
                } else {
                  // Jika selisih < 0 (pengurangan)
                  const stockTrackAdd = await trackStock(primaryStock, notesAdd);
                  if (stockTrackAdd.count === 0) {
                  await addStock(primaryStock, Math.abs(selisih), notesAdd);
                  } else {
                    console.log("Stock sudah pernah Add");
                  }

                  const stockTrackRemove = await trackStock(stockpk, notesRemove);
                  if (stockTrackRemove.count === 0) {
                  await removeStock(stockpk, Math.abs(selisih), notesRemove);
                  } else {
                    console.log("Stock sudah pernah Remove");
                  }
                }
              }
            }
            

            dataQuery = {
              graph: {
                method: "mutate",
                endpoint: GRAPHQL_API,
                gqlQuery: `mutation MyMutation($created_at: timestamp!, $created_by: String!, $delivery_staging_id: Int!, $quantity_input: Int!, $task_def_key: String!, $type: String!, $request_id: Int!) {
  insert_delivery_staging_logs(objects: {created_at: $created_at, created_by: $created_by, delivery_staging_id: $delivery_staging_id, quantity_input: $quantity_input, task_def_key: $task_def_key}) {
    affected_rows
  }
  update_mutasi_request(where: {id: {_eq: $request_id}}, _set: {quantity: $quantity_input}) {
    affected_rows
  }
  update_mutasi_request_details(where: {request_id: {_eq: $request_id}, type: {_eq: $type}}, _set: {quantity: $quantity_input}) {
    affected_rows
  }
}
`,
                variables: {
                  created_at: item.created_at,
                  created_by: item.created_by,
                  delivery_staging_id: item.id,
                  quantity_input:
                    item.quantity_adjust ?? item.quantity_input ?? 0,
                  task_def_key:
                    "Mirorim_Warehouse.Generic_Staging.Adjusment_Quantity_Staging",
                  type: "source",
                  request_id: item.request_id,
                },
              },
              query: [],
            };
          }

          const responseQuery = await configureQuery(fastify, dataQuery);
          console.log("responseQuery", JSON.stringify(responseQuery, null, 2));

          results.push({
            message: "Complete event processed successfully",
            camunda: responseCamunda.data,
            database: responseQuery.data,
          });
        }
      } catch (error) {
        console.error(
          `Error executing handler for event: ${data?.eventKey || "unknown"}`,
          error
        );
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
  const { eventKey, data, process } = eventData;

  if (!eventHandlers[eventKey]) {
    throw new Error(`No handler found for event: ${eventKey}`);
  }

  try {
    return await eventHandlers[eventKey](data, process);
  } catch (error) {
    console.error(`Error executing handler for event: ${eventKey}`, error);
    throw error;
  }
};

module.exports = { handle };
