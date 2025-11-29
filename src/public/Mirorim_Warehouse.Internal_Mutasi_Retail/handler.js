const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const axios = require("axios");
const { sendNotificationToUserGroup } = require("../../utils/firebase/groupNotificationSender");

const GRAPHQL_API = process.env.GRAPHQL_API;
const SERVER_INVENTREE = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;

/* ==================== 🔹 Helper Functions ==================== */
function formatDateYYYYMMDD(dateInput) {
  const date = new Date(dateInput);
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
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

  // 🔁 Loop sampai ketemu unique_id yang belum ada
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

/* ==================== 🔹 Event Handlers ==================== */
const eventHandlers = {
  async onSubmit(data) {
    const results = [];

    for (const item of data) {
      try {
        const instanceId = item.proc_inst_id || null;
        console.log("📦 Processing item:", item);
        const { part_id, products, user = "Unknown" } = item;

        const inventree = axios.create({
          baseURL: `${SERVER_INVENTREE}/api`,
          headers: {
            Authorization: `Token ${INVENTREE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          timeout: 10000,
        });

        let part_name = "UnknownPart";
        try {
          const partResponse = await inventree.get(`/part/${part_id}/`);
          part_name = partResponse.data?.full_name || "UnknownPart";
        } catch {
          console.warn(`⚠️ Gagal ambil nama part untuk part_id ${part_id}`);
        }

        for (const product of products) {
          try {
            const destinationSku = product.destination_sku;

            // Ambil stok & lokasi
            let stockQty = 0;
            try {
              const stockResponse = await inventree.get(`/stock/${destinationSku}/`);
              product.destination_location_name = stockResponse.data?.location_name || null;
              stockQty = stockResponse.data?.quantity || 0;
            } catch {
              product.destination_location_name = null;
              stockQty = 0;
            }

            if (!product.destination_location_name) {
              product.destination_location_name = String(product.sku_available)?.trim().toUpperCase() || "WH001";
              console.warn(`⚠️ Fallback lokasi DESTINATION → ${product.destination_location_name}`);
            } else {
              product.destination_location_name = String(product.destination_location_name).toUpperCase();
            }

            // Detail lokasi
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

            const destDesc = product.destination_location_description;
            const destinationTypeTable =
              destDesc === "GUDANG"
                ? "Wholesale"
                : destDesc === "TOKO"
                ? "Retail"
                : destDesc || "Unknown";

            // Generate unique_id
            const unique_id = await generateUniqueId(
              fastify,
              product.destination_location_name,
              item.created_at
            );

            // 🔹 Kirim ke Camunda
            const dataCamunda = {
              type: "start",
              endpoint: `/engine-rest/message/`,
              variables: {
                messageName: "StartMessageRekomendasiMutasiWIP",
                resultEnabled: true,
                businessKey: `${part_name}:${product.destination_location_name}:${item.urgensi}`,
                processVariables: {
                  destination_type: { value: destinationTypeTable, type: "String" },
                  destination_location_name: { value: product.destination_location_name, type: "String" },
                  destination_stock: { value: product.destination_sku, type: "Integer" },
                  unique_trx: { value: unique_id, type: "String" },
                  business_key: { value: unique_id, type: "String" },
                },
              },
            };

            const responseCamunda = await camundaConfig(dataCamunda, instanceId, null);

            const instance = responseCamunda?.data?.processInstanceId;
            
            if (!instance) {
              console.warn("⚠️   Camunda tidak mengembalikan processInstanceId");
            }

            // 🔹 Insert ke mutasi_request
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
                    $type: String!,
                    $notes: String!
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
                      urgensi: $type,
                      notes: $notes
                    }) {
                      returning { id }
                    }
                  }
                `,
                variables: {
                  proc_inst_id: instance || "undefined",
                  part_id: item.part_id,
                  quantity: product.quantity,
                  created_by: user,
                  created_at: item.created_at,
                  status: "Processed",
                  unique_id,
                  prepare: false,
                  type: item.urgensi,
                  notes: item.notes || "-",
                },
              },
              query: [],
            };

            console.log("📌 Insert Mutasi Request:", dataQuerySingle);

            const responseSingle = await configureQuery(fastify, dataQuerySingle);
            console.log("response", JSON.stringify(responseSingle.data, null, 2));
            const request_id =
              responseSingle.data[0].graph.insert_mutasi_request.returning[0].id;

            console.log("📌 mutasi_request id:", request_id);

            // 🔹 Insert mutasi_request_details
            const dataDetail = {
              graph: {
                method: "mutate",
                endpoint: GRAPHQL_API,
                gqlQuery: `
                  mutation insertMutasiDetail(
                    $request_id: Int!,
                    $type: String!,
                    $location_id: String!,
                    $source_id: String!,
                    $quantity: Int!,
                    $updated_at: timestamp!,
                    $created_at: timestamp!,
                    $created_by: String!,
                    $updated_by: String!
                  ) {
                    insert_mutasi_request_details(objects: {
                      request_id: $request_id,
                      type: $type,
                      location_id: $location_id,
                      source_id: $source_id,
                      quantity: $quantity,
                      updated_at: $updated_at,
                      created_at: $created_at,
                      created_by: $created_by,
                      updated_by: $updated_by
                    }) {
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
            };

            await configureQuery(fastify, dataDetail);

            // 🔹 Push Notification jika prioritas
            if (item.urgensi === "Prioritas") {
              try {
                const notification = {
                  title: "Mutasi Request Prioritas",
                  body: `New request ${product.destination_location_name} Prioritas for ${part_name} by ${item.user}`,
                };

                const notificationData = {
                  type: "mutasi_request",
                  processInstanceId: instance,
                  sku: product.destination_location_name,
                  createdBy: item.user,
                  timestamp: new Date().toISOString(),
                };

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
              }
            }

            results.push({
              message: `Row SKU ${product.destination_sku} berhasil diproses`,
            });
          } catch (err) {
            console.error(err.message);
            throw err;
          }
        }
      } catch (error) {
        console.error(error.message);
        throw new Error("Request ini sudah ada di hari ini");
      }
    }

    return results;
  },

  async onChange(data) {
    console.log("Handling onChange with data:", data);
    return { message: "onChange executed", data };
  },
};

/* ==================== 🚀 Event Dispatcher ==================== */
const handle = async (eventData) => {
  const { eventKey, data } = eventData;
  console.log("📩 Event Data:", eventData);

  if (!eventHandlers[eventKey]) {
    throw new Error(`No handler found for event: ${eventKey}`);
  }

  return await eventHandlers[eventKey](data);
};

module.exports = { handle };
