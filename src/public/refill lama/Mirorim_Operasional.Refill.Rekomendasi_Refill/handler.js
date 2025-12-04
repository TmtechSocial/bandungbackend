const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const GRAPHQL_API = process.env.GRAPHQL_API;

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];

    for (const item of data) {
      console.log("item looping", item);

      if (item.submissionGrid && Array.isArray(item.submissionGrid)) {
        console.log("item.submissionGrid is an array", item.submissionGrid);
        for (const subItem of item.submissionGrid) {
          console.log("subItem", subItem);
          try {
            let taskId;
            let instanceId = subItem.proc_inst_id || null;

            const dataCamunda = {
              type: "complete",
              endpoint: `/engine-rest/task/{taskId}/complete`,
              instance: subItem.proc_inst_id,
              variables: {
                variables: {
                  refill_operasional_rekomendasi: {
                    value: item.rekomendasi,
                    type: "boolean",
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
            if (
              responseCamunda.status === 200 ||
              responseCamunda.status === 204
            ) {
              // const instanceId = responseCamunda.data.processInstanceId;
              const dataQuery = {
                graph: {
                  method: "mutate",
                  endpoint: "http://192.168.1.85:9000/v1/graphql",
                  gqlQuery: "",
                  variables: {},
                },
                query: [],
              };

              const responseQuery = await configureQuery(fastify, dataQuery);

              results.push({
                message: "Create event processed successfully",
                camunda: responseCamunda.data,
                database: responseQuery.data,
              });
            }
          } catch (error) {
            console.error(
              `Error executing handler for event: ${eventKey}`,
              error
            );
            console.log(`graphql error: ${error.dataQuery}`);

            throw error;
          }
        }
      } else {
        try {
          let taskId;
          let instanceId = item.proc_inst_id || null;

          const dataCamunda = {
            type: "complete",
            endpoint: `/engine-rest/task/{taskId}/complete`,
            instance: item.proc_inst_id,
            variables: {
              variables: {
                refill_operasional_rekomendasi: {
                  value: item.rekomendasi,
                  type: "boolean",
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
          if (
            responseCamunda.status === 200 ||
            responseCamunda.status === 204
          ) {
            // const instanceId = responseCamunda.data.processInstanceId;
            const dataQuery = {
              graph: {
                method: "mutate",
                endpoint: GRAPHQL_API,
                gqlQuery: `mutation MyMutation($proc_inst_id: String!, $task_def_key: String!) { update_mo_refill(where: { proc_inst_id: { _eq: $proc_inst_id } }, _set: { task_def_key: $task_def_key }) { affected_rows } }`,
                variables: {
                  proc_inst_id: item.proc_inst_id,
                  task_def_key: item.rekomendasi
                    ? "Mirorim_Operasional.Refill.Terima_Refill"
                    : "Mirorim_Operasional.Reject_Refill",
                },
              },
            };

            const responseQuery = await configureQuery(fastify, dataQuery);

            results.push({
              message: "Create event processed successfully",
              camunda: responseCamunda.data,
              database: responseQuery.data,
            });
          }
        } catch (error) {
          console.error(
            `Error executing handler for event: ${eventKey}`,
            error
          );
          console.log(`graphql error: ${error.dataQuery}`);

          throw error;
        }
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
