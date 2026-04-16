const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")();
const axios = require("axios");

const GRAPHQL_API = process.env.GRAPHQL_API;
const CAMUNDA_API = process.env.CAMUNDA_API;
const SERVER_INVENTREE = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];

    for (const item of data) {
      try {
        let responseCamunda = null;
        const instanceId = item.proc_inst_id || null;
        const statusValue = item.insert_status || "";
        const inventree = axios.create({
          baseURL: `${SERVER_INVENTREE}/api`,
          headers: {
            Authorization: `Token ${INVENTREE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          timeout: 10000,
        });

        console.log("?? Status:", statusValue);

        // ?? CASE: Finish ? complete Camunda task
        if (statusValue == "Finish") {
          const dataCamunda = {
            type: "complete",
            endpoint: `/engine-rest/task/{taskId}/complete`,
            instance: instanceId,
            variables: {
              variables: {
                exception_handling: {
                  value: item.finish_sebagian,
                  type: "String",
                },
                quantity_finish: {
                  value: item.quantity_finish || 0,
                  type: "Integer",
                },
                quantity_request: {
                  value: item.quantity_request,
                  type: "Integer",
                },
              },
            },
          };

          try {
            responseCamunda = await camundaConfig(dataCamunda, instanceId, process);
            console.log("? Camunda complete success:", responseCamunda.status);
          } catch (err) {
            console.error("? Camunda complete failed:", err.message || err);
          }
        }

        // ?? CASE: Pause ? unclaim Camunda task
        if (statusValue === "Pause") {
          try {
            const taskResponse = await axios.get(`${CAMUNDA_API}engine-rest/task`, {
              params: { processInstanceId: instanceId },
            });

            if (taskResponse.data && taskResponse.data.length > 0) {
              const taskId = taskResponse.data[0].id;

              const unclaimResponse = await axios.post(
                `${CAMUNDA_API}engine-rest/task/${taskId}/unclaim`
              );

              console.log(`?? Task ${taskId} unclaimed for instance: ${instanceId}`);
              responseCamunda = { status: unclaimResponse.status, taskId };
            } else {
              console.warn("?? No active task found for instance:", instanceId);
            }
          } catch (err) {
            console.error("? Failed to unclaim task:", err.message || err);
          }
        }

        let quantity_request = 0;
        if (item.finish_sebagian === "Ya") {
          quantity_finish = Number(item.quantity_finish || 0);
          quantity_request = Number(item.quantity_request || 0) - quantity_finish;

          if (quantity_request <= 0) {
            throw new Error("? Quantity request sebagian tidak valid");
          }

          // ?? Cari Build
          const buildResponse = await inventree.get(
            `/build/?reference=${encodeURIComponent(item.reference)}`
          );

          const buildData = buildResponse.data;

          let buildList = [];
          if (Array.isArray(buildData)) {
            buildList = buildData;
          } else if (Array.isArray(buildData?.results)) {
            buildList = buildData.results;
          }

          const buildId = buildList?.[0]?.pk;

          if (!buildId) {
            console.error("Build response:", JSON.stringify(buildData, null, 2));
            throw new Error(
              `? Build Order dengan reference '${item.reference}' tidak ditemukan`
            );
          }

          console.log(`? Build ID ditemukan: ${buildId}`);

          const today = new Date().toISOString().split("T")[0];

          // ?? Create Output (Produksi Sebagian)
          const payloadOutput = {
            quantity: quantity_finish,
            batch_code: `PRODUKSI ${today}`,
          };
          await inventree.post(
            `/build/${buildId}/create-output/`,
            payloadOutput
          );
          console.log("? Output build berhasil dibuat");
          // ?? Ambil stock hasil build
          const stockResponse = await inventree.get(
            `/stock/?build=${buildId}&ordering=-updated&limit=1`
          );
          const stockData = stockResponse.data;
          let stockList = [];
          if (Array.isArray(stockData)) {
            stockList = stockData;
          } else if (Array.isArray(stockData?.results)) {
            stockList = stockData.results;
          }
          const latestStockItem = stockList?.[0];
          if (!latestStockItem) {
            throw new Error("? Stock item hasil build tidak ditemukan.");
          }
          const stockItemId = latestStockItem.pk;
          console.log(`? Stock item ID ditemukan: ${stockItemId}`);
          const endpointFinish = `/build/${buildId}/complete/`;
          const payloadFinish = {
            outputs: [
              {
                output: stockItemId, // ?? FIX disini
              },
            ],
            location: item.sku_available,
            status_custom_key: 10,
            notes: `Exception Handling Proc Inst Id : ${item.proc_inst_id}`,
          };

          console.log("?? Mengirim payload finish:", payloadFinish);

          const resFinish = await inventree.post(
            endpointFinish,
            payloadFinish
          );

          console.log("? Response Finish:", resFinish.data);
          console.log("? Stock berhasil dipindahkan ke lokasi tujuan");
        } else {
          quantity_request = Number(item.quantity_request || 0);
        }

        // ?? GraphQL mutation
        const currentDate = new Date(Date.now() + 7 * 60 * 60 * 1000)
          .toISOString()
          .replace("T", " ")
          .substring(0, 19);

        const dataQuery = {
          graph: {
            method: "mutate",
            endpoint: GRAPHQL_API,
            gqlQuery: `
              mutation MyMutation(
                $proc_inst_id: String!,
                $task: String!,
                $date: timestamp!,
                $task_worker_id: Int!,
                $proc_def_key: String!,
                $status: String!,
                $task_def_key: String!,
                $user_qc: String!,
                $quantity_request: Int!,
              ) {
                update_task_worker(
                  where: {proc_inst_id: {_eq: $proc_inst_id}},
                  _set: {
                    task_def_key: $task,
                    user_qc : $user_qc,
                    quantity_request: $quantity_request,
                  }
                ) {
                  affected_rows
                }
                insert_task_worker_log(
                  objects: {
                    date_time: $date,
                    task_worker_id: $task_worker_id,
                    proc_def_key: $proc_def_key,
                    status: $status,
                    task_def_key: $task_def_key
                  }
                ) {
                  affected_rows
                }
              }
            `,
            variables: {
              proc_inst_id: item.proc_inst_id,
              task: "Mirorim_Manufacture.Worker_Produksi.QC_Product",
              task_def_key: "Mirorim_Manufacture.Worker_Produksi.QC_Product",
              date: currentDate,
              task_worker_id: item.id,
              proc_def_key: "Mirorim_Manufacture.Worker_Produksi",
              status: statusValue,
              user_qc: item.user_qc || "",
              quantity_request: quantity_request || 0,
            },
          },
          query: [],
        };


        const responseQuery = await configureQuery(fastify, dataQuery);
        console.log("?? Query result:", JSON.stringify(responseQuery));

        results.push({
          message: "? Create event processed successfully",
          camunda: responseCamunda?.data || null,
          database: responseQuery?.data || null,
        });
      } catch (error) {
        console.error("? Error executing onSubmit:", error);
        results.push({
          message: "? Failed processing item",
          error: error.message || error,
        });
      }
    }

    return results;
  },

  async onChange(data) {
    console.log("?? Handling onChange with data:", data);
    return { message: "onChange executed", data };
  },
};

const handle = async (eventData) => {
  const { eventKey, data, process } = eventData;
  console.log("?? Received eventData:", eventData);

  if (!eventHandlers[eventKey]) {
    throw new Error(`No handler found for event: ${eventKey}`);
  }

  try {
    return await eventHandlers[eventKey](data, process);
  } catch (err) {
    console.error(`? Error executing handler for event: ${eventKey}`, err);
    throw err;
  }
};

module.exports = { handle };
