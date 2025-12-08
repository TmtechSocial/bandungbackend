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
                          date_timer: { value: item.date_timer, type: "String" },
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
          responseCamunda?.status === 200 ||
          responseCamunda?.status === 204
        ) {
          // 🔹 2. Insert logs ke Hasura
          const logQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
                        mutation insertLogs(
                          $invoice: String!,
                          $task_def_key: String!,
                          $notes: String!,
                          $created_at: timestamp!,
                          $created_by: String!,
                          $proc_def_key: String!,
                          $status: String!
                        ) {
                          insert_mo_order_logs(
                            objects: {
                              invoice: $invoice,
                              task_def_key: $task_def_key,
                              notes: $notes,
                              created_at: $created_at,
                              created_by: $created_by,
                              proc_def_key: $proc_def_key,
                              status: $status
                            }
                          ) {
                            returning { id }
                          }
                        }
                      `,
              variables: {
                invoice: item.invoice,
                task_def_key: "Mirorim_Operasional.Finish_Order.FollowUP_AR_MP",
                notes: item.notes || "",
                created_at: item.created_at,
                created_by: item.created_by,
                proc_def_key: "Mirorim_Operasional.Finish_Order",
                status: item.status || "unknown",
              },
            },
            query: [],
          };

          const logResponse = await configureQuery(fastify, logQuery);
          console.log("🧾 logResponse:", JSON.stringify(logResponse, null, 2));

          const logs_id =
            logResponse?.data?.[0]?.graph?.insert_mo_order_logs?.returning?.[0]
              ?.id;

          if (!logs_id) {
            console.error("❌ Gagal ambil logs_id dari insert_mo_order_logs");
            throw new Error("Gagal ambil logs_id dari insert_mo_order_logs");
          }

          // 🔹 3. Insert evidence jika ada file
          if (Array.isArray(item.evidence) && item.evidence.length > 0) {
            const evidenceQuery = {
              graph: {
                method: "mutate",
                endpoint: GRAPHQL_API,
                gqlQuery: `
                          mutation insertEvidence($evidence: [mo_closing_evidence_insert_input!]!) {
                            insert_mo_closing_evidence(objects: $evidence) {
                              affected_rows
                            }
                          }
                        `,
                variables: {
                  evidence: item.evidence.map((file) => ({
                    file_name: file,
                    logs_id,
                  })),
                },
              },
              query: [],
            };

            const evidenceResponse = await configureQuery(
              fastify,
              evidenceQuery
            );
            console.log(
              "📎 evidenceResponse:",
              JSON.stringify(evidenceResponse, null, 2)
            );
          }

          results.push({
            message: "✅ Event processed successfully",
            // instanceId,
            logs_id,
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
