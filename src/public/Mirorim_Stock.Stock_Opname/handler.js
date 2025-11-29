const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const axios = require("axios");

const GRAPHQL_API = process.env.GRAPHQL_API;
const SERVER_INVENTREE = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;

const eventHandlers = {
  async onSubmit(data) {
    const results = [];
    for (const item of data) {
      try {

        const inventree = axios.create({
  baseURL: `${SERVER_INVENTREE}/api`,
  headers: {
    Authorization: `Token ${INVENTREE_API_TOKEN}`,
    "Content-Type": "application/json",
  },
  timeout: 10000,
});

        let taskId;
        let instanceId;

        let description = "";
        const items_stock = await inventree.get(
          `/stock/location/${item.location_id}/`
        );
        const items_location = items_stock?.data;
        description = items_location.description.toLowerCase();

         let part_name = "UnknownPart";
        try {
          const partResponse = await inventree.get(`/part/${item.part_id}/`);
          part_name = partResponse.data?.full_name || "UnknownPart";
        } catch {
          console.warn(`⚠️ Gagal ambil part_name untuk part_id ${part_id}`);
        }
        console.log("description", description);
        console.log("part_name", part_name);

        const dataCamunda = {
          type: "start",
          endpoint: `/engine-rest/process-definition/key/Mirorim_Stock.Stock_Opname/start`,
          variables: {
            variables: {
              type: { value: "Stock Opname Manual", type: "string" },
              location_id: { value: item.location_id, type: "Integer" },
              ownership: { value: description, type: "string" },
            },
            businessKey: `${part_name}:Stock Opname Manual:${item.created_at}`,
          },
        };

        const responseCamunda = await camundaConfig(dataCamunda, instanceId);
        console.log("responseCamunda", responseCamunda);
        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          const instanceId = responseCamunda.data.processInstanceId;
          const dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: ``,
              variables: {},
            },
            query: [],
          };
          const responseQuery = await configureQuery(fastify, dataQuery);
          console.log("responseQuery", responseQuery);
          results.push({
            message: "Create event processed successfully",
            camunda: responseCamunda.data,
            database: responseQuery.data,
          });
        }
      } catch (error) {
        console.error(`Error executing handler for event: ${eventKey}`, error);
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
  const { eventKey, data } = eventData;
  console.log("eventData", JSON.stringify(eventData));

  if (!eventHandlers[eventKey]) {
    throw new Error(`No handler found for event: ${eventKey}`);
  }

  // Panggil handler yang sesuai berdasarkan event
  try {
    return await eventHandlers[eventKey](data);
  } catch (error) {
    console.error(`Error executing handler for event: ${eventKey}`, error);
    throw error;
  }
};

module.exports = { handle };
