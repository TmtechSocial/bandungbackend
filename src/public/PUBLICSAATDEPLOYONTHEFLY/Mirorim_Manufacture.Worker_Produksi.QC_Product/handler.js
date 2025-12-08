const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")();
const axios = require("axios");

const GRAPHQL_API = process.env.GRAPHQL_API;
const CAMUNDA_API = process.env.CAMUNDA_API;

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];

    for (const item of data) {
      try {
        let responseCamunda = null;
        const instanceId = item.proc_inst_id || null;
        const statusValue = item.insert_status || "";

        console.log("📦 Status:", statusValue);

        // 🟢 CASE: Finish → complete Camunda task
        if (statusValue == "Finish") {
          const dataCamunda = {
            type: "complete",
            endpoint: `/engine-rest/task/{taskId}/complete`,
            instance: instanceId,
            variables: {
              variables: {
              },
            },
          };

          try {
            responseCamunda = await camundaConfig(dataCamunda, instanceId, process);
            console.log("✅ Camunda complete success:", responseCamunda.status);
          } catch (err) {
            console.error("❌ Camunda complete failed:", err.message || err);
          }
        }

        // 🟡 CASE: Pause → unclaim Camunda task
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

              console.log(`🚧 Task ${taskId} unclaimed for instance: ${instanceId}`);
              responseCamunda = { status: unclaimResponse.status, taskId };
            } else {
              console.warn("⚠️ No active task found for instance:", instanceId);
            }
          } catch (err) {
            console.error("❌ Failed to unclaim task:", err.message || err);
          }
        }

        // 🧩 GraphQL mutation
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
                $user_qc: String!
              ) {
                update_task_worker(
                  where: {proc_inst_id: {_eq: $proc_inst_id}},
                  _set: {
                    task_def_key: $task,
                    user_qc : $user_qc
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
            },
          },
          query: [],
        };

        const responseQuery = await configureQuery(fastify, dataQuery);
        console.log("🧩 Query result:", JSON.stringify(responseQuery));

        results.push({
          message: "✅ Create event processed successfully",
          camunda: responseCamunda?.data || null,
          database: responseQuery?.data || null,
        });
      } catch (error) {
        console.error("❌ Error executing onSubmit:", error);
        results.push({
          message: "❌ Failed processing item",
          error: error.message || error,
        });
      }
    }

    return results;
  },

  async onChange(data) {
    console.log("🔄 Handling onChange with data:", data);
    return { message: "onChange executed", data };
  },
};

const handle = async (eventData) => {
  const { eventKey, data, process } = eventData;
  console.log("📨 Received eventData:", eventData);

  if (!eventHandlers[eventKey]) {
    throw new Error(`No handler found for event: ${eventKey}`);
  }

  try {
    return await eventHandlers[eventKey](data, process);
  } catch (err) {
    console.error(`❌ Error executing handler for event: ${eventKey}`, err);
    throw err;
  }
};

module.exports = { handle };
