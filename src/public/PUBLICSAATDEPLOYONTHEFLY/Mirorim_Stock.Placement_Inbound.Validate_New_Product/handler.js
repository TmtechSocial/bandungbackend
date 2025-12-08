const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const GRAPHQL_API = process.env.GRAPHQL_API;
const SERVER_INVENTREE = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;
const axios = require("axios");

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];

    for (const item of data) {
      try {
        const instanceId = item.proc_inst_id || null;

        const inventree = axios.create({
          baseURL: `${SERVER_INVENTREE}/api`,
          headers: {
            Authorization: `Token ${INVENTREE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          timeout: 10000,
        });

        const PatchPayload = {
          name: item.product_name,
        };

        const { data: nameData } = await inventree.patch(
          `/part/${item.part_pk}/`,
          PatchPayload
        );

        // const dataCamunda = {
        //   type: "complete",
        //   endpoint: `/engine-rest/task/{taskId}/complete`,
        //   instance: item.proc_inst_id,
        //   variables: {
        //     variables: {},
        //   },
        // };

        // const responseCamunda = await camundaConfig(
        //   dataCamunda,
        //   instanceId,
        //   process
        // );
        // if (responseCamunda.status === 200 || responseCamunda.status === 204) {
        if (item) {
          const dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
                  mutation MyMutation($proc_inst_id: String!, $retail: Boolean, $part_name: String!) {
  update_mi_products(where: {proc_inst_id: {_eq: $proc_inst_id}}, _set: {retail: $retail, part_name: $part_name}) {
    affected_rows
  }
}
                `,
              variables: {
                proc_inst_id: item.proc_inst_id,
                retail: item.retail,
                part_name: item.product_name,
              },
            },
            query: [],
          };

          console.log("dataQuery", dataQuery);

          const responseQuery = await configureQuery(fastify, dataQuery);

          console.log("responseQuery", responseQuery);

          results.push({
            message: "Create event processed successfully",
            // camunda: responseCamunda.data,
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
