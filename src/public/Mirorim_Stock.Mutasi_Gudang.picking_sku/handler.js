const { Source } = require("graphql");
const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const axios = require("axios");
const GRAPHQL_API = process.env.GRAPHQL_API;
const SERVER_INVENTREE = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;

const eventHandlers = {
  async onSubmit(data, process, eventKey) {
    const results = [];
    for (const item of data) {
      try {
        let instanceId = item.parent_inst_id || null;

        let newLocationIds = [];
        try {
          for (const locId of item.location_ids) {
            const res = await axios.get(
              `${SERVER_INVENTREE}/api/stock/${locId}/`,
              {
                headers: {
                  Authorization: `Token ${INVENTREE_API_TOKEN}`,
                  "Content-Type": "application/json",
                },
              }
            );

            // Ambil field location dari response
            if (res.data && res.data.location) {
              newLocationIds.push(res.data.location);
            } else {
              console.warn(
                `⚠️ Tidak ada field 'location' untuk stock_id ${locId}`
              );
            }
          }
        } catch (err) {
          console.error("❌ Gagal fetch location_ids:", err.message);
          // fallback ke lokasi lama
          newLocationIds = item.location_ids;
        }

        console.log("📦 Location lama:", item.location_ids);
        console.log("📦 Location baru:", newLocationIds);

        const source = (item.products || []).map((product) => ({
          source_id: product.sku_id,
          quantity: product.quantity,
          quantity_sisa: product.quantity_sisa || 0,
          quantity_pick: product.quantity_pick || 0,
        }));
        console.log("📥 Data source:", source);

        // Mengirim data ke Camunda untuk menyelesaikan task
        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {
              quantity_total: { value: item.quantity || null, type: "Integer" },
              product_name: {
                value: item.product_name || null,
                type: "String",
              },
              part_id: { value: item.part_id || null, type: "Integer" },
              type: { value: "Mutasi", type: "String" },
              date: { value: item.updated_at || null, type: "String" },
              ownership: { value: "gudang", type: "String" },
              quantity_selisih: {
                value: item.quantity_selisih || null,
                type: "boolean",
              },
              location_ids: {
                value: JSON.stringify(newLocationIds || []),
                type: "Object",
                valueInfo: {
                  serializationDataFormat: "application/json",
                  objectTypeName: "java.util.ArrayList",
                },
              },
              Source: {
                value: JSON.stringify(source), // stringify jadi JSON string
                type: "String",
              },
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
          // Update untuk setiap produk (detail) secara individual
          for (const product of item.products) {
            const dataQuery = {
              graph: {
                method: "mutate",
                endpoint: GRAPHQL_API,
                gqlQuery: `
                  mutation UpdateMutasi(
                    $request_id: Int!
                    $sku_id: String!
                    $user: String!
                    $date: timestamp!
                    $quantity_pick: Int!
                    $quantity_fisik: Int!
                    $quantity_data: Int!
                    $proc_inst_id: String!
                    $status: String!
                  ) {
                    updateDetails: update_mutasi_request_details(
                      where: { 
                        request_id: { _eq: $request_id }, 
                        sku_id: { _eq: $sku_id },
                        type: { _eq: "source" }
                      },
                      _set: { 
                        updated_by: $user, 
                        updated_at: $date, 
                        quantity_movement: $quantity_pick, 
                        quantity_physical: $quantity_fisik, 
                        quantity_data: $quantity_data 
                      }
                    ) {
                      affected_rows
                    }
                    updateRequest: update_mutasi_request(
                      where: { proc_inst_id: { _eq: $proc_inst_id } },
                      _set: { status: $status }
                    ) {
                      affected_rows
                    }
                  }
                `,
                variables: {
                  proc_inst_id: item.proc_inst_id,
                  status:
                    item.quantity_selisih == true ? "stock habis" : "processed",
                  request_id: product.request_id, // ambil dari product
                  sku_id: product.sku_id,
                  quantity_pick: product.quantity_pick || 0,
                  user: item.updated_by,
                  date: item.updated_at,
                  quantity_fisik: product.quantity_fisik || 0,
                  quantity_data: product.quantity_data || 0,
                },
              },
              query: [],
            };

            const responseQuery = await configureQuery(fastify, dataQuery);
            console.log(
              `Updated mutasi_request_details for request_id ${product.request_id} and sku_id ${product.sku_id}`
            );
          }

          results.push({
            message: "Create event processed successfully",
            // camunda: responseCamunda.data,
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
    return { message: "onChange executed", data };
  },
};

const handle = async (eventData) => {
  const { eventKey, data, process } = eventData;
  console.log("eventData", eventData);

  if (!eventHandlers[eventKey]) {
    throw new Error(`No handler found for event: ${eventKey}`);
  }

  try {
    return await eventHandlers[eventKey](data, process, eventKey);
  } catch (error) {
    console.error(`Error executing handler for event: ${eventKey}`, error);
    throw error;
  }
};

module.exports = { handle };
