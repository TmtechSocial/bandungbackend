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
              adjustment: {
                value: item.adjustment,
                type: "Boolean",
              },
              quantity_count: {
                value: item.quantity_adjustment ?? 0,
                type: "Integer",
              },
              stock_item_id: {
                value: item.stock_item_id,
                type: "Integer",
              },
              notes: {
                value: item.notes ?? "",
                type: "String",
              },
              quantity_system: { value: item.total_quantity_system, type: "String" },
            },
          },
        };

        const responseCamunda = await camundaConfig(
          dataCamunda,
          instanceId,
          process
        );
        console.log("responseCamunda", responseCamunda);
        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          // const instanceId = responseCamunda.data.processInstanceId;
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
  $evidence: String!
  $quantity_data: numeric!
) {
  insert_stock_opname_logs(objects: {
    proc_inst_id: $proc_inst_id
    quantity_input: $quantity_input
    task_def_key: $task_def_key
    created_at: $created_at
    user: $user
    evidence: $evidence
    quantity_data: $quantity_data
  }) {
    affected_rows
  }
    update_stock_opname(where: {proc_inst_id: {_eq: $proc_inst_id}}, _set: {status: $status}) {
    affected_rows
  }
}             
              `,
              variables: {
                proc_inst_id: item.proc_inst_id,
                user: item.user,
                quantity_input: item.quantity_adjustment ?? 0,
                task_def_key: "Mirorim_Stock.Stock_Opname.Adjustment_Quantity",
                status: item.adjustment ? "Finish" : "Recount Worker",
                created_at: new Date(
                  new Date().getTime() + 7 * 60 * 60 * 1000
                ).toISOString(),
                evidence: item.evidence[0] || "",
                quantity_data: item.total_quantity_system || 0,
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
        console.error(`Error executing handler for event: ${eventKey}`, error);
        console.log(`graphql error: ${error.dataQuery}`);

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
