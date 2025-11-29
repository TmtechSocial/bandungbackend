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

        // Ambil nama part
        let part_name = "UnknownPart";
        try {
          const partResponse = await inventree.get(`/part/${part_id}/`);
          part_name = partResponse.data?.full_name || "UnknownPart";
        } catch {
          console.warn(`⚠️ Gagal ambil part_name untuk part_id ${part_id}`);
        }

        let locationNames = [];
        for (const product of products) {
          const skuId = product.source_sku;
          const destinationSkuOriginal = product.destination_sku;

          try {
            // ===== Ambil lokasi source =====
            try {
              const stockResponse = await inventree.get(`/stock/${skuId}/`);
              product.source_location_name = stockResponse.data?.location_name || null;
            } catch {
              product.source_location_name = null;
            }

            // Fallback kalau source_location_name null
            if (!product.source_location_name) {
              if (product.sku_available && String(product.sku_available).trim() !== "") {
                product.source_location_name = String(product.sku_available).trim();
                console.warn(`⚠️ Fallback lokasi SOURCE dari sku_available → ${product.source_location_name}`);
              } else {
                product.source_location_name = "WH001";
                console.warn(`⚠️ Fallback lokasi SOURCE default → WH001`);
              }
            }

            // ===== Ambil lokasi destination =====
            let destinationSku = destinationSkuOriginal;

            if (product.sku_available && String(product.sku_available).trim() !== "") {
              const skuAvailableTrimmed = String(product.sku_available).trim();
              console.log(`ℹ️ Override destination_sku dari '${product.destination_sku}' → '${skuAvailableTrimmed}'`);
              destinationSku = skuAvailableTrimmed;
            }

            try {
              const stockDestination = await inventree.get(`/stock/${destinationSku}/`);
              product.destination_location_name = stockDestination.data?.location_name || null;
            } catch {
              product.destination_location_name = null;
            }

            if (!product.destination_location_name) {
              if (product.sku_available && String(product.sku_available).trim() !== "") {
                product.destination_location_name = String(product.sku_available).trim();
                console.warn(`⚠️ Fallback lokasi DESTINATION dari sku_available → ${product.destination_location_name}`);
              } else {
                product.destination_location_name = "WH001";
                console.warn(`⚠️ Fallback lokasi DESTINATION default → WH001`);
              }
            }

            product.destination_sku = destinationSku;

            locationNames.push(product.source_location_name);
          } catch (err) {
            console.warn(
              `⚠️ Gagal proses lokasi untuk SKU source ${product.source_sku} / destination ${product.destination_sku}`,
              err
            );
            if (!product.source_location_name) product.source_location_name = "WH001";
            if (!product.destination_location_name) product.destination_location_name = "WH001";
            locationNames.push(product.source_location_name);
          }
        }

        const combinedLocationNames = locationNames.join(",");
        console.log("📦 Part:", part_name);
        console.log("📍 Lokasi source_sku:", combinedLocationNames);

        // Kirim ke Camunda
        let responseCamunda = null;
        const dataCamunda = {
          type: "start",
          endpoint: `/engine-rest/process-definition/key/Mirorim_Stock.Mutasi_Gudang/start`,
          variables: {
            variables: {},
            businessKey: `Manual:${part_name}:${combinedLocationNames}`,
          },
        };

        try {
          responseCamunda = await camundaConfig(dataCamunda);
          console.log("✅ Camunda OK:", item.part_id);
        } catch (err) {
          console.error("❌ Error kirim Camunda:", err);
        }

        if (
          responseCamunda &&
          (responseCamunda.status === 200 || responseCamunda.status === 204)
        ) {
          const instanceId = responseCamunda.data.processInstanceId;
          const totalQty = products.reduce((sum, p) => sum + (p.quantity || 0), 0);

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
                  $type: String!
                ) {
                  insert_mutasi_request(objects: {
                    proc_inst_id: $proc_inst_id,
                    part_id: $part_id,
                    quantity: $quantity,
                    created_by: $created_by,
                    created_at: $created_at,
                    status: $status,
                    type: $type
                  }) {
                    returning { id }
                  }
                }
              `,
              variables: {
                proc_inst_id: instanceId,
                part_id: item.part_id,
                quantity: totalQty || 0,
                created_by: user,
                created_at: item.created_at || new Date().toISOString(),
                status: "pending",
                type: "manual",
              },
            },
            query: [],
          };

          const responseSingle = await configureQuery(fastify, dataQuerySingle);
          const request_id = responseSingle.data[0].graph.insert_mutasi_request.returning[0].id;
          console.log("📌 request_id:", request_id);

          // Insert mutasi_request_details
          const dataQuery = products.flatMap((product) => [
            {
              graph: {
                method: "mutate",
                endpoint: GRAPHQL_API,
                gqlQuery: `
                  mutation insertMutasiDetail(
                    $request_id: Int!,
                    $type: String!,
                    $location_id: String!,
                    $sku_id: String!,
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
                      sku_id: $sku_id,
                      quantity: $quantity,
                      updated_at: $updated_at,
                      created_at: $created_at,
                      created_by: $created_by,
                      updated_by: $updated_by
                    }) { affected_rows }
                  }
                `,
                variables: {
                  request_id,
                  type: "source",
                  location_id: product.source_location_name || "WH001",
                  sku_id: String(product.source_sku),
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
                  mutation insertMutasiDetail(
                    $request_id: Int!,
                    $type: String!,
                    $location_id: String!,
                    $sku_id: String!,
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
                      sku_id: $sku_id,
                      quantity: $quantity,
                      updated_at: $updated_at,
                      created_at: $created_at,
                      created_by: $created_by,
                      updated_by: $updated_by
                    }) { affected_rows }
                  }
                `,
                variables: {
                  request_id,
                  type: "destination",
                  location_id: product.destination_location_name || "WH001",
                  sku_id: String(product.destination_sku),
                  quantity: product.quantity,
                  updated_at: item.created_at || new Date().toISOString(),
                  created_at: item.created_at || new Date().toISOString(),
                  created_by: user,
                  updated_by: user,
                },
              },
              query: [],
            },
          ]);

for (const query of dataQuery) {
  await configureQuery(fastify, query);
}
results.push({ message: "Save event processed successfully" });
        }
      } catch (error) {
        console.error("❌ Handler error:", error);
        const errMsg = error?.response?.data
          ? JSON.stringify(error.response.data, null, 2)
          : error.message || "Unknown error";
        throw new Error(`Handler gagal: ${errMsg}`);
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
