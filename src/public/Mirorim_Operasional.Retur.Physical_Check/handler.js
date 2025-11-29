const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const GRAPHQL_API = process.env.GRAPHQL_API;

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];

    for (const item of data) {
      try {
        const instanceId = item.proc_inst_id || null;

        // 🔹 Complete Camunda task
        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: instanceId,
          variables: {
            variables: {
              quality: { value: item.quality, type: "string" },
            },
          },
        };

        const camundaRes = await camundaConfig(dataCamunda, instanceId, process);
        if (![200, 204].includes(camundaRes.status))
          throw new Error("Camunda task completion failed");

        // 🔹 Insert retur log
        const insertLogQuery = {
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
              task_def_key: "Mirorim_Operasional.Retur.Physical_Check",
              notes: item.notes || "",
              created_at: item.created_at || new Date().toISOString(),
              created_by: item.created_by || "unknown",
            },
          },
          query: [],
        };

        const logRes = await configureQuery(fastify, insertLogQuery);
        const logs_id =
          logRes?.data?.[0]?.graph?.insert_retur_logs?.returning?.[0]?.id ?? null;
        if (!logs_id) throw new Error("Gagal ambil logs_id dari insert_retur_logs");

        // 🔹 Update retur receive & insert evidence
        const returReceiveQuery = {
          graph: {
            method: "mutate",
            endpoint: GRAPHQL_API,
            gqlQuery: `
              mutation UpdateReturReceive(
                $proc_inst_id: String!, 
                $task: String!, 
                $evidence: [mo_retur_evidence_insert_input!]!
              ) {
                update_mo_retur_receive(
                  where: {proc_inst_id: {_eq: $proc_inst_id}}, 
                  _set: { task_def_key: $task }
                ) { affected_rows }

                insert_mo_retur_evidence(objects: $evidence) {
                  affected_rows
                }
              }
            `,
            variables: {
              proc_inst_id: item.proc_inst_id,
              task:
                item.quality === "ok"
                  ? "Mirorim_Operasional.Retur.Update_Status_MP"
                  : "Mirorim_Operasional.Retur.Follow_Up_MP",
              evidence: (item.evidence || []).map((file) => ({
                proc_inst_id: item.proc_inst_id,
                task_def_key: "Mirorim_Operasional.Retur.Physical_Check",
                file_name: typeof file === "object" ? file.name || file.file_name : file,
                logs_id,
              })),
            },
          },
          query: [],
        };

        // 🔹 Update retur product quantities
        const productQueries = item.products.map((product) => ({
          graph: {
            method: "mutate",
            endpoint: GRAPHQL_API,
            gqlQuery: `
              mutation UpdateOrderProduct(
                $invoice: String!, 
                $part_pk: Int!, 
                $quantity_ok: Int!,
                $quantity_not_ok: Int!
              ) {
                update_mo_retur(
                  where: {
                    invoice: { _eq: $invoice }, 
                    part_pk: { _eq: $part_pk }
                  },
                  _set: {
                    quantity_ok: $quantity_ok, 
                    quantity_not_ok: $quantity_not_ok
                  }
                ) {
                  affected_rows
                }
              }
            `,
            variables: {
              invoice: item.invoice,
              part_pk: product.part_pk,
              quantity_ok: product.quantity_ok,
              quantity_not_ok: product.quantity_not_ok,
            },
          },
          query: [],
        }));

        const allQueries = [returReceiveQuery, ...productQueries];
        const gqlResponses = await Promise.all(
          allQueries.map(async (q, i) => {
            try {
              return await configureQuery(fastify, q);
            } catch (err) {
              console.error(`❌ GQL Query[${i}] failed:`, err.message);
              console.error("Query vars:", JSON.stringify(q.graph.variables, null, 2));
              throw err;
            }
          })
        );

        results.push({
          message: "Create event processed successfully",
          camunda: camundaRes.data,
          database: gqlResponses.map((r) => r.data),
        });

      } catch (error) {
        console.error(`❌ Error in onSubmit for proc_inst_id: ${item.proc_inst_id}`);
        console.error("Message:", error.message);
        throw error;
      }
    }

    return results;
  },

  async onChange(data) {
    return { message: "onChange executed", data };
  },
};

const handle = async (eventData) => {
  const { eventKey, data, process } = eventData;
  if (!eventHandlers[eventKey]) throw new Error(`No handler found for event: ${eventKey}`);

  try {
    return await eventHandlers[eventKey](data, process);
  } catch (error) {
    console.error(`Error executing handler for event: ${eventKey}`, error);
    throw error;
  }
};

module.exports = { handle };