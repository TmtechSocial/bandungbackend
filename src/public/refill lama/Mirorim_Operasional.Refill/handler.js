const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")(); // pastikan instance ini dikonfigurasi bila perlu
const dotenv = require("dotenv");
const axios = require("axios");

dotenv.config(); // pastikan load env
const GRAPHQL_API = process.env.GRAPHQL_API;

const eventHandlers = {
  async onSubmit(data, eventKey) {
    const results = [];

    for (const item of data) {
      try {
        const instanceId = item.proc_inst_id || null;
        console.log("📦 SKU:", item.sku);

        // Fungsi ambil lokasi part berdasarkan SKU
        const getPartLocationNames = async (item) => {
          try {
            const baseURL = process.env.SERVER_INVENTREE;
            const token = process.env.INVENTREE_API_TOKEN;

            const axiosInstance = axios.create({
              baseURL,
              headers: {
                Authorization: `Token ${token}`,
              },
            });

            // Step 1: Ambil lokasi berdasarkan SKU
            const responseSku = await axiosInstance.get(
              `/api/stock/location/?name=${encodeURIComponent(item.sku)}`
            );
            const skuResults = responseSku.data.results;
            if (!skuResults || skuResults.length === 0) {
              console.error("❌ Lokasi PK tidak ditemukan dari SKU");
              return null;
            }

            const pkLocation = skuResults[0].pk;
            console.log("✅ PK Lokasi:", pkLocation);

            // Step 2: Ambil data stock berdasarkan lokasi PK
            const responseSkuPk = await axiosInstance.get(
              `/api/stock/?location=${pkLocation}`
            );
            const stockResults = responseSkuPk.data.results;
            if (!stockResults || stockResults.length === 0) {
              console.error("❌ Data stok kosong pada lokasi PK");
              return null;
            }

            const part = stockResults[0].part;
            if (!part) {
              console.error("❌ Part tidak ditemukan dari data lokasi PK");
              return null;
            }

            console.log("✅ PART:", part);

            // Step 3: Ambil semua stock berdasarkan part
            const responsePart = await axiosInstance.get(
              `/api/stock/?part=${part}`
            );
            const partResults = responsePart.data.results || [];

            const filteredData = partResults.filter(
              (item) =>
                item.batch !== null &&
                typeof item.location_name === "string" &&
                item.location_name.length >= 5 &&
                item.location_name[0] === "1" // hanya yang diawali angka 1
            );

            // Urutkan berdasarkan nama lokasi (ascending)
            filteredData.sort((a, b) =>
              a.location_name.localeCompare(b.location_name)
            );

            const locationNames = filteredData.map(
              (item) => item.location_name
            );
            const selectedLocation = filteredData[0]?.location_name || "";
            const firstLetter = selectedLocation.match(/[A-Z]/i)?.[0] || "X";

            const gudangName = `GUDANG ${firstLetter.toUpperCase()}`;

            console.log("✅ Lokasi dengan batch:", locationNames);
            console.log("✅ Gudang:", gudangName);

            return { pkLocation, part, locationNames, gudangName };
          } catch (err) {
            console.error("❌ Error saat fetch Inventree API:", err.message);
            return null;
          }
        };

        const inventreeData = await getPartLocationNames(item);
        if (!inventreeData) continue;

        const { gudangName } = inventreeData;

        const dataCamunda = {
          type: "start",
          endpoint: `/engine-rest/process-definition/key/Mirorim_Operasional.Refill/start`,
          variables: {
            variables: {
              refill_operasional: { value: item.refill_type, type: "string" },
            },
            businessKey: `${gudangName}:${item.sku}:${item.refill_type}`,
          },
        };

        const responseCamunda = await camundaConfig(dataCamunda, instanceId);
        console.log(
          "✅ Camunda response",
          responseCamunda?.data || responseCamunda
        );

        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          const instanceId = responseCamunda.data.processInstanceId;

          const dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
              mutation InsertRefill(
                $proc_inst_id: String!,
                $name_employee: String!,
                $refill_type: String!,
                $refill_date: timestamp!,
                $sku: String!,
                $destination_location_id: Int!,
                $part_id: Int!,
                $quantity_request: Int!
              ) {
                insert_mo_refill(objects: {
                  proc_inst_id: $proc_inst_id,
                  sku: $sku,
                  destination_location_id: $destination_location_id,
                  part_id: $part_id,
                  quantity_request: $quantity_request,
                  created_at: $refill_date,
                  created_by: $name_employee,
                  refill_type: $refill_type
                }) {
                  affected_rows
                }
              }
            `,
              variables: {
                proc_inst_id: instanceId, // <-- pastikan ini adalah String UUID
                name_employee: item.name_employee,
                refill_type: item.refill_type,
                refill_date: item.refill_date, // pastikan ini format ISO string: "YYYY-MM-DD HH:mm:ss"
                sku: item.sku,
                destination_location_id: inventreeData.pkLocation,
                part_id: inventreeData.part,
                quantity_request: item.quantity_request,
              },
            },
            query: [],
          };

          const responseQuery = await configureQuery(fastify, dataQuery);
          console.log("responseQuery", responseQuery);

          results.push({
            message: "✅ Create event processed successfully",
            camunda: responseCamunda.data,
            database: responseQuery.data,
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

// ⛓️ Handler utama
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
