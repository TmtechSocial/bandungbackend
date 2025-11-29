const { isEnumType } = require("graphql");
const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const GRAPHQL_API = process.env.GRAPHQL_API;
const CAMUNDA_API = process.env.CAMUNDA_API;
const axios = require("axios");
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
        let responseCamunda = null;

        const statusValue = item.insert_status?.value || "";
        console.log("📦 Status:", statusValue);

        // === CAMUNDA TASK COMPLETE ===
        if (statusValue === "Finish") {
          const dataCamunda = {
            type: "complete",
            endpoint: `/engine-rest/task/{taskId}/complete`,
            instance: instanceId,
            variables: {
              variables: {
                quantity_staging: { value: item.quantity_qc, type: "Integer" },
              },
            },
          };

          try {
            responseCamunda = await camundaConfig(
              dataCamunda,
              instanceId,
              process
            );
            console.log("✅ Camunda complete success:", responseCamunda.status);
          } catch (camundaError) {
            console.error(
              "❌ Camunda complete failed:",
              camundaError.message || camundaError
            );
          }

          // === UPDATE internal_consolidation_process JIKA TYPE == 'Refill' ===
          if (item.type === "Refill") {
            try {
              // Hitung selisih antara quantity QC dan quantity
              const selisih = item.quantity_qc - item.quantity;
              console.log("🔍 Selisih quantity:", selisih);

              if (selisih !== 0) {
                // Jika ada selisih, lakukan adjustment di InvenTree
                const responseInventree = await inventree.post(
                  `/stock/${selisih > 0 ? "add" : "remove"}/`,
                  {
                    items: [
                      {
                        pk: item.stock_item_wip, // pastikan stockpk sudah didefinisikan di luar
                        quantity: Math.abs(selisih),
                      },
                    ],
                    notes: `Adjustment QC PREPARE | Selisih: ${selisih} | Proc Inst ID: ${item.proc_inst_id}`,
                  }
                );

                console.log("✅ InvenTree response:", responseInventree.data);
              } else {
                console.log("🔍 Tidak ada selisih, tidak perlu adjustment.");
              }

              // Update quantity di tabel internal_consolidation_process
              const updateConsolidation = {
                graph: {
                  method: "mutate",
                  endpoint: GRAPHQL_API,
                  gqlQuery: `
          mutation UpdateConsolidation($id: Int!, $quantity: Int!) {
            update_internal_consolidation_process(
              where: { id: { _eq: $id } },
              _set: { quantity: $quantity }
            ) {
              affected_rows
            }
          }
        `,
                  variables: {
                    id: item.consolidation_id,
                    quantity: item.quantity_qc || 0,
                  },
                },
              };

              const resConsolidation = await configureQuery(
                fastify,
                updateConsolidation
              );
              console.log(
                "✅ internal_consolidation_process updated:",
                JSON.stringify(resConsolidation.data, null, 2)
              );
            } catch (err) {
              console.error(
                "❌ Failed to update internal_consolidation_process:",
                err.message || err
              );
            }
          }
        }

        if (statusValue === "Pause") {
          try {
            // Ambil task dari instance ID
            const taskResponse = await axios.get(
              `${CAMUNDA_API}engine-rest/task`,
              {
                params: { processInstanceId: instanceId },
              }
            );

            if (taskResponse.data && taskResponse.data.length > 0) {
              const taskId = taskResponse.data[0].id;
              // Unclaim task
              const unclaimResponse = await axios.post(
                `${CAMUNDA_API}engine-rest/task/${taskId}/unclaim`
              );

              responseCamunda = { status: unclaimResponse.status, taskId };
            } else {
              console.warn("⚠️ No active task found for instance:", instanceId);
            }
          } catch (unclaimError) {
            console.error(
              "❌ Failed to unclaim task:",
              unclaimError.message || unclaimError
            );
          }
        }

        // === INSERT LOGS & UPDATE prepare_internal ===
        const dataQuery = {
          graph: {
            method: "mutate",
            endpoint: GRAPHQL_API,
            gqlQuery: `
              mutation MyMutation(
                $date: timestamp!,
                $prepare_internal_id: Int!,
                $status: String!,
                $task_def_key: String!,
                $notes: String,
                $created_by: String!,
                $proc_inst_id: String!,
                $quantity: Int!
              ) {
                insert_prepare_internal_logs(
                  objects: {
                    created_at: $date,
                    created_by: $created_by,
                    prepare_internal_id: $prepare_internal_id,
                    status: $status,
                    task_def_key: $task_def_key,
                    notes_worker: $notes
                  }
                ) {
                  affected_rows
                }
                update_prepare_internal(
                  where: { proc_inst_id: { _eq: $proc_inst_id } },
                  _set: { quantity_qc: $quantity }
                ) {
                  affected_rows
                }
              }
            `,
            variables: {
              proc_inst_id: item.proc_inst_id,
              quantity: item.quantity_qc || 0,
              date: new Date(Date.now() + 7 * 60 * 60 * 1000)
                .toISOString()
                .replace("T", " ")
                .substring(0, 19),
              prepare_internal_id: item.id,
              status: statusValue,
              task_def_key:
                "Mirorim_Warehouse.Internal_Prepare.QC_Product_Prepare",
              notes: item.notes || null,
              created_by: item.created_by || "",
            },
          },
        };

        const responseQuery = await configureQuery(fastify, dataQuery);
        console.log(
          "✅ Database success:",
          JSON.stringify(responseQuery.data, null, 2)
        );

        results.push({
          message: "Create event processed successfully",
          camunda: responseCamunda?.data || null,
          database: responseQuery.data,
        });
      } catch (error) {
        console.error(`Error executing handler for event: ${error}`);
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
  console.log("eventData", eventData);

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
