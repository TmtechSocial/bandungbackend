const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")();
const dotenv = require("dotenv");
const SERVER_INVENTREE = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;
const axios = require("axios");

dotenv.config();
const GRAPHQL_API = process.env.GRAPHQL_API;

const eventHandlers = {
  async onSubmit(data, eventKey) {
    const results = [];

    for (const item of data) {
      try {
        const instanceId = item.proc_inst_id || null;

        // 🔄 Start Camunda process
        const dataCamunda = {
          type: "start",
          endpoint: `/engine-rest/process-definition/key/Mirorim_Warehouse.Trigger_Generic_Staging/start`,
          variables: {
            variables: {
              part_id: { value: item.part_id, type: "Integer" },
              unique_trx: { value: item.unique_trx, type: "String" },
              evidence_delivery_staging: { value: item.evidence[0] || "", type: "String" },
            },
            businessKey: `${item.part_id}:${item.unique_trx}:${item.created_at}`,
          },
        };

        const responseCamunda = await camundaConfig(dataCamunda, instanceId);
        console.log("✅ Camunda response", responseCamunda?.data || responseCamunda);

        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          const dataQuery = [];

          // --- Loop products ---
          for (const product of item.products) {

              // 🔄 GraphQL mutate untuk update_mi_placement
              dataQuery.push({
                graph: {
                  method: "mutate",
                  endpoint: GRAPHQL_API,
                  gqlQuery: `mutation MyMutation($id: String!, $status: String!) {
  update_delivery_staging(where: {proc_inst_id: {_eq: $id}}, _set: {status: $status}) {
    affected_rows
  }
}`,
                  variables: {
                    id: product.proc_inst_id,
                    status: "processed"
                  },
                },
                query: [],
              });
            }

          console.log("dataQuery", JSON.stringify(dataQuery, null, 2));

          // Jalankan semua query secara paralel
          const responseQuery = await Promise.all(
            dataQuery.map((query) => configureQuery(fastify, query))
          );

          console.log("responseQuery", JSON.stringify(responseQuery, null, 2));

          results.push({
            message: "✅ Create event processed successfully",
            camunda: responseCamunda.data,
            database: responseQuery,
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

/**
 * ⛓️ Handler utama
 */
const handle = async (eventData) => {
  const { eventKey, data } = eventData;
  console.log("📥 Received eventData", eventData);

  if (!eventHandlers[eventKey]) {
    throw new Error(`❌ No handler found for event: ${eventKey}`);
  }

  try {
    return await eventHandlers[eventKey](data, eventKey);
  } catch (error) {
    console.error(`❌ Error executing handler for event: ${eventKey}`, error);
    throw error;
  }
};

module.exports = { handle };
