const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")();
const GRAPHQL_API = process.env.GRAPHQL_API;

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];

    for (const item of data) {
      try {
        const instanceId = item.proc_inst_id || null;

        // 🔹 1. Complete task di Camunda
        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: instanceId,
          variables: { variables: {} },
        };

        const responseCamunda = await camundaConfig(dataCamunda, instanceId, process);
        console.log("✅ responseCamunda:", responseCamunda?.status);

        if (responseCamunda?.status === 200 || responseCamunda?.status === 204) {
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
            logResponse?.data?.[0]?.graph?.insert_mo_order_logs?.returning?.[0]?.id;

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

            const evidenceResponse = await configureQuery(fastify, evidenceQuery);
            console.log("📎 evidenceResponse:", JSON.stringify(evidenceResponse, null, 2));
          }

          results.push({
            message: "✅ Event processed successfully",
            instanceId,
            logs_id,
          });
        } else {
          throw new Error(`Camunda response not OK: ${responseCamunda?.status}`);
        }
      } catch (error) {
        console.error(`❌ Error executing onSubmit for instance ${item.proc_inst_id}:`, error.message);
        results.push({
          error: true,
          message: error.message,
          instance: item.proc_inst_id,
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

// 🔹 Wrapper utama
const handle = async (eventData) => {
  const { eventKey, data, process } = eventData;
  console.log("📦 eventData diterima:", JSON.stringify(eventData, null, 2));

  const handler = eventHandlers[eventKey];
  if (!handler) {
    throw new Error(`No handler found for event: ${eventKey}`);
  }

  try {
    return await handler(data, process);
  } catch (error) {
    console.error(`❌ Error executing handler for event: ${eventKey}`, error);
    throw error;
  }
};

module.exports = { handle };
