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
              "quality": { value: item.quality, type: "string" },
            },
          },
        };

        const responseCamunda = await camundaConfig(dataCamunda, instanceId, process);
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
                proc_inst_id: item.proc_inst_id,
                task_def_key: "Mirorim_Operasional.Retur.Physical_Check",
                notes: item.notes || "",
                created_at: item.created_at || new Date().toISOString(),
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


          const returReceiveQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
        mutation UpdateReturReceive(
          $proc_inst_id: String!, 
          $task: String!, 
          $notes: String, 
          $evidence: [mo_retur_evidence_insert_input!]!
        ) {
          update_mo_retur_receive(
            where: {proc_inst_id: {_eq: $proc_inst_id}}, 
            _set: {
              task_def_key: $task,
              technician_notes: $notes
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
                proc_inst_id: item.proc_inst_id,
                notes: item.notes || null,
                task:
                  item.quality === "ok"
                    ? "Mirorim_Operasional.Retur.Update_Status_MP"
                    : "Mirorim_Operasional.Retur.Follow_Up_MP",
                evidence: (item.evidence || []).map((file) => ({
                  proc_inst_id: item.proc_inst_id,
                  task_def_key: "Mirorim_Operasional.Retur.Physical_Check",
                  file_name: file,
                  logs_id,
                })),
              },
            },
            query: [],
          };

          const checkedProducts = item.products.filter(
            (product) => product.check === true
          );

          const productQueries = checkedProducts.map((product) => ({
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
        mutation UpdateOrderProduct(
          $invoice: String!, 
          $sku_toko: String!, 
          $status: Boolean!
        ) {
          update_mo_order_shop(
            where: {
              invoice: {_eq: $invoice}, 
              sku_toko: {_eq: $sku_toko}
            },
            _set: {retur_physical_check: $status}
          ) {
            affected_rows
          }
        }
      `,
              variables: {
                invoice: item.invoice,
                sku_toko: product.sku_toko,
                status: true,
              },
            },
            query: [],
          }));
          
          const allQueries = [returReceiveQuery, ...productQueries];
          const responseQuery = await Promise.all(
            allQueries.map((query) => configureQuery(fastify, query))
          );
          console.log("dataQuery", allQueries);
          console.log("responseQuery", responseQuery);
          results.push({
            message: "Create event processed successfully",
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
