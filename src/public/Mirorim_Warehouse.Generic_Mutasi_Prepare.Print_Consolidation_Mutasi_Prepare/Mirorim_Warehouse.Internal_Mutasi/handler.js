const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const axios = require("axios");
const { sendNotificationToUserGroup } = require("../../utils/firebase/groupNotificationSender");

const GRAPHQL_API = process.env.GRAPHQL_API;
const SERVER_INVENTREE = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;

// 🔹 Helper untuk format tanggal YY-MM-DD
function formatDateYYYYMMDD(dateInput) {
  const date = new Date(dateInput);
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// 🔹 Helper untuk generate unique_id + cek database
async function generateUniqueId(fastify, locationName, createdAt) {
  const createdDate = formatDateYYYYMMDD(createdAt || new Date());
  const baseUnique = `IM|${createdDate}|${locationName}`;
  let index = 0;
  let uniqueId = `${baseUnique}|`;

  const checkQuery = {
    graph: {
      method: "query",
      endpoint: GRAPHQL_API,
      gqlQuery: `
        query CheckUnique($unique_trx: String!) {
          mutasi_request(where: {unique_trx: {_eq: $unique_trx}}) {
            unique_trx
          }
        }
      `,
      variables: { unique_trx: uniqueId },
    },
    query: [],
  };

  while (true) {
    const checkResult = await configureQuery(fastify, checkQuery);
    const existing = checkResult?.data?.[0]?.graph?.mutasi_request?.length || 0;
    if (existing === 0) break;

    index++;
    uniqueId = `${baseUnique}|${index}`;
    checkQuery.graph.variables.unique_trx = uniqueId;
  }

  return uniqueId;
}

const eventHandlers = {
  async onSubmit(data) {
    const results = [];

    for (const item of data) {
      try {
        console.log("Isi:", item);
        const { part_id, products } = item;
        const user = item.user || "Unknown";

        const inventree = axios.create({
          baseURL: `${SERVER_INVENTREE}/api`,
          headers: {
            Authorization: `Token ${INVENTREE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          timeout: 10000,
        });

        // 🔹 Ambil nama part
        let part_name = "UnknownPart";
        try {
          const partResponse = await inventree.get(`/part/${part_id}/`);
          part_name = partResponse.data?.full_name || "UnknownPart";
        } catch {
          console.warn(`⚠️ Gagal ambil part_name untuk part_id ${part_id}`);
        }

        // 🔹 Loop setiap row (product)
        for (const product of products) {
          try {
            const skuId = product.source_sku;
            const destinationSkuOriginal = product.destination_sku;

            // ===== Ambil lokasi & stok source =====
            let stockQty = 0;
            try {
              const stockResponse = await inventree.get(`/stock/${skuId}/`);
              product.source_location_name =
                stockResponse.data?.location_name || null;
              stockQty = stockResponse.data?.quantity || 0;
            } catch {
              product.source_location_name = null;
              stockQty = 0;
            }

            // Fallback lokasi source
            if (!product.source_location_name) {
              if (product.sku_available && String(product.sku_available).trim() !== "") {
                product.source_location_name = String(product.sku_available).trim();
                console.warn(
                  `⚠️ Fallback lokasi SOURCE dari sku_available → ${product.source_location_name}`
                );
              } else {
                product.source_location_name = "WH001";
                console.warn(`⚠️ Fallback lokasi SOURCE default → WH001`);
              }
            }

            console.log(
              `📦 SKU ${skuId} | Location: ${product.source_location_name} | Stock: ${stockQty} | Requested: ${product.quantity}`
            );

            if (stockQty < product.quantity) {
              throw new Error(
                `Stock tidak cukup untuk SKU ${skuId}. Dibutuhkan ${product.quantity}, tersedia ${stockQty}`
              );
            }

            // Ambil detail lokasi source
            try {
              const locationResponse = await inventree.get(
                `/stock/location/?name=${product.source_location_name}`
              );
              const firstResult = locationResponse.data?.results?.[0];
              product.source_location_description = firstResult?.description || null;
              product.source_location_id = firstResult?.pk || null;
            } catch {
              product.source_location_name = null;
            }

            const locationSourceDescription = product.source_location_description;

            let sourceTypeTable;
            if (locationSourceDescription === "GUDANG" || product.source_location_name.includes("RE") || locationSourceDescription === "REJECT") {
              sourceTypeTable = "Wholesale";
            } else if (locationSourceDescription === "TOKO") {
              sourceTypeTable = "Retail";
            } else {
              sourceTypeTable = locationSourceDescription || "Unknown";
            }

            // ===== Ambil lokasi destination =====
            let destinationSku = destinationSkuOriginal;
            try {
              const stockDestination = await inventree.get(`/stock/${destinationSku}/`);
              product.destination_location_name =
                stockDestination.data?.location_name || null;
            } catch {
              product.destination_location_name = null;
            }

            // Fallback destination
            if (!product.destination_location_name) {
              console.log("testtttt");
              
              if (product.sku_available && String(product.sku_available).trim() !== "") {
                product.destination_location_name = String(product.sku_available).trim().toUpperCase();
                console.log(
                  `⚠️ Fallback lokasi DESTINATION dari sku_available → ${product.destination_location_name}`
                );
              } else {
                product.destination_location_name = "WH001";
                console.log(`⚠️ Fallback lokasi DESTINATION default → WH001`);
              }
            } else {
              product.destination_location_name = String(product.destination_location_name).toUpperCase();
            }

            product.destination_sku = destinationSku;

            // Ambil detail lokasi destination
            try {
              const locationResponse = await inventree.get(
                `/stock/location/?name=${product.destination_location_name}`
              );
              const firstResult = locationResponse.data?.results?.[0];
              product.destination_location_description = firstResult?.description || null;
              product.destination_location_id = firstResult?.pk || null;
            } catch {
              product.destination_location_name = null;
            }

            const locationDescription = product.destination_location_description;

            let destinationTypeTable;
            if (locationDescription === "GUDANG" || product.destination_location_name.includes("RE") || locationDescription === "REJECT") {
              destinationTypeTable = "Wholesale";
            } else if (locationDescription === "TOKO") {
              destinationTypeTable = "Retail";
            } else {
              destinationTypeTable = locationDescription || "Unknown";
            }

            // ===== Generate unique_id =====
            const unique_id = await generateUniqueId(
              fastify,
              product.destination_location_name,
              item.created_at
            );

            // ===== Send to Camunda =====
            const dataCamunda = {
              type: "start",
              endpoint: `/engine-rest/process-definition/key/Mirorim_Warehouse.Internal_Mutasi/start`,
              variables: {
                variables: {
                  destination_type: { value: destinationTypeTable, type: "String" },
                  source_type: { value: sourceTypeTable, type: "String" },
                  destination_location_name: { value: product.destination_location_name, type: "String" },
                  source_stock: { value: product.source_sku, type: "Integer" },
                  unique_trx: { value: unique_id, type: "String" },
                  business_key: { value: unique_id, type: "String" },
                },
                businessKey: `${part_name}:${product.source_location_name}:${item.urgensi}`,
              },
            };

            const responseCamunda = await camundaConfig(dataCamunda);
            console.log("✅ Camunda OK:", skuId);

            if (responseCamunda && (responseCamunda.status === 200 || responseCamunda.status === 204)) {
              const instanceId = responseCamunda.data.processInstanceId;

              // Insert mutasi_request
              const dataQuerySingle = {
                graph: {
                  method: "mutate",
                  endpoint: GRAPHQL_API,
                  gqlQuery: `
                    mutation insertMutasiRequest(
                      $proc_inst_id: String!,
                      $part_id: Int!,
                      $quantity: Int!,
                      $created_by: String!,
                      $created_at: timestamp!,
                      $status: String!,
                      $unique_id: String!,
                      $prepare: Boolean!,
                      $type: String!
                    ) {
                      insert_mutasi_request(objects: {
                        proc_inst_id: $proc_inst_id,
                        part_id: $part_id,
                        quantity: $quantity,
                        created_by: $created_by,
                        created_at: $created_at,
                        status: $status,
                        unique_trx: $unique_id,
                        is_prepare_needed: $prepare,
                        urgensi: $type
                      }) {
                        returning { id }
                      }
                    }
                  `,
                  variables: {
                    proc_inst_id: instanceId,
                    part_id: item.part_id,
                    quantity: product.quantity,
                    created_by: user,
                    created_at: item.created_at,
                    status: "Processed",
                    unique_id: unique_id,
                    prepare: false,
                    type: item.urgensi
                  },
                },
                query: [],
              };

              const responseSingle = await configureQuery(fastify, dataQuerySingle);
              const request_id =
                responseSingle.data[0].graph.insert_mutasi_request.returning[0].id;
              console.log("📌 request_id:", request_id);

              // Insert mutasi_request_details (source + destination)
              const dataQuery = [
                {
                  graph: {
                    method: "mutate",
                    endpoint: GRAPHQL_API,
                    gqlQuery: `
                      mutation insertMutasiDetail($request_id: Int!, $type: String!, $location_id: String!, $source_id: String!, $quantity: Int!, $updated_at: timestamp!, $created_at: timestamp!, $created_by: String!, $updated_by: String!) {
                        insert_mutasi_request_details(objects: {request_id: $request_id, type: $type, location_id: $location_id, source_id: $source_id, quantity: $quantity, updated_at: $updated_at, created_at: $created_at, created_by: $created_by, updated_by: $updated_by}) {
                          affected_rows
                        }
                      }
                    `,
                    variables: {
                      request_id,
                      type: "source",
                      location_id: product.source_location_name || "WH001",
                      source_id: String(product.source_sku),
                      quantity: product.quantity,
                      updated_at: item.created_at,
                      created_at: item.created_at,
                      created_by: user,
                      updated_by: user,
                    },
                  },
                  query: [],
                },
                {
                  graph: {
                    method: "mutate",
                    endpoint: GRAPHQL_API,
                    gqlQuery: `
                      mutation insertMutasiDetail($request_id: Int!, $type: String!, $location_id: String!, $source_id: String!, $quantity: Int!, $updated_at: timestamp!, $created_at: timestamp!, $created_by: String!, $updated_by: String!) {
                        insert_mutasi_request_details(objects: {request_id: $request_id, type: $type, location_id: $location_id, source_id: $source_id, quantity: $quantity, updated_at: $updated_at, created_at: $created_at, created_by: $created_by, updated_by: $updated_by}) {
                          affected_rows
                        }
                      }
                    `,
                    variables: {
                      request_id,
                      type: "destination",
                      location_id: product.destination_location_name || "WH001",
                      source_id: String(product.destination_sku) || null,
                      quantity: product.quantity,
                      updated_at: item.created_at || new Date().toISOString(),
                      created_at: item.created_at || new Date().toISOString(),
                      created_by: user,
                      updated_by: user,
                    },
                  },
                  query: [],
                },
              ];

              for (const query of dataQuery) {
                await configureQuery(fastify, query);
              }

              if(item.urgensi === "Prioritas"){
                          try {
                          const notification = {
                            title: "Mutasi Request Prioritas",
                            body: `New request ${product.destination_location_name} Prioritas for ${part_name} by ${item.user}`
                          };
              
                          const notificationData = {
                            type: "mutasi_request",
                            processInstanceId: instanceId,
                            sku: product.destination_location_name,
                            createdBy: item.user,
                            timestamp: new Date().toISOString()
                          };
              
                          console.log("item", item)
              
                          // Kirim notifikasi berdasarkan user yang membuat request
                          // Asumsi: item.name_employee adalah user ID/uid
                          const notificationResult = await sendNotificationToUserGroup(
                            item.user_id, 
                            notification, 
                            notificationData
                          );
              
                          
              
                          if (notificationResult.success) {
                            console.log(`✅ Notification sent to ${notificationResult.details.successCount} devices`);
                          } else {
                            console.warn("⚠ Notification failed:", notificationResult.message);
                          }
                          
                        } catch (notificationError) {
                          console.error("❌ Push notification error:", notificationError);
                          // Jangan throw error, biarkan proses utama tetap berjalan
                        }
                        }

              results.push({
                message: `Row SKU ${product.source_sku} berhasil diproses`,
              });
            }
          } catch (err) {
            console.error(`❌ Error pada row SKU ${product.source_sku}:`, err.message);
            throw err;
          }
        }
      } catch (error) {
        console.error("❌ Request ini Sudah ada di hari ini");
        throw new Error(`Request ini Sudah ada di hari ini`);
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
  const { eventKey, data } = eventData;
  console.log("eventData", eventData);

  if (!eventHandlers[eventKey]) {
    throw new Error(`No handler found for event: ${eventKey}`);
  }

  return await eventHandlers[eventKey](data);
};

module.exports = { handle };
