const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")();
const axios = require("axios");

const GRAPHQL_API = process.env.GRAPHQL_API;
const SERVER_INVENTREE = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;

// Axios client untuk Inventree
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
    console.log("?? Handling onSubmit event with data:", data);
    console.log("?? Handling onSubmit event with products:", data[0].products);
    for (const item of data) {
      try {
        let destinationTypeTable = "Unknown";
        let sourceTypeTable = "Unknown";
        // --- 1. Cek stok tiap produk ---
        for (const product of item.products) {
          try {
            // Ambil stok dari Inventree
            const source_stock_item = product.source_sku;
            const stockRes = await inventree.get(
              `/stock/${source_stock_item}/`
            );
            const stockQty = stockRes.data?.quantity || 0;
            const locationName =
              stockRes.data?.location_name || "UnknownLocation";

            // Ambil deskripsi lokasi sumber
            const sourceRes = await inventree.get(
              `/stock/location/?name=${locationName}`
            );
            const locationSourceDescription =
              sourceRes.data?.results?.[0]?.description || null;

            // Ambil deskripsi lokasi tujuan
            const locationDestinationName = item.location_id;
            const destinationRes = await inventree.get(
              `/stock/location/?name=${locationDestinationName}`
            );
            const locationDestinationDescription =
              destinationRes.data?.results?.[0]?.description || null;

            // Normalisasi tipe lokasi sumber & tujuan
            const mapLocationType = (desc) => {
              if (desc === "GUDANG" || locationDestinationName.includes("RE")) return "Wholesale";
              if (desc === "TOKO") return "Retail";
              return desc || "Unknown";
            };

            const mappedSourceType = mapLocationType(locationSourceDescription);
            const mappedDestinationType = mapLocationType(
              locationDestinationDescription
            );
            if (destinationTypeTable === "Unknown")
              destinationTypeTable = mappedDestinationType;
            if (sourceTypeTable === "Unknown")
              sourceTypeTable = mappedSourceType;

            console.log("testtttt", destinationTypeTable, sourceTypeTable);

            // Simpan info ke produk
            product.source_location_name = locationName;
            product.available_stock = stockQty;
            product.source_location_description = locationSourceDescription;
            product.destination_location_description =
              locationDestinationDescription;

            // Validasi stok
            if (stockQty < product.quantity) {
              throw new Error(
                `Stock tidak cukup di ${locationName}. Dibutuhkan ${product.quantity}, tersedia ${stockQty}`
              );
            }
          } catch (err) {
            console.error("? Error checking product stock:", err.message);
            product.source_location_name = "UnknownLocation";
            product.destination_location_name = "UnknownLocation";
            throw new Error(err.message);
          }
        }

        // --- 2. Generate Business Key & Unique ID ---
        const businessKeyValue = item.products
          .map((p) => p.source_location_name || "UnknownLocation")
          .join(":");

        const totalQty = item.products.reduce(
          (sum, p) => sum + (p.quantity || 0),
          0
        );

        const formatDateYYMMDD = (dateInput) => {
          const date = new Date(dateInput);
          const yy = String(date.getFullYear()).slice(-2);
          const mm = String(date.getMonth() + 1).padStart(2, "0");
          const dd = String(date.getDate()).padStart(2, "0");
          return `${yy}-${mm}-${dd}`;
        };

        const createdDate = formatDateYYMMDD(item.created_at || new Date());
        const locationDestinationName = item.location_id;
        const source_stock_items = item.products.map(p => p.source_sku).join(',');

        // --- 3. Complete task di Camunda ---
        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {
              Rekomendasi_Valid: { value: item.valid, type: "boolean" },
              destination_type: { value: destinationTypeTable, type: "String" },
              source_type: { value: sourceTypeTable, type: "String" },
              destination_location_name: { value: locationDestinationName, type: "String" },
              source_stock: { value: `[${source_stock_items}]`, type: "String" },
              unique_trx: { value: item.unique_trx, type: "String" },
              business_key: { value: item.unique_trx, type: "String" }
            },
          },
        };

        const responseCamunda = await camundaConfig(dataCamunda, item.proc_inst_id, process);
        console.log("? Camunda response:", responseCamunda.status);

        if (![200, 204].includes(responseCamunda.status)) continue;

        // --- 4. Update mutasi_request & details ---
        const dataQuery = {
          graph: {
            method: "mutate",
            endpoint: GRAPHQL_API,
            gqlQuery: `
              mutation updateBoth(
                $proc_inst_id: String!,
                $notes: String!,
                $status: String!,
                $request_id: Int!,
                $quantity: Int!
                $prepare: Boolean!
              ) {
                update_mutasi_request(
                  where: {proc_inst_id: {_eq: $proc_inst_id}},
                  _set: {quantity: $quantity, notes: $notes, status: $status, is_prepare_needed: $prepare}
                ) { affected_rows }

                update_mutasi_request_details(
                  where: {
                    _and: [
                      {request_id: {_eq: $request_id}},
                      {type: {_eq: "destination"}}
                    ]
                  },
                  _set: {quantity: $quantity}
                ) { affected_rows }
              }
            `,
            variables: {
              proc_inst_id: item.proc_inst_id,
              request_id: item.id,
              prepare: false,
              quantity: totalQty,
              notes: item.notes || "",
              status: item.valid ? "processed" : "rejected",
            },
          },
          query: [],
        };

        const responseQuery = await configureQuery(fastify, dataQuery);
        console.log("? Update query response:", JSON.stringify(responseQuery));

        // --- 5. Insert mutasi_request_details (source) ---
        console.log(`?? Inserting ${item.products.length} source details...`);

        for (const product of item.products) {
          try {
            const sourceDetailData = {
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
                    }) { affected_rows }
                  }
                `,
                variables: {
                  request_id: item.id,
                  type: "source",
                  location_id: product.source_location_name || "WH001",
                  source_id: String(product.source_sku),
                  quantity: product.quantity,
                  updated_at: item.created_at || new Date().toISOString(),
                  created_at: item.created_at || new Date().toISOString(),
                  created_by: item.user || "Unknown",
                  updated_by: item.user || "Unknown",
                },
              },
              query: [],
            };

            console.log(`  ?? Inserting source: SKU=${product.source_sku}, Location=${product.source_location_name}, Qty=${product.quantity}`);

            const res = await configureQuery(fastify, sourceDetailData);
            const bodyJson = res.body ? JSON.parse(res.body) : res.data;

            if (bodyJson.errors) {
              console.error("? GraphQL errors:", bodyJson.errors);
              throw new Error(`Failed to insert source detail for SKU ${product.source_sku}`);
            }

            const affectedRows = bodyJson.data?.insert_mutasi_request_details?.affected_rows || 0;
            console.log(`  ? Inserted ${affectedRows} row(s) for SKU ${product.source_sku}`);

          } catch (err) {
            console.error(`? Insert mutation error for SKU ${product.source_sku}:`, err.message);
            throw err;
          }
        }

        results.push({ message: "Save event processed successfully" });
      } catch (error) {
        const errMsg = error?.response?.data
          ? JSON.stringify(error.response.data, null, 2)
          : error.message || "Unknown error";
        throw new Error(`Handler gagal: ${errMsg}`);
      }
    }

    return results;
  },

  async onChange(data) {
    console.log("?? Handling onChange:", data);
    return { message: "onChange executed", data };
  },
};

const handle = async (eventData) => {
  const { eventKey, data, process } = eventData;
  if (!eventHandlers[eventKey]) {
    throw new Error(`No handler found for event: ${eventKey}`);
  }
  return await eventHandlers[eventKey](data, process);
};

module.exports = { handle };