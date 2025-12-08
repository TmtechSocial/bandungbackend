const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const GRAPHQL_API = process.env.GRAPHQL_API;
const CAMUNDA_API = process.env.CAMUNDA_API;
const axios = require("axios");

const eventHandlers = {
  async onSubmit(data, process, eventKey) {
    const results = [];

    for (const item of data) {
      try {
        const instanceId = item.proc_inst_id || null;
        let dataCamunda;
        let dataQuery;

        console.log("item", item.approved_purchase);
        if (!item.approved_purchase) {
          dataCamunda = {
            type: "complete",
            endpoint: `/engine-rest/task/{taskId}/complete`,
            instance: instanceId,
            variables: {
              variables: {
                approved_purchase: {
                  value: item.approved_purchase,
                  type: "Boolean",
                },
              },
            },
          };

          const responseCamunda = await camundaConfig(dataCamunda, instanceId, process);

          if ([200, 204].includes(responseCamunda.status)) {
            dataQuery = {
              graph: {
                method: "mutate",
                endpoint: GRAPHQL_API,
                gqlQuery: `
                  mutation MyMutation(
                    $invoice: String!, 
                    $notes: String, 
                    $created_by: String!, 
                    $task: String!, 
                    $created_at: timestamp!
                  ) {
                    insert_mi_logs(
                      objects: {
                        invoice: $invoice, 
                        notes: $notes, 
                        task_def_key: $task, 
                        created_by: $created_by, 
                        created_at: $created_at
                      }
                    ) {
                      affected_rows
                    }
                  }
                `,
                variables: {
                  created_at: item.created_at,
                  created_by: item.created_by,
                  invoice: item.invoice,
                  notes: item.notes || null,
                  task: "Mirorim_Stock.Placement_Inbound.Approval_Counting",
                },
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

          continue;
        }

        // ============================
        // CASE 2: approved_purchase = true
        // ============================ 
        const weight_per_unit = item.weight_per_unit || null;
        const pack_gudang = parseInt(item.pack_gudang || null);
        const pack_supplier = parseInt(item.pack_supplier || null);
        const mergeDecision = item.merged_stock?.[0]?.apakahDisatukan || null;

        const konversi = item.konversiQuantity?.[0] || null;
        const unit = konversi
          ? konversi.adaKonversi
            ? konversi.konversiSesudah
            : konversi.unit
          : null;

        const totalQuantity =
          item.quantityHasilKonversi + item.quantityHasilKonversiReject;

        console.log(weight_per_unit, pack_gudang, pack_supplier, mergeDecision, unit, totalQuantity);

        dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: instanceId,
          variables: {
            variables: {
              approved_purchase: {
                  value: item.approved_purchase,
                  type: "Boolean",
                },
              weight_per_unit: {
                value: JSON.stringify(weight_per_unit),
                type: "Object",
                valueInfo: {
                  objectTypeName: "java.util.ArrayList",
                  serializationDataFormat: "application/json",
                },
              },
              pack_gudang: { value: pack_gudang, type: "Integer" },
              pack_supplier: { value: pack_supplier, type: "Integer" },
              merge_decision_inbound: { value: mergeDecision, type: "String" },
              unit_konversi: { value: unit, type: "String" },
              quantity_ok: { value: item.quantityHasilKonversi, type: "Integer" },
              quantity_not_ok: { value: item.quantityHasilKonversiReject, type: "Integer" },
              total_quantity_qc: { value: totalQuantity, type: "Integer" },
              create_new_part: { value: item.create_new_part, type: "Boolean" }
            },
          },
        };

        const responseCamunda = await camundaConfig(dataCamunda, instanceId, process);

        if ([200, 204].includes(responseCamunda.status)) {
          dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
                mutation MyMutation($proc_inst_id: String!, $unit: String!, $quantity_konversi: Int!, $quantity_ok: Int!, $quantity_not_ok: Int!) {
  update_mi_products(where: {proc_inst_id: {_eq: $proc_inst_id}}, _set: {unit_konversi: $unit, quantity_konversi: $quantity_konversi, quantity_ok: $quantity_ok, quantity_not_ok: $quantity_not_ok}) {
    affected_rows
  }
}
              `,
              variables: {
                proc_inst_id: instanceId,
                unit,
                quantity_konversi: totalQuantity,
                quantity_ok: item.quantityHasilKonversi,
                quantity_not_ok: item.quantityHasilKonversiReject,
              },
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
        console.error(`❌ Error executing handler for event: ${eventKey}`, error);
      }
    }

    return results;
  },

  async onChange(data) {
    console.log("⚙️ Handling onChange with data:", data);
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
