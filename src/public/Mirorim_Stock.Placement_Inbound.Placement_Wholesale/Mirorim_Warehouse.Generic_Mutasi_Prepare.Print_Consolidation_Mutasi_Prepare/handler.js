const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")();
const GRAPHQL_API = process.env.GRAPHQL_API;
const fetch = require("node-fetch");
const SERVER_INVENTREE = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;
const axios = require("axios");
const { unclaimTask } = require("../../utils/camunda/camundaClaim");

const inventree = axios.create({
  baseURL: `${SERVER_INVENTREE}/api`,
  headers: {
    Authorization: `Token ${INVENTREE_API_TOKEN}`,
    "Content-Type": "application/json",
  },
  timeout: 10000,
});

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];

    for (const item of data) {
      try {
        let instanceId = item.parent_inst_id || null;
          
        let description = null;
        try {
          const res = await inventree.get(`/stock/location/?name=${item.destination}`);
          description = res.data?.results?.[0]?.description || null;
        } catch (err) {
          console.warn("⚠️ Gagal ambil lokasi dari Inventree:", err.message);
        }

        console.log(description);
        
        let destinationTypeTable;
            if (description === "GUDANG") {
              destinationTypeTable = "Wholesale";
            } else if (description === "TOKO") {
              destinationTypeTable = "Retail";
            } else {
              destinationTypeTable = description || "Unknown";
            }

            let coordinator;
            if (description === "GUDANG") {
              coordinator = "InventoryWholesaleCoordinator";
            } else if (description === "TOKO") {
              coordinator = "InventoryRetailCoordinator";
            } else {
              coordinator = "InventoryRetailCoordinator" || "Unknown";
            }

        // Tentukan WIPLocation
        let WIPLocation;
        if (item.type === "Refill" || item.type === "Retail") {
          WIPLocation = description === "GUDANG" ? 1000002 : 1000003;
        } else {
          WIPLocation = 1000004;
        }

        
        console.log(destinationTypeTable);
        console.log(WIPLocation);
        

          // Kirim ke Camunda
          const dataCamunda = {
            type: "complete",
            endpoint: `/engine-rest/task/{taskId}/complete`,
            instance: item.proc_inst_id,
            variables: {
              variables: {
                  coordinator: { value: coordinator, type: "String" },
                  id: { value: item.id, type: "Integer" },
                  source_stock: { value: item.stock_item_wip, type: "Integer" },
                  unique_trx: { value: item.unique_trx, type: "String" },
                  business_key: { value: item.unique_trx, type: "String" },
                  table_reference: { value: "internal_consolidation_process", type: "String" },
                  WIPLocation: { value: WIPLocation, type: "Integer" },
                  destination_type: { value: destinationTypeTable, type: "String" },
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
                gqlQuery: ``,
                variables: {
                },
              },
              query: [],
            };

            const responseQuery = await configureQuery(fastify, dataQuery);

            results.push({
              message: "Complete event processed successfully",
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


