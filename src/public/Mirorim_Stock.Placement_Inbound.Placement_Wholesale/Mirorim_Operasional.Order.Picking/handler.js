const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")();
const GRAPHQL_API = process.env.GRAPHQL_API;
const fetch = require("node-fetch");
const axios = require("axios");
const { trackStock, removeStock } = require("../../utils/inventree/inventreeActions");
const { unclaimTask } = require("../../utils/camunda/camundaClaim");

// remove stok
const removeStockFromInventree = async (product, item) => {
  try {
    const stockPk = product.stock_pk_sku;
    const quantity = product.quantity_convert;
    const notes = `Order Invoice ${item.invoice} | SKU: ${product.sku_toko} | User Picker: ${item.user_picker}`;

    const stockTrack = await trackStock(stockPk, notes);
    console.log(stockTrack.count);

    // Jika count = 0 → boleh remove
    if (stockTrack.count === 0) {
      const stockRemove = await removeStock(stockPk, quantity, notes);
      return stockRemove;
    }
    
    console.log("Stock sudah pernah di-track, tidak remove");
    return null;

  } catch (error) {
    console.error(
      `❌ Failed to remove stock for part=${product.part_pk} at location=${product.stock_item_id}`,
      error.response?.data || error.message
    );
    return null;
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

          const dataQuery = checkedProducts.map((product) => ({
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
                mutation MyMutation($proc_inst_id: String!, $sku_toko: String!, $status_picked: String!, $date: timestamp!, $user_picker: String!) {
                  update_mo_order_shop(
                    where: {proc_inst_id: {_eq: $proc_inst_id}, sku_toko: {_eq: $sku_toko}, picked_status: { _is_null: true }},
                    _set: {picked_status: $status_picked, user_checked_pick: $user_picker}
                  ) {
                    affected_rows
                  }
                  update_mo_order(
                    where: {proc_inst_id: {_eq: $proc_inst_id}},
                    _set: {picked_at: $date, user_picker: $user_picker}
                  ) {
                    affected_rows
                  }
                }`,
              variables: {
                proc_inst_id: instanceId,
                sku_toko: product.sku_toko,
                status_picked: "picked",
                date: item.picked_at,
                user_picker: item.user_picker,
              },
            },
            query: [],
          }));

          const responseQuery = await Promise.all(
            dataQuery.map((query) => configureQuery(fastify, query))
          );

          // Post ke Inventree juga
          await Promise.all(checkedProducts.map((product) => removeStockFromInventree(product, item)));

          results.push({
            message: "Save event processed successfully",
            database: responseQuery.map((res) => res.data),
          });

          try {
            if (instanceId && item.user_picker_id) {
              // Ambil task definition key dari Camunda berdasarkan instanceId
              const camundaUrl = "https://mirorim.ddns.net:6789/api/engine-rest/";
              const resTask = await axios.get(`${camundaUrl}task?processInstanceId=${instanceId}`);
              if (resTask.status === 200 && Array.isArray(resTask.data) && resTask.data.length > 0) {
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

          if (responseCamunda.status === 200 || responseCamunda.status === 204) {
            const checkedProducts = item.products.filter(
              (product) => product.check === true && !product.picked_status
            );

            const dataQuery = checkedProducts.map((product) => ({
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
                    }`,
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
            }));

            const responseQuery = await Promise.all(
              dataQuery.map((query) => configureQuery(fastify, query))
            );

            // Post ke Inventree juga
            await Promise.all(checkedProducts.map((product) => removeStockFromInventree(product, item)));

            results.push({
              message: "Complete event processed successfully",
              camunda: responseCamunda.data,
              database: responseQuery.map((res) => res.data),
            });
          }
        }
      } catch (error) {
        console.error(`Error executing handler for event: ${data?.eventKey || "unknown"}`, error);
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
