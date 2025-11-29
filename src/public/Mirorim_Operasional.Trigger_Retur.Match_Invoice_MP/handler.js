const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")();
const GRAPHQL_API = process.env.GRAPHQL_API;

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];

    for (const item of data) {
      try {
        let instanceId = item.parent_inst_id || null;
        console.log("productsss", item.products)
        // Kirim ke Camunda
        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.parent_inst_id,
          variables: {
            variables: {
              invoice: { value: item.invoice || "", type: "string" },
              resi_match: { value: item.resi_match, type: "string" },
              resi_retur: { value: item.resi_retur, type: "string" },
              business_key: { value: item.resi_retur, type: "string" },
              barang: { value: item.barang_match || "match", type: "string" },
              status_invoice: { value: item.status_invoice || "komplain", type: "string" },
              AR: { value: "retur" || "", type: "string" },
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
                  $proc_inst_id: String!,
                  $task_def_key: String!,
                  $notes: String!,
                  $created_at: timestamp!,
                  $created_by: String!
                ) {
                  insert_retur_logs(objects: {
                    proc_inst_id: $proc_inst_id,
                    task_def_key: $task_def_key,
                    notes: $notes,
                    created_at: $created_at,
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

          if (!logs_id) throw new Error("Gagal ambil logs_id dari insert_retur_logs");

          const dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
                mutation MyMutation($parent_inst_id: String!, $invoice: String!, $task: String!, $evidence: [mo_retur_evidence_insert_input!]!, $date: timestamp!, $resi_retur: String!, $retur_type: String!, $item_match: String!) {
  update_mo_retur_receive(where: {parent_inst_id: {_eq: $parent_inst_id}}, _set: {invoice: $invoice, task_def_key: $task, unboxed_at: $date, resi_retur: $resi_retur, retur_type: $retur_type, item_match: $item_match}) {
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
                resi_retur: item.resi_retur,
                retur_type: item.status_invoice || "komplain",
                item_match: item.fisik_match ? "Barang Kita" : "Barang bukan milik kita",
                evidence: (item.evidence || []).map((file) => ({
                  proc_inst_id: item.parent_inst_id,
                  task_def_key: "Mirorim_Operasional.Trigger_Retur.Match_Invoice_MP",
                  file_name: file,
                  logs_id,
                })),
                date: item.unboxed_date,
                task: (() => {
                  if (item.resi_match === "not match") return "Reject, invalid invoice";
                  if (item.resi_match === "match" && item.barang_match === "match check")
                    return "Mirorim_Operasional.Retur.Physical_Check";
                  if (item.resi_match === "match" && item.barang_match === "match")
                    return "Mirorim_Operasional.Retur.Update_Status_MP";
                  if (item.resi_match === "match" && item.barang_match === "mismatch")
                    return "Mirorim_Operasional.Retur.Follow_Up_MP";
                  return "Unknown";
                })(),
              },
            },
            query: [],
          };

          await configureQuery(fastify, dataQuery);
          const productToInsert = (item.products || []).filter(p => p.check_item_exist === true);

          console.log("Produk yang akan di-insert:", productToInsert);

          const productQueries = productToInsert.map((product) => ({
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
      mutation InsertRetur(
        $resi_retur: String!,
        $invoice: String!,
        $part_pk: Int!,
        $quantity_retur: Int!,
        $quantity_complain: Int!,
        $quantity_ok: Int!,
        $quantity_not_ok: Int!,
        $retur_status: String!
      ) {
        insert_mo_retur(
          objects: {
            resi_retur: $resi_retur,
            invoice: $invoice,
            part_pk: $part_pk,
            quantity_retur: $quantity_retur,
            quantity_complain: $quantity_complain,
            quantity_ok: $quantity_ok,
            quantity_not_ok: $quantity_not_ok,
            retur_status: $retur_status
          }
        ) {
          returning {
            id
          }
        }
      }
    `,
              variables: {
                resi_retur: item.resi_retur,
                invoice: item.invoice,
                part_pk: product.part_pk,
                quantity_retur: product.quantity_retur,
                quantity_complain: product.quantity_complain || 0,
                quantity_ok: product.quantity_retur,
                quantity_not_ok: 0,
                retur_status: product.status,
              },
            },
            query: [],
          }));

          const responseQuery = await Promise.all(
            productQueries.map((q) => configureQuery(fastify, q))
          );

          console.log("responseQuery", JSON.stringify(responseQuery, null, 2));

          results.push({
            message: "Complete event processed successfully",
            database: responseQuery,
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

  return await eventHandlers[eventKey](data, process);
};

module.exports = { handle };
