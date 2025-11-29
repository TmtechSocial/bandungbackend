const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const { transferStock, getDescStock } = require("../../utils/inventree/inventreeActions");
const axios = require("axios");

const GRAPHQL_API = process.env.GRAPHQL_API;
const CAMUNDA_API = process.env.CAMUNDA_API;

const eventHandlers = {
  async onSubmit(data, process, eventKey) {
    const results = [];

    for (const item of data) {
      try {
        const instanceId = item.proc_inst_id || null;

        let destinationType = null;
        let dataCamunda = null;
        let stockGetDesc = null;

        if (!item.printUlang) {
        try {
          const destinationVar = await axios.get(
            `${CAMUNDA_API}engine-rest/process-instance/${item.proc_inst_id}/variables/destination_type`
          );
          destinationType = destinationVar?.data?.value || null;
        } catch (err) {
          console.warn("⚠️ Tidak bisa ambil destination_type:", err.message);
        }

        console.log("destination_type:", destinationType);

        // 🔹 Tentukan WIPDestination
        let WIPDestination = null;
        if (destinationType === "Wholesale") {
          WIPDestination = 1000002;
        } else if (destinationType === "Retail") {
          WIPDestination = 1000003;
        }

        console.log("WIPDestination:", WIPDestination);

          const partPk = item.part_id;
          const locationPk = 6225;
          const stockPk = item.source_id;
          const quantity = item.quantity_staging;

          const notesTransfer = `Transfer stock WIP In Transit ${instanceId}`;

          console.log("source_id:", stockPk);

          const stockTransfer = await transferStock(stockPk, quantity, locationPk, notesTransfer);
          stockGetDesc = await getDescStock(partPk, locationPk);

          console.log("stockGetDesc:", stockGetDesc);

        // 🔹 Kirim data ke Camunda
        dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {
              product_name: { value: item.product_name || null, type: "String" },
              part_id: { value: item.part_id || null, type: "Integer" },
              id: { value: item.id || null, type: "Integer" },
              source_stock: { value: stockGetDesc, type: "Integer" },
              primary_stock: { value: item.source_id, type: "Integer" },
              quantity_staging: { value: item.quantity_staging || 0, type: "Integer" },
              WIPLocation: { value: WIPDestination, type: "Integer" },
              table_reference: { value: "mutasi_request", type: "String" },
              printUlang: { value: item.printUlang || false, type: "Boolean" },
            },
          },
        };
      } else{
        console.log("🖨️ Mode print ulang aktif, update camunda .");
        dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {
              printUlang: { value: item.printUlang || false, type: "Boolean" },
            },
          },
        };
      }

        const responseCamunda = await camundaConfig(dataCamunda, instanceId, process);
        console.log("responseCamunda", responseCamunda.status);

        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          for (const product of item.products || []) {
            let dataQuery = null;

            if (item.printUlang) {
              // Jika print ulang → tidak perlu update ke database
              console.log("🖨️ Mode print ulang aktif, skip update Hasura.");
              continue;
            } else {
              // 🔹 Mutation untuk update data mutasi_request dan details
              dataQuery = {
                graph: {
                  method: "mutate",
                  endpoint: GRAPHQL_API,
                  gqlQuery: `
                    mutation UpdateMutasi(
                      $request_id: Int!
                      $source_id: String!
                      $stock_id: String!
                      $user: String!
                      $date: timestamp!
                      $quantity_pick: Int!
                      $quantity_fisik: Int!
                      $quantity_data: Int!
                      $proc_inst_id: String!
                    ) {
                      updateDetails: update_mutasi_request_details(
                        where: { 
                          request_id: { _eq: $request_id }, 
                          source_id: { _eq: $source_id },
                          type: { _eq: "source" }
                        },
                        _set: { 
                          updated_by: $user, 
                          updated_at: $date, 
                          quantity: $quantity_pick, 
                          quantity_physical: $quantity_fisik, 
                          quantity_data: $quantity_data,
                          source_id: $stock_id
                        }
                      ) {
                        affected_rows
                      }
                      updateRequest: update_mutasi_request(
                        where: { proc_inst_id: { _eq: $proc_inst_id } },
                        _set: { quantity: $quantity_pick }
                      ) {
                        affected_rows
                      }
                    }
                  `,
                  variables: {
                    proc_inst_id: item.proc_inst_id,
                    request_id: product.request_id,
                    source_id: product.source_id,
                    stock_id: String(stockGetDesc),
                    user: item.updated_by,
                    date: item.updated_at,
                    quantity_pick: product.quantity_pick || 0,
                    quantity_fisik: product.quantity_fisik || 0,
                    quantity_data: item.quantity_data || 0,
                  },
                },
                query: [],
              };

              const responseQuery = await configureQuery(null, dataQuery);
              console.log(
                `✅ Updated mutasi_request_details for request_id ${product.request_id} and source_id ${product.source_id}`
              );
              console.log(responseQuery.data);
            }
          }

          results.push({
            message: "Event processed successfully",
            camunda: responseCamunda.data || null,
          });
        }
      } catch (error) {
        console.error(`❌ Error executing handler for event: ${eventKey}`, error.message);
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
