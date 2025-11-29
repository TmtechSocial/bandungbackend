const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const axios = require("axios");
const { sendNotificationToUserGroup } = require("../../utils/firebase/groupNotificationSender");

const GRAPHQL_API = process.env.GRAPHQL_API;
const SERVER_INVENTREE = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;

const eventHandlers = {
  async onSubmit(data) {
    const results = [];

    for (const item of data) {
      try {
        let instanceId = item.proc_inst_id || null;
        const destinationSkuOriginal = item.destination;


        // ?? Format tanggal: YY-MM-DD
        const now = new Date();
        const yy = String(now.getFullYear()).slice(-2);
        const mm = String(now.getMonth() + 1).padStart(2, "0");
        const dd = String(now.getDate()).padStart(2, "0");
        const formattedDate = `${yy}-${mm}-${dd}`;

        // ?? Base Unique: tanpa nomor dulu
        const baseUniqueTrx = `Refill|${formattedDate}|${item.destination}`;
        const likeunique = `${baseUniqueTrx}%`; // like baseUniqueTrx
        let unique_trx = `${baseUniqueTrx}|`;

        // ?? Cek apakah sudah ada unique_trx serupa di DB
        const checkQuery = {
          graph: {
            method: "query",
            endpoint: GRAPHQL_API,
            gqlQuery: `
              query CheckExistingTrx($likeunique: String!) {
  internal_consolidation_process(where: {unique_trx: {_ilike: $likeunique}}, order_by: {id: desc}, limit: 1) {
    unique_trx
  }
}
            `,
            variables: { likeunique },
          },
          query: [],
        };
        console.log("checkkkk",checkQuery);
        

        const checkResponse = await configureQuery(fastify, checkQuery);
        console.log("checkResponse", JSON.stringify(checkResponse));
        
        const existing = checkResponse?.data?.[0].graph?.internal_consolidation_process?.[0];
        console.log("existing", existing);
        

        // ?? Kalau sudah ada, tambahkan /1, /2, dst
       if (existing) {
  const lastTrx = (existing.unique_trx || "").trim();
  const match = lastTrx.match(/\|(\d+)$/);
  const nextNumber = match ? parseInt(match[1], 10) + 1 : 1;
  unique_trx = `${baseUniqueTrx}|${nextNumber}`;
}


        console.log("Generated unique_trx:", unique_trx);

        // ?? Ambil data part dari Inventree
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
          const partResponse = await inventree.get(`/part/${item.part_id_text}/`);
          part_name = partResponse.data?.full_name || "UnknownPart";
        } catch {
          console.warn(`?? Gagal ambil part_name untuk part_id ${item.part_id_text}`);
        }

         let destinationSku = destinationSkuOriginal;
            try {
              const stockDestination = await inventree.get(`/stock/${destinationSku}/`);
              item.destination_location_name =
                stockDestination.data?.location_name || null;
            } catch {
              item.destination_location_name = null;
            }

            // Fallback destination
            if (!item.destination_location_name) {
              if (item.sku_available && String(item.sku_available).trim() !== "") {
                item.destination_location_name = String(item.sku_available).trim().toUpperCase();
                console.warn(
                  `?? Fallback lokasi DESTINATION dari sku_available ? ${item.destination_location_name}`
                );
              } else {
                item.destination_location_name = "WH001";
                console.warn(`?? Fallback lokasi DESTINATION default ? WH001`);
              }
            } else {
              item.destination_location_name = String(item.destination_location_name).toUpperCase();
            }

            item.destination = destinationSku;

        try {
              const locationResponse = await inventree.get(
                `/stock/location/?name=${item.destination}`
              );
              const firstResult = locationResponse.data?.results?.[0];
              item.destination_location_description = firstResult?.description || null;
              item.destination_location_id = firstResult?.pk || null;
            } catch {
              item.destination_location_description = null;
            }

            const locationDescription = item.destination_location_description;

            let destinationTypeTable;
            if (locationDescription === "GUDANG" || locationDescription === "REJECT" || item.destination.includes("RE")) {
              destinationTypeTable = "Wholesale";
            } else if (locationDescription === "TOKO") {
              destinationTypeTable = "Retail";
            } else {
              destinationTypeTable = locationDescription || "Unknown";
            }

            console.log(destinationTypeTable);
            
        // ?? Kirim ke Camunda
        const dataCamunda = {
          type: "start",
          endpoint: `/engine-rest/process-definition/key/Mirorim_Warehouse.Generic_Mutasi_Prepare/start`,
          variables: {
            variables: {
              destination_type: { value: destinationTypeTable, type: "String" },
              part_id: { value: item.part_id_text, type: "Integer" },
              destination_consolidation: { value: item.destination, type: "String" },
              quantity: { value: item.quantity, type: "Integer" },
              type: { value: "Refill", type: "String" },
              unique_trx: { value: unique_trx, type: "String" },
              business_key: { value: unique_trx, type: "String" },
              created_by: { value: item.user, type: "String" },
              product_name: { value: part_name, type: "String" },
              urgensi: { value: item.urgensi, type: "String" },
            },
            businessKey: `${part_name}:${item.destination}:${item.urgensi}`,
          },
        };

        const responseCamunda = await camundaConfig(dataCamunda, instanceId);

        if(item.urgensi === "Prioritas"){
                                  try {
                                  const notification = {
                                    title: "Mutasi Request Prioritas",
                                    body: `New request ${item.destination} Mutasi Prepare Prioritas by ${item.user}`
                                  };
                      
                                  const notificationData = {
                                    type: "mutasi_request_prepare",
                                    processInstanceId: instanceId,
                                    sku: item.destination,
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
                                    console.log(`? Notification sent to ${notificationResult.details.successCount} devices`);
                                  } else {
                                    console.warn("? Notification failed:", notificationResult.message);
                                  }
                                  
                                } catch (notificationError) {
                                  console.error("? Push notification error:", notificationError);
                                  // Jangan throw error, biarkan proses utama tetap berjalan
                                }
                                }

        results.push({
          message: "Process started successfully",
          camunda: responseCamunda.data,
          unique_trx,
        });
      } catch (error) {
        console.error("Error executing onSubmit:", error);
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
  const { eventKey, data } = eventData;
  console.log("eventData", eventData);

  if (!eventHandlers[eventKey]) {
    throw new Error(`No handler found for event: ${eventKey}`);
  }

  try {
    return await eventHandlers[eventKey](data);
  } catch (error) {
    console.error(`Error executing handler for event: ${eventKey}`, error);
    throw error;
  }
};

module.exports = { handle };