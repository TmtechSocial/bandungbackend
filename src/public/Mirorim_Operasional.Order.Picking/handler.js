const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")();
const GRAPHQL_API = process.env.GRAPHQL_API;
const fetch = require("node-fetch");
const axios = require("axios");
const { trackStock, removeStock,getAllStock } = require("../../utils/inventree/inventreeActions");
const { unclaimTask } = require("../../utils/camunda/camundaClaim");

// remove stok
const removeStockFromInventree = async (product, item) => {
  try {
    const locationPk = product.stock_item_id;
    const part_pk = product.part_pk;
    const quantityNeeded = product.quantity_convert;

    const notes = `Order Invoice ${item.invoice} | SKU: ${product.sku_toko} | User Picker: ${item.user_picker}`;
    const stockList = await getAllStock(part_pk, locationPk);

    if (!stockList?.results?.length) {
      throw new Error("Stock kosong atau tidak ditemukan pada location.");
    }
    for (const stock of stockList.results) {
      // Cek apakah stok sudah pernah di-track
      const stockTrack = await trackStock(stock.pk, notes);
      if (stockTrack?.length > 0) {
        console.log("Stock sudah pernah di-track, tidak remove");
        return [204];
      }

      console.log("Stock belum pernah di-track, lanjut remove");

    }

    // Ambil list stock item pada part & location ini
    // Hitung total qty
    const totalQty = stockList.results.reduce((sum, s) => sum + s.quantity, 0);

    if (totalQty < quantityNeeded) {
      console.log(`âŒ Stock tidak cukup. Dibutuhkan ${quantityNeeded}, tersedia ${totalQty}`);
      return null;
    }

    console.log(`Total stock tersedia: ${totalQty} â€” Cukup, lanjut pengurangan.`);

    // --- STEP 1: Sort ascending, yang paling kecil dulu ---
    const sortedStock = [...stockList.results].sort((a, b) => a.quantity - b.quantity);

    let qtyToDeduct = quantityNeeded;
    const results = [];

    for (const stock of sortedStock) {
      if (qtyToDeduct <= 0) break;

      const available = stock.quantity;
      const amountToRemove = Math.min(available, qtyToDeduct);

      console.log(
        `Mengurangi stock PK=${stock.pk} | tersedia=${available} | akan dikurangi=${amountToRemove}`
      );

      // Lakukan removeStock untuk stock ini
      const res = await removeStock(stock.pk, amountToRemove, notes);
      results.push(res);

      qtyToDeduct -= amountToRemove;
    }

    console.log("Pengurangan selesai untuk semua stock.");
    return results;

  } catch (error) {
    console.error(
      `âŒ Failed to remove stock for part=${product.part_pk} at location=${product.stock_item_id}`,
      error.response?.data || error.message
    );
    throw error;
  }
};

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];

    for (const item of data) {
      try {
        let instanceId = item.proc_inst_id || null;

        if (item.action === "save") {
          const checkedProducts = item.products.filter(
            (product) => product.check === true && !product.picked_status
          );

          const databaseResults = [];

          for (const product of checkedProducts) {
            // 1️⃣ Remove stock dari Inventree dulu
            const inventreeResponse = await removeStockFromInventree(product, item);
            console.log('response : ', inventreeResponse);

            if (
              !Array.isArray(inventreeResponse) ||
              inventreeResponse.some((status) => status < 200 || status > 299)
            ) {
              throw new Error(
                `Remove stock Inventree gagal untuk SKU: ${product.sku_toko}`
              );
            }

            console.log('Pengurangan selesai untuk semua stock. haha');

            // 2️⃣ Jika sukses → baru mutate GraphQL
            const query = {
              graph: {
                method: "mutate",
                endpoint: GRAPHQL_API,
                gqlQuery: `
                  mutation MyMutation($proc_inst_id: String!, $sku_toko: String!, $status_picked: String!, $date: timestamp!, $user_picker: String!) {
                    update_mo_order_shop(
                      where: {
                        proc_inst_id: {_eq: $proc_inst_id},
                        sku_toko: {_eq: $sku_toko},
                        picked_status: { _is_null: true }
                      },
                      _set: {
                        picked_status: $status_picked,
                        user_checked_pick: $user_picker
                      }
                    ) {
                      affected_rows
                    }
                    update_mo_order(
                      where: {proc_inst_id: {_eq: $proc_inst_id}},
                      _set: {picked_at: $date, user_picker: $user_picker}
                    ) {
                      affected_rows
                    }
                  }
                `,
                variables: {
                  proc_inst_id: instanceId,
                  sku_toko: product.sku_toko,
                  status_picked: "picked",
                  date: item.picked_at,
                  user_picker: item.user_picker,
                },
              },
              query: [],
            };

            const responseQuery = await configureQuery(fastify, query);

            databaseResults.push(responseQuery.data);
          }

          results.push({
            message: "Save event processed successfully",
            database: databaseResults,
          });

          try {
            if (instanceId && item.user_picker_id) {
              const camundaUrl = "https://mirorim.ddns.net:6789/api/engine-rest/";
              const resTask = await axios.get(
                `${camundaUrl}task?processInstanceId=${instanceId}`
              );

              if (
                resTask.status === 200 &&
                Array.isArray(resTask.data) &&
                resTask.data.length > 0
              ) {
                const taskDefinitionKey = resTask.data[0].taskDefinitionKey;

                await unclaimTask(
                  {
                    body: {
                      instance: instanceId,
                      taskDefinitionKey,
                      userId: item.user_picker_id,
                    },
                  },
                  { send: () => {} }
                );
              }

              console.warn("berhasil unclaim task ✅");
            }
          } catch (e) {
            console.warn("Gagal unclaim task setelah save:", e.message);
          }
        } else {
          let pickedBefore = 0;
          console.log( `${process.camundaUrl}/engine-rest/process-instance/${instanceId}/variables/countPicked`)
          try {
            const res = await fetch(
              `${process.camundaUrl}/engine-rest/process-instance/${instanceId}/variables/countPicked`
            );
            if (res.ok) {
              const json = await res.json();
              pickedBefore = parseInt(json.value || 0);
            }
          } catch (e) {
            console.warn("Tidak bisa ambil picked sebelumnya, default 0");
          }

          // Hitung picked sekarang
          const pickedNow = item.products?.filter((product) => product.check === true).length || 0;
          const pickedTotal = pickedBefore + pickedNow;

          // Hitung total products
          const countProducts = item.products?.length || 0;

          

          if (item) {
            const checkedProducts = item.products.filter(
              (product) => product.check === true && !product.picked_status
            );

            const databaseResults = [];

            for (const product of checkedProducts) {
              // 1️⃣ Remove stock Inventree dulu
              const inventreeResponse = await removeStockFromInventree(product, item);

              if (
                !Array.isArray(inventreeResponse) ||
                inventreeResponse.some((status) => status < 200 || status > 299)
              ) {
                throw new Error(
                  `Remove stock Inventree gagal untuk SKU: ${product.sku_toko}`
                );
              }


              // 2️⃣ Jika sukses → mutate GraphQL
              const query = {
                graph: {
                  method: "mutate",
                  endpoint: GRAPHQL_API,
                  gqlQuery: `
                    mutation MyMutation(
                      $proc_inst_id: String!,
                      $sku_toko: String!,
                      $status_picked: String!,
                      $date: timestamp!,
                      $task: String!,
                      $user_picker: String!
                    ) {
                      update_mo_order_shop(
                        where: {
                          proc_inst_id: { _eq: $proc_inst_id },
                          sku_toko: { _eq: $sku_toko },
                          picked_status: { _is_null: true }
                        },
                        _set: {
                          picked_status: $status_picked,
                          user_checked_pick: $user_picker
                        }
                      ) {
                        affected_rows
                      }

                      update_mo_order(
                        where: { proc_inst_id: { _eq: $proc_inst_id } },
                        _set: {
                          picked_at: $date,
                          task_def_key: $task,
                          user_picker: $user_picker
                        }
                      ) {
                        affected_rows
                      }
                    }
                  `,
                  variables: {
                    proc_inst_id: instanceId,
                    sku_toko: product.sku_toko,
                    status_picked: "picked",
                    date: item.picked_at,
                    user_picker: item.user_picker,
                    task:
                      item.status_proses === "box"
                        ? "Mirorim_Operasional.Order.Box"
                        : "Mirorim_Operasional.Order.Confirmation_Customer",
                  },
                },
                query: [],
              };

              const responseQuery = await configureQuery(fastify, query);

              databaseResults.push(responseQuery.data);
            }

            results.push({
              message: "Complete event processed successfully",
              database: databaseResults,
            });
          }
          // Kirim ke Camunda
          const dataCamunda = {
            type: "complete",
            endpoint: `/engine-rest/task/{taskId}/complete`,
            instance: item.proc_inst_id,
            variables: {
              variables: {
                countProducts: { value: countProducts, type: "Integer" },
                countPicked: { value: pickedTotal, type: "Integer" },
              },
            },
          };

          const responseCamunda = await camundaConfig(dataCamunda, instanceId, process);
        }
      } catch (error) {
        console.error(`Error executing handler for event: ${data?.eventKey || "unknown"}, error`);
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
    console.error(`Error executing handler for event: ${eventKey}, error`);
    throw error;
  }
};

module.exports = { handle };
