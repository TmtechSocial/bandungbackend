const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const GRAPHQL_API = process.env.GRAPHQL_API;

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];

    for (const item of data) {
      const statusValue = item.insert_status?.value || "";
      const instanceId = item.proc_inst_id || null;
      let responseCamunda = null;

      try {
        console.log("📦 Status:", statusValue);

        // Jalankan CAMUNDA kalau status "finish"
        if (statusValue === "Finish") {
          const dataCamunda = {
            type: "complete",
            endpoint: `/engine-rest/task/{taskId}/complete`,
            instance: item.proc_inst_id,
            variables: {
              variables: {
              },
            },
          };

          try {
            responseCamunda = await camundaConfig(dataCamunda, instanceId, process);
            console.log("✅ Camunda complete success:", responseCamunda.status);
          } catch (camundaError) {
            console.error("❌ Camunda complete failed:", camundaError.message || camundaError);
            // Jangan lempar error agar GraphQL tetap lanjut
          }
        }

        // Jalankan GRAPHQL di semua kondisi
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
              date: new Date(Date.now() + 7 * 60 * 60 * 1000)
                .toISOString()
                .replace("T", " ")
                .substring(0, 19),
              task_worker_id: item.id,
              proc_def_key: "Mirorim_Manufacture.Worker_Produksi",
              status: statusValue,
              user_qc: item.user_qc || "",
            },
          },
          query: [],
        };

        const responseQuery = await configureQuery(fastify, dataQuery);
        console.log("✅ GraphQL success:", JSON.stringify(responseQuery));

        results.push({
          message: "Event processed successfully",
          camunda: responseCamunda?.data || null,
          database: responseQuery.data,
        });
      } catch (error) {
        console.error("❌ Handler error:", error);
        results.push({
          message: "Error occurred",
          error: error.message || error,
        });
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
