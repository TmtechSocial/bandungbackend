const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const GRAPHQL_API = process.env.GRAPHQL_API;
const SERVER_INVENTREE = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;
const axios = require("axios");

const inventree = axios.create({
  baseURL: `${SERVER_INVENTREE}/api`,
  headers: {
    Authorization: `Token ${INVENTREE_API_TOKEN}`,
    "Content-Type": "application/json",
  },
  timeout: 10000,
});

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];

    for (const item of data) {
      try {
        let instanceId = item.proc_inst_id || null;

        const hasilparse = {
          ...item,

          loop_upload: Array.isArray(item.loop_upload)
            ? item.loop_upload.map((prod) => ({
              jenis_berat: prod.jenis_berat ?? null,
              quantity: prod.quantity ?? null,
              file_name:
                Array.isArray(prod.file) && prod.file.length > 0
                  ? prod.file[0].name
                  : null,
            }))
            : [],

          input_sampling: Array.isArray(item.input_sampling)
            ? item.input_sampling.map((row) => ({
              jenis_berat: row.jenis_berat ?? null,
              quantity_sampling: row.quantity_sampling ?? null,
              quantity_pcs: row.quantity_pcs ?? null,
              quantity_satuan: row.quantity_satuan ?? null,
              file_name:
                Array.isArray(row.file) && row.file.length > 0
                  ? row.file[0].name
                  : null,
            }))
            : [],
        };

        const selisih = item.quantity_pcs_wasit - item.total_quantity_system;

        /* ==========================
           CAMUNDA PAYLOAD
        ========================== */
        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {
              Adjusment_Quantity_Stock_Opname_Json: {
                value: JSON.stringify([hasilparse]),
                type: "Object",
                valueInfo: {
                  objectTypeName: "java.util.ArrayList",
                  serializationDataFormat: "application/json",
                },
              },
              adjustment: {
                value: item.result_action === "Adjustment SO",
                type: "Boolean",
              },
              selisih: {
                value: selisih,
                type: "Integer",
              },
              notes: {
                value: item.notes ?? "",
                type: "String",
              },
              quantity_system: {
                value: item.total_quantity_system ?? 0,
                type: "Integer",
              },
              data_stock: {
                value: JSON.stringify(
                  item.dataStock?.map(({ pk, quantity }) => ({
                    pk,
                    quantity,
                  })) ?? []
                ),
                type: "String",
              },
            },
          },
        };

        const responseCamunda = await camundaConfig(
          dataCamunda,
          instanceId,
          process
        );

        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          /* ==========================
             GRAPHQL LOG
          ========================== */
          const dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
mutation InsertStockOpnameLogs(
  $proc_inst_id: String!
  $quantity_input: numeric!
  $task_def_key: String!
  $status: String!
  $user: String!
  $created_at: timestamp!
  $quantity_data: numeric!
) {
  insert_stock_opname_logs(objects: {
    proc_inst_id: $proc_inst_id
    quantity_input: $quantity_input
    task_def_key: $task_def_key
    created_at: $created_at
    user: $user
    quantity_data: $quantity_data
  }) {
    affected_rows
  }
  update_stock_opname(
    where: { proc_inst_id: { _eq: $proc_inst_id } }
    _set: { status: $status }
  ) {
    affected_rows
  }
}
              `,
              variables: {
                proc_inst_id: item.proc_inst_id,
                user: item.user,
                quantity_input: item.quantity_pcs_wasit ?? 0,
                task_def_key: "Mirorim_Stock.Stock_Opname.Adjustment_Quantity",
                status:
                  item.result_action === "Adjustment SO"
                    ? "Finish"
                    : "Recount Worker",
                created_at: new Date(
                  Date.now() + 7 * 60 * 60 * 1000
                ).toISOString(),
                quantity_data: item.total_quantity_system ?? 0,
              },
            },
            query: [],
          };

          const responseQuery = await configureQuery(fastify, dataQuery);

          if (item.result_action === "Worker Input Ulang") {
            const upsertParameter = async (part_pk, template, value) => {
              const exist = await inventree.get(
                `/part/parameter/?part=${part_pk}&template=${template}`
              );

              if (exist.data?.results?.length > 0) {
                const paramId = exist.data.results[0].pk;
                await inventree.patch(`/part/parameter/${paramId}/`, {
                  data: value,
                });
              } else {
                await inventree.post("/part/parameter/", {
                  part: part_pk,
                  template,
                  data: value,
                });
              }
            };

            await upsertParameter(item.part_id, 15, item.berat_kotor);
            await upsertParameter(item.part_id, 16, item.berat_bersih);
          }

          results.push({
            message: "Create event processed successfully",
            camunda: responseCamunda.data,
            database: responseQuery.data,
          });
        }
      } catch (error) {
        console.error("Error processing item:", error);
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
