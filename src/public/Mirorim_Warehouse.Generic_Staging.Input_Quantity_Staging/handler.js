const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fetch = require("node-fetch");
const axios = require("axios");
const { unclaimTask } = require("../../utils/camunda/camundaClaim");
const GRAPHQL_API = process.env.GRAPHQL_API;
const CAMUNDA_API = process.env.CAMUNDA_API;

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];

    for (const item of data) {
      try {
        const instanceId = item.proc_inst_id;

        // âœ… Tentukan payload Camunda secara dinamis
        let camundaVariables = {
          quantity_input: {
            value: item.convert_quantity_input,
            type: "Integer",
          },
          evidence_delivery_staging: {
            value: item.evidence[0] || "",
            type: "String",
          },
          isValid: { value: item.tolerance_valid, type: "Boolean" },
          Input_Quantity_Staging_Json: {
            value: JSON.stringify([item]),
            type: "Object",
            valueInfo: {
              objectTypeName: "java.util.ArrayList",
              serializationDataFormat: "application/json",
            },
          },
        };

        if (item.tipe_wip === "PREPARE") {
          camundaVariables.WIPLocation = {
            value: item.location_prepare,
            type: "Integer",
          };
        }

        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: instanceId,
          variables: { variables: camundaVariables },
        };

        // ðŸ”¹ Kirim ke Camunda
        const responseCamunda = await camundaConfig(
          dataCamunda,
          instanceId,
          process
        );
        console.log(
          "? Camunda response",
          responseCamunda?.data || responseCamunda
        );

        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          // ðŸ”¹ Simpan log ke GraphQL
          const dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
                mutation InsertDeliveryStagingLog(
                  $created_at: timestamp!,
                  $created_by: String!,
                  $delivery_staging_id: Int!,
                  $quantity_input: float8!,
                  $task_def_key: String!
                ) {
                  insert_delivery_staging_logs(
                    objects: {
                      created_at: $created_at,
                      created_by: $created_by,
                      delivery_staging_id: $delivery_staging_id,
                      quantity_input: $quantity_input,
                      task_def_key: $task_def_key
                    }
                  ) {
                    affected_rows
                  }
                }
              `,
              variables: {
                created_at: item.created_at,
                created_by: item.created_by,
                delivery_staging_id: item.id,
                quantity_input: item.convert_quantity_input || 0,
                task_def_key:
                  "Mirorim_Warehouse.Generic_Staging.Input_Quantity_Staging",
              },
            },
            query: [],
          };

          const responseQuery = await configureQuery(null, dataQuery);
          console.log("responseQuery", JSON.stringify(responseQuery, null, 2));

          results.push({
            message: "âœ… Complete event processed successfully",
            camunda_status: responseCamunda.status,
            camunda_data: responseCamunda.data,
            graphql_data: responseQuery.data,
          });
        } else {
          results.push({
            message: "âš ï¸ Camunda did not return success status",
            status: responseCamunda.status,
          });
        }
      } catch (error) {
        console.error("âŒ Error executing handler:", error.message);
        results.push({
          message: "Error processing item",
          error: error.message,
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

// ðŸ”¹ Fungsi utama
const handle = async (eventData) => {
  const { eventKey, data, process } = eventData;

  if (!eventHandlers[eventKey]) {
    throw new Error(`No handler found for event: ${eventKey}`);
  }

  try {
    return await eventHandlers[eventKey](data, process);
  } catch (error) {
    console.error(`âŒ Error executing handler for event: ${eventKey}`, error);
    throw error;
  }
};

module.exports = { handle };
