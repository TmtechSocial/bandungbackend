const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const GRAPHQL_API = process.env.GRAPHQL_API;

const eventHandlers = {
  async onSubmit(data, process, eventKey) {
    const results = [];

    for (const item of data) {
      try {
        const instanceId = item.parent_inst_id || null;

       const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.parent_inst_id,
          variables: {
            variables: {
               parent_inst_id: { value: item.parent_inst_id, type: "String" },
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
                `,
                variables: {
                }
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
