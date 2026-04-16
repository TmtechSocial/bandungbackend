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
function isSameArray(arr1, arr2) {
  if (arr1.length !== arr2.length) return false;

  return arr1.every((value, index) => value === arr2[index]);
}

async function distributeRemove(qtyArr, selisih, inputQtyArr, type, Refill) {
  const absSelisih = Math.abs(selisih);
  if (Refill === 'Refill' && type == 'add') {
    qtyArr = [...qtyArr]; // biar tidak mutate original
    qtyArr[0] = absSelisih;
  }
  const inputArr = [...inputQtyArr];
  const totalQty = qtyArr.reduce((acc, val) => acc + val, 0);
  const removeArr = new Array(qtyArr.length).fill(0);
    if (absSelisih > totalQty && Refill !== "Refill") {      
    throw new Error('Selisih melebihi total quantity');
  }  // 1️⃣ Cari qty yang sama persis dengan abs selisih

  const exactIndex = qtyArr.findIndex((qty) => qty === absSelisih);
  if (exactIndex !== -1) {
    if (type === 'remove'){
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
    if (type === 'remove') {
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
    if (type === 'remove') {
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
      console.log("hasil: ", JSON.stringify(item));

      try {
        let instanceId = item.proc_inst_id || null;
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
        const unique_trx = item.unique_trx || "";
        let qtyPrimary = [];
        for (let i = 0; i < primaryStockArr.length; i++) {
          const getQty = await inventree.get(`/stock/${primaryStockArr[i]}/`);
          qtyPrimary.push(getQty.data.quantity || 0);
        }
        let selectedIndex = 0;
        const qtyPick = item.quantity_staging ?? 0;
        const qtyAdjust = item.quantity_input_pcs ?? 0;
        const selisih = qtyAdjust - qtyPick;
        let inputArr = [];
        let removeArr = [];
        if (
                (item.unique_trx && item.unique_trx.includes("Refill"))
              ) {
                 if (selisih < 0 ) {
                  const result = await distributeRemove(quantityArr, selisih, quantityArr, 'remove','Refill');
                  inputArr = result.inputArr;
                  removeArr = result.removeArr;
                } else if (selisih > 0) {
                  const result = await distributeRemove(quantityArr, selisih, quantityArr, 'add','Refill');
                  inputArr = result.inputArr;
                  removeArr = result.removeArr;
                } else {
                  inputArr = quantityArr;
                  removeArr = new Array(quantityArr.length).fill(0);
                }
              }else {
                if (selisih < 0 ) {
                  const result = await distributeRemove(quantityArr, selisih, quantityArr, 'remove','Bukan Refill');
                  inputArr = result.inputArr;
                  removeArr = result.removeArr;
                } else if (selisih > 0) {
                  const result = await distributeRemove(qtyPrimary, selisih, quantityArr, 'add','Bukan Refill');
                  inputArr = result.inputArr;
                  removeArr = result.removeArr;
                } else {
                  inputArr = quantityArr;
                  removeArr = new Array(quantityArr.length).fill(0);
                }
              }

        const konfigurasi_salah =
          item.keputusan_wasit_logic == "update" ? true : false;
        const partIds = [item.part_id] || [];

        // Kirim ke Camunda
        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {
              evidence_delivery_staging_adjustment: {
                value: item.evidence[0] || "",
                type: "String",
              },
              keputusan_wasit_logic: {
                value: item.keputusan_wasit_logic,
                type: "String",
              },
              konfigurasi_salah: { value: konfigurasi_salah, type: "Boolean" },
              quantity: { value: JSON.stringify(inputArr), type: "String" },
              quantity_staging: {
                value: item.quantity_input_pcs,
                type: "Integer",
              },
              part_ids: {
                value: JSON.stringify(partIds),
                type: "Object",
                valueInfo: {
                  objectTypeName: "java.util.ArrayList",
                  serializationDataFormat: "application/json",
                },
              },
              Adjustment_Quantity_Staging_Json: {
                value: JSON.stringify([item]),
                type: "Object",
                valueInfo: {
                  objectTypeName: "java.util.ArrayList",
                  serializationDataFormat: "application/json",
                },
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
          if (item.keputusan_wasit_logic !== "adjust") {
            dataQuery = {
              graph: {
                method: "mutate",
                endpoint: GRAPHQL_API,
                gqlQuery: `mutation MyMutation(
  $created_at: timestamp!, 
  $created_by: String!, 
  $delivery_staging_id: Int!, 
  $quantity_input: float8!, 
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
                  quantity_input: item.quantity_input_pcs ?? 0,
                  task_def_key:
                    "Mirorim_Warehouse.Generic_Staging.Adjusment_Quantity_Staging",
                },
              },
              query: [],
            };
          } else {
            console.log("primaryStock:", primaryStockArr);

            const qtyPick = item.quantity_staging ?? 0;
            const qtyAdjust = item.quantity_input_pcs ?? 0;
            if (qtyAdjust === qtyPick) {
              console.log(
                `✅ Tidak ada adjustment untuk proc_inst_id: ${item.proc_inst_id}`
              );
            } else {
              // hanya lakukan adjustment jika unique_trx mengandung kata "Refill"
              if (
                (item.unique_trx && item.unique_trx.includes("Refill"))
              ) {
                const selisih = qtyAdjust - qtyPick;
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
                      notes: `Adjustment Staging QC Prepare | Selisih: ${selisih > 0 ? "" : "-"} ${Math.abs(removeArr[i])} | Proc Inst ID: ${item.proc_inst_id}`,
                    }
                  );
                  console.log(responseInventree.data);
                }

              } else {
                const selisih = qtyAdjust - qtyPick;
                const notesAdd = `Adjustment Add Staging | Selisih: ${selisih} | Proc Inst ID: ${item.proc_inst_id} | pada tanggal ${new Date().toLocaleString('sv-SE', {timeZone: 'Asia/Jakarta'})} WIB`;
                const notesRemove = `Adjustment Remove Staging | Selisih: ${selisih} | Proc Inst ID: ${item.proc_inst_id} | pada tanggal ${new Date().toLocaleString('sv-SE', {timeZone: 'Asia/Jakarta'})} WIB`;

                if (selisih > 0) {
                  for (let i = 0; i < stockpkArr.length; i++) {
                    if (removeArr[i] == 0) continue;
                    const stockTrackAdd = await trackStock(
                      stockpkArr[i],
                      notesAdd
                    );
                    if (stockTrackAdd.count === 0) {
                      await addStock(
                        stockpkArr[i],
                        Math.abs(removeArr[i]),
                        notesAdd
                      );
                      dataQuery = {
                        graph: {
                          method: "mutate",
                          endpoint: GRAPHQL_API,
                          gqlQuery: `mutation MyMutation($request_id: Int!, $type: String!, $source_id: String!, $quantity_input_item: Int!) {
                            update_mutasi_request_details(where: {request_id: {_eq: $request_id}, type: {_eq: $type}, source_id: {_eq: $source_id}}, _set: {quantity: $quantity_input_item}) {
                              affected_rows
                            }
                          }`,
                          variables: {
                            quantity_input_item: inputArr[i],
                            type: "source",
                            request_id: item.request_id,
                            source_id: stockpkArr[i],
                          },
                        },
                        query: [],
                      };
                      const responseQuery = await configureQuery(
                        fastify,
                        dataQuery
                      );
                    } else {
                      console.log("Stock sudah pernah Add");
                    }

                    const stockTrackRemove = await trackStock(
                      primaryStockArr[i],
                      notesRemove
                    );
                    if (stockTrackRemove.count === 0) {
                      await removeStock(
                        primaryStockArr[i],
                        Math.abs(removeArr[i]),
                        notesRemove
                      );
                    } else {
                      console.log("Stock sudah pernah Remove");
                    }
                  }
                } else {
                  // Jika selisih < 0 (pengurangan)
                  for (let i = 0; i < stockpkArr.length; i++) {
                    if (removeArr[i] == 0) continue;

                    const stockTrackAdd = await trackStock(
                      primaryStockArr[i],
                      notesAdd
                    );

                    if (stockTrackAdd.count === 0) {
                      await addStock(
                        primaryStockArr[i],
                        Math.abs(removeArr[i]),
                        notesAdd
                      );
                    } else {
                      console.log("Stock sudah pernah Add");
                    }

                    const stockTrackRemove = await trackStock(
                      stockpkArr[i],
                      notesRemove
                    );

                    if (stockTrackRemove.count === 0) {
                      await removeStock(
                        stockpkArr[i],
                        Math.abs(removeArr[i]),
                        notesRemove
                      );

                      dataQuery = {
                        graph: {
                          method: "mutate",
                          endpoint: GRAPHQL_API,
                          gqlQuery: `mutation MyMutation($request_id: Int!, $type: String!, $source_id: String!, $quantity_input_item: Int!) {
                            update_mutasi_request_details(where: {request_id: {_eq: $request_id}, type: {_eq: $type}, source_id: {_eq: $source_id}}, _set: {quantity: $quantity_input_item}) {
                              affected_rows
                            }
                          }`,
                          variables: {
                            quantity_input_item: inputArr[i],
                            type: "source",
                            request_id: item.request_id,
                            source_id: String(stockpkArr[i]),
                          },
                        },
                        query: [],
                      };
                      console.log("source idd < 0", item.request_id, inputArr[i], stockpkArr[i]);
                      const responseQuery = await configureQuery(
                        fastify,
                        dataQuery
                      );
                      console.log("responseQueryyyyyy selisih < 0", dataQuery);

                      console.log("responseQueryyyyyy selisih < 0", responseQuery, JSON.stringify(null, 2, responseQuery));
                    } else {
                      console.log("Stock sudah pernah Remove");
                    }
                  }
                }
              }
            }
            if (unique_trx.includes("Refill")) {
              dataQuery = {
                graph: {
                  method: "mutate",
                  endpoint: GRAPHQL_API,
                  gqlQuery: `mutation MyMutation($created_at: timestamp!, $created_by: String!, $delivery_staging_id: Int!, $quantity_input: Int!, $quantity_input_float: float8, $task_def_key: String!, $request_id: Int!,$unique_trx:String!) {
                    insert_delivery_staging_logs(objects: {created_at: $created_at, created_by: $created_by, delivery_staging_id: $delivery_staging_id, quantity_input: $quantity_input_float, task_def_key: $task_def_key}) {
                      affected_rows
                    }
                    update_mutasi_request(where: {id: {_eq: $request_id}}, _set: {quantity: $quantity_input}) {
                      affected_rows
                    }
                    update_internal_consolidation_process(where: {unique_trx: {_eq: $unique_trx}}, _set: {quantity: $quantity_input}) {
                      affected_rows
                    }
                  }`,
                  variables: {
                    created_at: item.created_at,
                    created_by: item.created_by,
                    delivery_staging_id: item.id,
                    quantity_input: item.quantity_input_pcs ?? 0,
                    quantity_input_float: item.quantity_input_pcs ?? 0,
                    task_def_key:
                      "Mirorim_Warehouse.Generic_Staging.Adjusment_Quantity_Staging",
                    request_id: item.request_id,
                    unique_trx:unique_trx
                  },
                },
                query: [],
              };
            }else {
              dataQuery = {
                graph: {
                  method: "mutate",
                  endpoint: GRAPHQL_API,
                  gqlQuery: `mutation MyMutation($created_at: timestamp!, $created_by: String!, $delivery_staging_id: Int!, $quantity_input: Int!, $quantity_input_float: float8, $task_def_key: String!, $request_id: Int!) {
                    insert_delivery_staging_logs(objects: {created_at: $created_at, created_by: $created_by, delivery_staging_id: $delivery_staging_id, quantity_input: $quantity_input_float, task_def_key: $task_def_key}) {
                      affected_rows
                    }
                    update_mutasi_request(where: {id: {_eq: $request_id}}, _set: {quantity: $quantity_input}) {
                      affected_rows
                    }
                  }`,
                  variables: {
                    created_at: item.created_at,
                    created_by: item.created_by,
                    delivery_staging_id: item.id,
                    quantity_input: item.quantity_input_pcs ?? 0,
                    quantity_input_float: item.quantity_input_pcs ?? 0,
                    task_def_key:
                      "Mirorim_Warehouse.Generic_Staging.Adjusment_Quantity_Staging",
                    request_id: item.request_id,
                  },
                },
                query: [],
              };
            }
          }

          if (konfigurasi_salah) {
            const upsertParameter = async (part_pk, template, value) => {
              const exist = await inventree.get(
                `/part/parameter/?part=${part_pk}&template=${template}`
              );

              if (exist.data?.results?.length > 0) {
                const paramId = exist.data.results[0].pk;
                await inventree.patch(`/part/parameter/${paramId}/`, {
                  data: value,
                });
              } else {
                await inventree.post("/part/parameter/", {
                  part: part_pk,
                  template,
                  data: value,
                });
              }
            };
            await upsertParameter(item.part_id, 17, "True");
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
