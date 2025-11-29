const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const GRAPHQL_API = process.env.GRAPHQL_API;
const CAMUNDA_API = process.env.CAMUNDA_API;
const axios = require("axios");

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];
    for (const item of data) {
      try {
        let taskId;
        let instanceId = item.proc_inst_id || null;
        let responseCamunda = null;

        const statusValue = item.insert_status?.value || "";

        console.log("📦 Status:", statusValue);

        // Jalankan CAMUNDA kalau status "finish"
        if (statusValue === "Finish") {
          const dataCamunda = {
            type: "complete",
            endpoint: `/engine-rest/task/{taskId}/complete`,
            instance: item.proc_inst_id,
            variables: {
              variables: {},
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
        }

        if (statusValue === "Pause") {
          try {
            // Ambil task dari instance ID
            const taskResponse = await axios.get(`${CAMUNDA_API}engine-rest/task`, {
              params: { processInstanceId: instanceId },
            });            

            if (taskResponse.data && taskResponse.data.length > 0) {
              const taskId = taskResponse.data[0].id;
              // Unclaim task
              const unclaimResponse = await axios.post(`${CAMUNDA_API}engine-rest/task/${taskId}/unclaim`);

              responseCamunda = { status: unclaimResponse.status, taskId };
            } else {
              console.warn("⚠️ No active task found for instance:", instanceId);
            }
          } catch (unclaimError) {
            console.error("❌ Failed to unclaim task:", unclaimError.message || unclaimError);
          }
        }

          const dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `mutation MyMutation(
      $date: timestamp!, 
      $prepare_internal_id: Int!,
      $status: String!, 
      $task_def_key: String!, 
      $notes: String!,
        $created_by: String!,
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
    }`,
              variables: {
                date: new Date(Date.now() + 7 * 60 * 60 * 1000)
                .toISOString()
                .replace("T", " ")
                .substring(0, 19),
                prepare_internal_id: item.id,
                status: item.insert_status?.value?.toString() ?? "",
                task_def_key: "Mirorim_Warehouse.Internal_Prepare.Processing_Product_Prepare",
                notes: item.notes || "",
                created_by: item.created_by || ""
              },
            },
          };

          const responseQuery = await configureQuery(fastify, dataQuery);
          console.log("✅ Database success:", JSON.stringify(responseQuery.data, null, 2));

          results.push({
            message: "Create event processed successfully",
            camunda: responseCamunda?.data || null,
            database: responseQuery.data,
          });
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
