const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")(); // pastikan instance ini dikonfigurasi bila perlu
const dotenv = require("dotenv");
const axios = require("axios");
const { sendNotificationToUserGroup } = require("../../utils/firebase/groupNotificationSender");

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

            const getPartName = await axiosInstance.get(
              `/api/part/${part}/`
            );
            const partNameResults = getPartName.data || [];
            
            const partName = partNameResults.full_name || "Unknown Part";

            console.log("✅ Nama Part:", partName);

            

            return { pkLocation, part, partName };
          } catch (err) {
            console.error("❌ Error saat fetch Inventree API:", err.message);
            return null;
          }
        };

        const inventreeData = await getPartLocationNames(item);
        if (!inventreeData) continue;

        const { gudangName, partName } = inventreeData;

        const dataCamunda = {
          type: "start",
          endpoint: `/engine-rest/process-definition/key/Mirorim_Operasional.Refill/start`,
          variables: {
            variables: {
              refill_operasional: { value: item.refill_type, type: "string" },
              business_key: { value: item.urgensi, type: "string" },
            },
            businessKey: `${partName}:${item.sku}:${item.refill_type}`,
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
                $status: String!,
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
                  refill_type: $refill_type,
                  status: $status
                }) {
                  affected_rows
                }
              }
            `,
              variables: {
                proc_inst_id: instanceId, // <-- pastikan ini adalah String UUID
                sku: item.sku,
                name_employee: item.name_employee,
                refill_type: item.refill_type,
                refill_date: item.refill_date, // pastikan ini format ISO string: "YYYY-MM-DD HH:mm:ss"
                destination_location_id: inventreeData.pkLocation,
                part_id: inventreeData.part,
                quantity_request: item.quantity_request,
                status: "pending",
              },
            },
            query: [],
          };

          const responseQuery = await configureQuery(fastify, dataQuery);
          console.log("responseQuery", responseQuery);
          
          
          if(item.urgensi === "Prioritas"){
            try {
            const notification = {
              title: "Refill Request Prioritas",
              body: `New ${item.refill_type} request Prioritas for ${item.sku} by ${item.name_employee}`
            };

            const notificationData = {
              type: "refill_request",
              processInstanceId: instanceId,
              sku: item.sku,
              refillType: item.refill_type,
              createdBy: item.name_employee,
              timestamp: new Date().toISOString()
            };

            console.log("item", item)

            // Kirim notifikasi berdasarkan user yang membuat request
            // Asumsi: item.name_employee adalah user ID/uid
            const notificationResult = await sendNotificationToUserGroup(
              item.id_employee, 
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
