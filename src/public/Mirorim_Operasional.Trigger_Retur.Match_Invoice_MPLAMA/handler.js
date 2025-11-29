const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")();
const GRAPHQL_API = process.env.GRAPHQL_API;
const fetch = require("node-fetch");
const axios = require("axios");
const { unclaimTask } = require("../../utils/camunda/camundaClaim");

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];

    for (const item of data) {
      try {
        let instanceId = item.parent_inst_id || null;
        // Kirim ke Camunda
        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.parent_inst_id,
          variables: {
            variables: {
              invoice: { value: item.invoice || "", type: "string" },
              resi_match: { value: item.resi_match, type: "string" },
              barang: { value: item.barang_match || "match", type: "string" },
              AR: { value: "retur" || "", type: "string" },
              status: { value: "Dikirim" || "", type: "string" },
            },
          },
        };

        const responseCamunda = await camundaConfig(
          dataCamunda,
          instanceId,
          process
        );

        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
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
                proc_inst_id: item.parent_inst_id,
                task_def_key: "Mirorim_Operasional.Trigger_Retur.Match_Invoice_MP",
                notes: item.notes_on_duty || "",
                created_at: item.unboxed_date || new Date().toISOString(),
                created_by: item.created_by || "unknown",
              },
            },
            query: [],
          };
          const logResponse = await configureQuery(fastify, insertLogQuery);

const logs_id = logResponse?.data?.[0]?.graph?.insert_retur_logs?.returning?.[0]?.id;

        if (!logs_id) {
          throw new Error("Gagal ambil logs_id dari insert_retur_logs");
        }

          const dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `mutation MyMutation($parent_inst_id: String!, $invoice: String!, $resi: String!, $task: String!, $evidence: [mo_retur_evidence_insert_input!]!, $date: timestamp!) {
  update_mo_retur_receive(where: {parent_inst_id: {_eq: $parent_inst_id}}, _set: {invoice: $invoice, task_def_key: $task, unboxed_at: $date, resi_retur: $resi}) {
    affected_rows
  }
  insert_mo_retur_evidence(objects: $evidence) {
    affected_rows
  }
}
`,
              variables: {
                parent_inst_id: item.parent_inst_id,
                invoice: item.invoice,
                resi: item.resi_retur,
                evidence: (item.evidence || []).map((file) => ({
                  proc_inst_id: item.parent_inst_id,
                  task_def_key:
                  "Mirorim_Operasional.Trigger_Retur.Match_Invoice_MP",
                  file_name: file,
                  logs_id,
                })),
                date: item.unboxed_date,
                task: (() => {
                  if (item.resi_match === "not match") {
                    return "Reject, invalid invoice";
                  }
                  if (
                    item.resi_match === "match" &&
                    item.barang_match === "match check"
                  ) {
                    return "Mirorim_Operasional.Retur.Physical_Check";
                  }
                  if (
                    item.resi_match === "match" &&
                    item.barang_match === "match"
                  ) {
                    return "Mirorim_Operasional.Retur.Update_Status_MP";
                  }
                  if (
                    item.resi_match === "match" &&
                    item.barang_match === "mismatch"
                  ) {
                    return "Mirorim_Operasional.Retur.Follow_Up_MP";
                  }
                  return "Unknown";
                })(),
              },
            },
            query: [],
          };

          const productQueries = item.products.map((product) => ({
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
        mutation UpdateOrderProduct(
          $invoice: String!, 
          $sku_toko: String!, 
          $status: String
        ) {
          update_mo_order_shop(
            where: {
              invoice: {_eq: $invoice}, 
              sku_toko: {_eq: $sku_toko}
            },
            _set: {return_condition: $status}
          ) {
            affected_rows
          }
        }
      `,
              variables: {
                invoice: item.invoice,
                sku_toko: product.sku_toko,
status: product.status && product.status.trim() !== "" ? product.status : null,
              },
            },
            query: [],
          }));

          const allQueries = [dataQuery, ...productQueries];
          const responseQuery = await Promise.all(
            allQueries.map((query) => configureQuery(fastify, query))
          );
          console.log("dataQuery", allQueries);
console.log("responseQuery", JSON.stringify(responseQuery, null, 2));
          results.push({
            message: "Complete event processed successfully",
            camunda: responseCamunda.data,
            database: responseQuery.data,
          });
        }
      } catch (error) {
        console.error(
          `Error executing handler for event: ${data?.eventKey || "unknown"}`,
          error
        );
        throw error;
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
