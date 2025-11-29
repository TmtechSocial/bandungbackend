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

        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {
              banding: { value: item.banding, type: "string" },
              date_banding: { value: item.date_banding || "PT1S", type: "string" },
            },
          },
        };

        const responseCamunda = await camundaConfig(
          dataCamunda,
          instanceId,
          process
        );
        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          // const instanceId = responseCamunda.data.processInstanceId;
          const dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
              mutation InsertReturLogs(
                $proc_inst_id: String!
                $task_def_key: String!
                $notes: String!
                $created_at: timestamp!
                $created_by: String!
              ) {
                insert_retur_logs(objects: {
                  proc_inst_id: $proc_inst_id
                  task_def_key: $task_def_key
                  notes: $notes
                  created_at: $created_at
                  created_by: $created_by
                }) {
                returning { id }
                }
              }             
              `,
              variables: {
                proc_inst_id: item.proc_inst_id,
                task_def_key: "Mirorim_Operasional.Retur.Comparison_Result_MP",
                notes: item.notes || "",
                created_at: item.created_at || new Date().toISOString(),
                created_by: item.created_by || "unknown",
              },
            },
            query: [],
          };

          const responseQuery = await configureQuery(fastify, dataQuery);

          console.log("responseQuery", JSON.stringify(responseQuery, null, 2));

          const logs_id =
            responseQuery?.data?.[0]?.graph?.insert_retur_logs?.returning?.[0]
              ?.id;

          if (!logs_id) {
            throw new Error("Gagal ambil logs_id dari insert_retur_logs");
          }

          const returReceiveQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
                  mutation UpdateReturReceive(
                    $evidence: [mo_retur_evidence_insert_input!]!
                  ) {
                    insert_mo_retur_evidence(objects: $evidence) {
                      affected_rows
                    }
                  }
                `,
              variables: {
                evidence: (item.evidence || []).map((file) => ({
                  proc_inst_id: item.proc_inst_id,
                  task_def_key:
                    "Mirorim_Operasional.Retur.Comparison_Result_MP",
                  file_name: file,
                  logs_id,
                })),
              },
            },
            query: [],
          };

          const returReceiveResponse = await configureQuery(
            fastify,
            returReceiveQuery
          );

          console.log(
            "returReceiveResponse",
            JSON.stringify(returReceiveResponse, null, 2)
          );

          results.push({
            message: "Create event processed successfully",
            camunda: responseCamunda.data,
            database: returReceiveResponse.data,
          });
        }
      } catch (error) {
        console.error(`Error executing handler for event: ${eventKey}`, error);
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
