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
function isSameArray(arr1, arr2) {
  if (arr1.length !== arr2.length) return false;

  return arr1.every((value, index) => value === arr2[index]);
}

async function distributeRemove(qtyArr, selisih, inputQtyArr) {
  const absSelisih = Math.abs(selisih);
  const inputArr = [...inputQtyArr];
  const totalQty = qtyArr.reduce((acc, val) => acc + val, 0);
  const removeArr = new Array(qtyArr.length).fill(0);
    // 1️⃣ Cari qty yang sama persis dengan abs selisih
  const exactIndex = qtyArr.findIndex((qty) => qty === absSelisih);
  if (exactIndex !== -1) {
    if ((isSameArray(inputQtyArr, qtyArr))){
      inputArr[exactIndex] = 0;
    }else {
      inputArr[exactIndex] += absSelisih;
    }
    removeArr[exactIndex] = absSelisih;
    return { inputArr, removeArr };
  }

  // 2️⃣ Jika semua qty lebih besar dari abs selisih
  const sufficientIndex = qtyArr.findIndex(qty => qty >= absSelisih);

  if (sufficientIndex !== -1) {
    if (isSameArray(inputQtyArr, qtyArr)) {
      inputArr[sufficientIndex] -= absSelisih;
    } else {
      inputArr[sufficientIndex] += absSelisih;
    }
    removeArr[sufficientIndex] = absSelisih;
    return { inputArr, removeArr };
  }

  // 3️⃣ Distribusi bertahap
  let remaining = absSelisih;
  for (let i = 0; i < qtyArr.length; i++) {
    if (remaining <= 0) break;

    const taken = Math.min(inputArr[i], remaining);
    if (isSameArray(inputQtyArr, qtyArr)) {
      inputArr[i] -= taken;
    }else {
      inputArr[i] += taken;
    }
    removeArr[i] = taken;
    remaining -= taken;
  }

  return { inputArr, removeArr };
}

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];

    for (const item of data) {
      try {
        let instanceId = item.proc_inst_id || null;
        let responseCamunda = null;

        const statusValue = item.insert_status?.value || "";
        console.log("📦 Status:", statusValue);
        const stockPrimaryVar = await axios.get(
          `${CAMUNDA_API}engine-rest/process-instance/${item.proc_inst_id}/variables/primary_stock`
        );
        const source_stock = await axios.get(
          `${CAMUNDA_API}engine-rest/process-instance/${item.proc_inst_id}/variables/source_stock`
        );
        const quantityVar = await axios.get(
          `${CAMUNDA_API}engine-rest/process-instance/${item.proc_inst_id}/variables/quantity`
        );
        const primaryStockArr = JSON.parse(stockPrimaryVar.data.value);
        const stockpkArr = JSON.parse(source_stock.data.value);
        const quantityArr = JSON.parse(quantityVar.data.value);
        let selectedIndex = 0;
        const qtyPick = item.quantity ?? 0;
        const qtyAdjust = item.quantity_qc ?? 0;
        const selisih = qtyAdjust - qtyPick;
        let inputArr = [];
        let removeArr = [];
        if (selisih < 0) {
          const result = await distributeRemove(quantityArr, selisih, quantityArr);
          inputArr = result.inputArr;
          removeArr = result.removeArr;
        } else if (selisih > 0) {
          inputArr = [...quantityArr];   // copy array
          inputArr[0] += selisih;        // tambah di index 0
          removeArr = new Array(quantityArr.length).fill(0);
          removeArr[0] = selisih;
        }else {
          inputArr = [...quantityArr];   // copy array
        }
        // === CAMUNDA TASK COMPLETE ===
        if (statusValue === "Finish") {
          const dataCamunda = {
            type: "complete",
            endpoint: `/engine-rest/task/{taskId}/complete`,
            instance: instanceId,
            variables: {
              variables: {
                quantity: { value: inputArr, type: "String" },
                quantity_staging: { value: item.quantity_qc, type: "Integer" },
                quantity_qc_prepare: { value: item.quantity_qc, type: "Integer" },
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
              console.log("🔍 Selisih quantity11:", selisih);

              if (selisih !== 0) {
              console.log("🔍 Selisih quantityss:", selisih);
                // Jika ada selisih, lakukan adjustment di InvenTree
                for (let i = 0; i < stockpkArr.length; i++) {
                  if (removeArr[i] == 0) continue;
                  const responseInventree = await inventree.post(
                    `/stock/${selisih > 0 ? "add" : "remove"}/`,
                    {
                      items: [
                        {
                          pk: stockpkArr[i],
                          quantity: Math.abs(removeArr[i]),
                        },
                      ],
                      notes: `Adjustment QC PREPARE | Selisih: ${selisih > 0 ? "" : "-"} ${Math.abs(removeArr[i])} | Proc Inst ID: ${item.proc_inst_id}`,
                    }
                  );
                  console.log(responseInventree.data);
                }
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
