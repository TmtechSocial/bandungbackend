const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")();
const GRAPHQL_API = process.env.GRAPHQL_API;

const getBarangReturStatus = (item) => {
  if (item.barang_retur === null || item.barang_retur === undefined) {
    return "resi not match";
  }
  return item.barang_retur ? "isi barang ada" : "barang tidak ada";
};

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];

    for (const item of data) {
      try {
        const instanceId = item.parent_inst_id || null;
        const barang_retur = getBarangReturStatus(item);
        const fisik_match = item.fisik_match ? "Barang Kita" : "Barang bukan milik kita";

        /** ================= CAMUNDA ================= */
        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: instanceId,
          variables: {
            variables: {
              invoice: { value: item.invoice || "", type: "string" },
              resi_match: { value: item.resi_match, type: "string" },
              status_barang_retur: { value: barang_retur || "resi not match", type: "string" },
              fisik_match: { value: fisik_match || "Barang bukan milik kita", type: "string" },
              resi_retur: { value: item.resi_retur, type: "string" },
              business_key: { value: item.resi_retur, type: "string" },
              barang: { value: item.barang_match || "match", type: "string" },
              AR: { value: "retur", type: "string" },
            },
          },
        };

        const responseCamunda = await camundaConfig(
          dataCamunda,
          instanceId,
          process
        );

        if (![200, 204].includes(responseCamunda.status)) continue;

        /** ================= LOGS ================= */
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
              task_def_key:
                "Mirorim_Operasional.Trigger_Retur.Match_Invoice_MP",
              notes: item.notes_on_duty || "",
              created_at: item.unboxed_date || new Date().toISOString(),
              created_by: item.created_by || "unknown",
            },
          },
          query: [],
        };

        const logResponse = await configureQuery(fastify, insertLogQuery);
        const logs_id =
          logResponse?.data?.[0]?.graph?.insert_retur_logs?.returning?.[0]?.id;

        if (!logs_id) throw new Error("Gagal ambil logs_id");

        /** ================= UPDATE HEADER ================= */
        const headerQuery = {
          graph: {
            method: "mutate",
            endpoint: GRAPHQL_API,
            gqlQuery: `
              mutation UpdateRetur(
                $parent_inst_id: String!,
                $invoice: String!,
                $evidence: [mo_retur_evidence_insert_input!]!,
                $date: timestamp!,
                $resi_retur: String!,
                $item_match: String!,
                $status_barang_retur: String!
              ) {
                update_mo_retur_receive(
                  where: { parent_inst_id: { _eq: $parent_inst_id } },
                  _set: {
                    invoice: $invoice,
                    unboxed_at: $date,
                    resi_retur: $resi_retur,
                    item_match: $item_match,
                    status_barang_retur: $status_barang_retur
                  }
                ) {
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
              status_barang_retur : barang_retur,
              item_match: fisik_match,
              date: item.unboxed_date,
              evidence: (item.evidence || []).map((file) => ({
                proc_inst_id: item.parent_inst_id,
                task_def_key:
                  "Mirorim_Operasional.Trigger_Retur.Match_Invoice_MP",
                file_name: file,
                logs_id,
              })),
            },
          },
          query: [],
        };

        await configureQuery(fastify, headerQuery);

        /** ================= DETAIL PRODUK ================= */
        const products =
          barang_retur === "isi barang ada" && fisik_match === "Barang Kita"
            ? (item.products || []).filter(
                (p) => p.check_item_exist === true
              )
            : item.products || [];

        const productQueries = products.map((product) => ({
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
                insert_mo_retur(objects: {
                  resi_retur: $resi_retur,
                  invoice: $invoice,
                  part_pk: $part_pk,
                  quantity_retur: $quantity_retur,
                  quantity_complain: $quantity_complain,
                  quantity_ok: $quantity_ok,
                  quantity_not_ok: $quantity_not_ok,
                  retur_status: $retur_status
                }) {
                  returning { id }
                }
              }
            `,
            variables: {
              resi_retur: item.resi_retur,
              invoice: item.invoice,
              part_pk: product.part_pk,
              quantity_retur:
                barang_retur === "isi barang ada" && fisik_match === "Barang Kita"
                  ? product.quantity_retur
                  : 0,
              quantity_complain: product.quantity_complain || 0,
              quantity_ok:
                barang_retur === "isi barang ada" && fisik_match === "Barang Kita"
                  ? product.quantity_retur
                  : 0,
              quantity_not_ok: 0,
              retur_status:
                barang_retur === "isi barang ada" && fisik_match === "Barang Kita"
                  ? product.status
                  : "bukan milik kita",
            },
          },
          query: [],
        }));

        const responseQuery = await Promise.all(
          productQueries.map((q) => configureQuery(fastify, q))
        );

        results.push({
          message: "Complete event processed successfully",
          database: responseQuery,
        });
      } catch (error) {
        console.error("Error onSubmit:", error);
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

  if (!eventHandlers[eventKey]) {
    throw new Error(`No handler found for event: ${eventKey}`);
  }

  return eventHandlers[eventKey](data, process);
};

module.exports = { handle };
