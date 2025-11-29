const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const GRAPHQL_API = process.env.GRAPHQL_API;

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];
    for (const item of data) {
      try {
        let taskId;
        let instanceId = item.proc_inst_id || null;

        const statusValue = item.insert_status?.value || "";
        console.log("📦 Status", statusValue);

        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {
              quantity_finish: { value: item.quantity_finish, type: "Integer" },
              quantity_request: {
                value: item.quantity_request,
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
        console.log("responseCamunda", responseCamunda);
        if (item.proc_inst_id) {
          const statusValue = item.insert_status?.value || "";
          console.log("📦 Status", statusValue);
          // const instanceId = responseCamunda.data.processInstanceId;
          const dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
                mutation MyMutation(
                  $proc_inst_id: String!,
                  $task: String!,
                  $quantity_finish: Int!,
                  $date: timestamp!,
                  $task_worker_id: Int!,
                  $proc_def_key: String!,
                  $status: String!,
                  $task_def_key: String!
                ) {
                  update_task_worker(
                    where: {proc_inst_id: {_eq: $proc_inst_id}},
                    _set: {
                      task_def_key: $task,
                      quantity_finish: $quantity_finish
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
                task: "Mirorim_Manufacture.Worker_Produksi.Processing_Product",
                task_def_key:
                  "Mirorim_Manufacture.Worker_Produksi.Processing_Product",
                quantity_finish: item.quantity_finish || 0,
                date: new Date(Date.now() + 7 * 60 * 60 * 1000)
                  .toISOString()
                  .replace("T", " ")
                  .substring(0, 19),
                task_worker_id: item.id,
                proc_def_key: "Mirorim_Manufacture.Worker_Produksi",
                status: item.insert_status?.value?.toString() ?? "",
              },
            },
            query: [],
          };
          const responseQuery = await configureQuery(fastify, dataQuery);
          console.log("Query result:", JSON.stringify(responseQuery));

          results.push({
            message: "Create event processed successfully",
            camunda: responseCamunda.data,
            database: responseQuery.data,
          });
        }
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
