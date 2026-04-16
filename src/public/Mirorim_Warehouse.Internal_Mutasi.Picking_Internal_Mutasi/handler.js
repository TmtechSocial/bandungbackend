const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const {
  trackStock,
  transferStock,
  getDescStock,
  createStockTransferEqual
} = require("../../utils/inventree/inventreeActions");
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
        let stockGetDesc = [];
        
        if (!item.printUlang) {
          try {
            const destinationVar = await axios.get(
              `${CAMUNDA_API}engine-rest/process-instance/${item.proc_inst_id}/variables/destination_type`
            );
            destinationType = destinationVar?.data?.value || null;
          } catch (err) {
            console.warn("?? Tidak bisa ambil destination_type:", err.message);
          }
          console.log("destination_type:", destinationType);
          // ?? Tentukan WIPDestination
          let WIPDestination = null;
          if (destinationType === "Wholesale") {
            WIPDestination = 1000002;
          } else if (destinationType === "Retail") {
            WIPDestination = 1000003;
          } else if (destinationType === "Manufacture") {
            WIPDestination = 6399;
          } else if (destinationType === "WHOLESALED7") {
            WIPDestination = 1000007;
          } else if (destinationType === "Reject") {
            WIPDestination = 6224;
          }

          console.log("WIPDestination:", WIPDestination);
          let sourceId = [];
          let quantityInput = [];
            for (const product of item.products || []) {
                quantityInput.push(product.quantity_pick);
                const partPk = item.part_id;
                const locationPk = 6225;
                const stockPk = product.mrd_source_id;
                const quantity = product.quantity_pick;
                const sku = product.location_id;
                const notesTransfer = `Transfer stock WIP In Transit ${instanceId} | From SKU: ${sku}`;
                console.log("source_id:", stockPk);
                const stockTrack = await trackStock(stockPk, notesTransfer);
                if (stockTrack?.results?.length > 0) {
                  console.log("Stock sudah pernah di-track, tidak remove");
                  throw new Error(
                    `Task sudah pernah diproses sebelumnya`
                  );
                }
                if (product.quantity_pick == product.stock_quantity) {
                  const transferequal = await createStockTransferEqual(
                    partPk,
                    0,
                    stockPk
                  );
                  console.log("stockPk abis:", stockPk);
                  const stockTransfer = await transferStock(
                    stockPk,
                    quantity,
                    locationPk,
                    notesTransfer
                  );
                  stockGetDesc.push(stockPk)
                  sourceId.push(transferequal)
                } else {
                  console.log("stockPk tidak abis:", stockPk);
                  sourceId.push(product.mrd_source_id);
                  const stockTransfer = await transferStock(
                    stockPk,
                    quantity,
                    locationPk,
                    notesTransfer
                  );
                  stockGetDesc.push(await getDescStock(partPk, locationPk))
                }
                console.log("stockGetDesc:", stockGetDesc);
            }

          // ?? Kirim data ke Camunda
          dataCamunda = {
            type: "complete",
            endpoint: `/engine-rest/task/{taskId}/complete`,
            instance: item.proc_inst_id,
            variables: {
              variables: {
                product_name: {
                  value: item.product_name || null,
                  type: "String",
                },
                quantity: { value: quantityInput, type: "String" },
                part_id: { value: item.part_id || null, type: "Integer" },
                id: { value: item.id || null, type: "Integer" },
                source_stock: { value: stockGetDesc, type: "String" },
                primary_stock: { value: sourceId, type: "String" },
                quantity_staging: {
                  value: item.quantity_staging || 0,
                  type: "Integer",
                },
                quantity_picking: {
                  value: item.quantity_staging || 0,
                  type: "Integer",
                },
                WIPLocation: { value: WIPDestination, type: "Integer" },
                table_reference: { value: "mutasi_request", type: "String" },
                printUlang: {
                  value: item.printUlang || false,
                  type: "Boolean",
                },
              },
            },
          };
        } else {
          console.log("??? Mode print ulang aktif, update camunda .");
          dataCamunda = {
            type: "complete",
            endpoint: `/engine-rest/task/{taskId}/complete`,
            instance: item.proc_inst_id,
            variables: {
              variables: {
                printUlang: {
                  value: item.printUlang || false,
                  type: "Boolean",
                },
              },
            },
          };
        }

        const responseCamunda = await camundaConfig(
          dataCamunda,
          instanceId,
          process
        );
        console.log("responseCamunda", responseCamunda.status);
        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          let i = 0;
          for (const product of item.products || []) {
            let dataQuery = null;

            if (item.printUlang) {
              // Jika print ulang ? tidak perlu update ke database
              console.log("??? Mode print ulang aktif, skip update Hasura.");
              continue;
            } else {
              // ?? Mutation untuk update data mutasi_request dan details
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
                      $quantity_staging:Int!
                      $quantity_pick: Int!
                      $quantity_fisik: Int!
                      $quantity_data: Int!
                      $proc_inst_id: String!
                      $evidence_picking: String!
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
                        _set: { quantity: $quantity_staging, 
                          evidence_picking: $evidence_picking }
                      ) {
                        affected_rows
                      }
                    }
                  `,
                  variables: {
                    proc_inst_id: item.proc_inst_id,
                    request_id: product.id,
                    source_id: product.mrd_source_id,
                    stock_id: String(stockGetDesc[i] || ""),
                    user: item.updated_by,
                    date: item.updated_at,
                    quantity_pick: product.quantity_pick || 0,
                    quantity_fisik: product.quantity_fisik || 0,
                    quantity_data: product.quantity_fisik || 0,
                    evidence_picking: item.evidence[0] || "",
                    quantity_staging: item.quantity_staging || 0,
                  },
                },
                query: [],
              };

              const responseQuery = await configureQuery(null, dataQuery);
              console.log(
                `? Updated mutasi_request_details for request_id ${product.id} and source_id ${product.source_id}`
              );
              console.log('duh: ', dataQuery);
              
              console.log(responseQuery);
            }
            i++;
          }

          results.push({
            message: "Event processed successfully",
            camunda: responseCamunda.data || null,
          });
        }
      } catch (error) {
        console.error(
          `? Error executing handler for event: ${eventKey}`,
          error.message
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
