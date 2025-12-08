const { default: axios } = require("axios");
const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")(); // pastikan kamu panggil instance jika mau dipakai
const GRAPHQL_API = process.env.GRAPHQL_API;
const SERVER_INVENTREE = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];
    const eventKey = "onSubmit"; // untuk logging error

    for (const item of data) {
      try {
        let taskId;
        let instanceId = item.proc_inst_id || null;

        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {},
          },
        };

        const responseCamunda = await camundaConfig(
          dataCamunda,
          instanceId,
          process
        );
        console.log("responseCamunda", responseCamunda);

        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
        
          const reference = item.reference;
          const inventree = axios.create({
            baseURL: `${SERVER_INVENTREE}/api`,
            headers: {
              Authorization: `Token ${INVENTREE_API_TOKEN}`,
              "Content-Type": "application/json",
            },
            timeout: 10000,
          });

          // 🔄 Cancel Build di Inventree
          const { data: buildData } = await inventree.get(
            `/build/?reference=${encodeURIComponent(reference)}`
          );
          console.log("buildData", buildData);

          const buildId = buildData?.results?.[0]?.pk;
          if (!buildId)
            throw new Error("❌ Build Order tidak ditemukan di InvenTree");

          await inventree.post(`/build/${buildId}/cancel/`);
          console.log(
            `✅ Build Order dengan ID ${buildId} berhasil di-cancel di InvenTree`
          );

          // 🔄 Update status di database
          const dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
                mutation UpdateStatus($proc_inst_id: String!, $status: String!) {
                  update_manufacture_request(
                    where: { proc_inst_id: { _eq: $proc_inst_id } }
                    _set: { status: $status }
                  ) {
                    affected_rows
                  }
                }
              `,
              variables: {
                proc_inst_id: item.proc_inst_id,
                status: "Cancel Build Order",
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
        console.log(`graphql error: ${error?.dataQuery || "-"}`);
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
