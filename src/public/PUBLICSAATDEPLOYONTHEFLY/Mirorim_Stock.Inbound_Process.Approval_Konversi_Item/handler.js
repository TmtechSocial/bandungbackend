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

        const partIds = item.products.map((p) => p.part_pk);
         console.log("partIds", partIds);

       const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {
              approved_purchase: { value: item.approved_purchase, type: "Boolean"},
              part_ids: {
        value: JSON.stringify(partIds), // ⬅️ stringify array
        type: "Object",
        valueInfo: {
          objectTypeName: "java.util.ArrayList",
          serializationDataFormat: "application/json",
        },
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

          const dataQuery = {
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
                  task: "Mirorim_Stock.Inbound_Process.Approval_Konversi_Item"
                },
            },
            query: [],
          };

          console.log("dataQuery", dataQuery);

          const responseQuery = await configureQuery(fastify, dataQuery);

          console.log("responseQuery", responseQuery);

          results.push({
            message: "Create event processed successfully",
            camunda: responseCamunda.data,
            database: responseQuery.data,
          });
        }
      } catch (error) {
        console.error(
          `❌ Error executing handler for event: ${eventKey}`,
          error
        );
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
