const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")();
const axios = require("axios");
const GRAPHQL_API = process.env.GRAPHQL_API;
const SERVER_INVENTREE = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;
const CAMUNDA_API = process.env.CAMUNDA_API;
console.log("CAMUNDA_API:", CAMUNDA_API);


const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];
    for (const item of data) {
      try {
        let taskId;
        let instanceId = item.proc_inst_id || null; 

        const getBusinessKeyCurrent = async (proc_inst_id) => {
  try {
    const response = await axios.get(
      `${CAMUNDA_API}engine-rest/process-instance/${proc_inst_id}/variables/business_key`
    );
    return response.data?.value || null;
  } catch (err) {
    console.error("❌ Gagal ambil business_key dari Camunda:", err.message);
    return null;
  }
};


         const getLocationWarehouse = async (item) => {
  try {
    const baseURL = SERVER_INVENTREE;
    const token = INVENTREE_API_TOKEN;
    const sourceLocation = item.source_location || 0; // ✅ default jadi "0"
    const part = item.part_id;

    const axiosInstance = axios.create({
      baseURL,
      headers: {
        Authorization: `Token ${token}`,
      },
    });

    // Step 1: Ambil lokasi berdasarkan SKU
    if (sourceLocation === 0) {
      console.warn("⚠️ source_location kosong, gunakan default 0");
      return { warehouse_name: "UNKNOWN", gudangName: "GUDANG X" };
    }

    const responseSku = await axiosInstance.get(
      `/api/stock/${encodeURIComponent(sourceLocation)}/`
    );

    const skuResults = responseSku.data;
    if (!skuResults || skuResults.length === 0) {
      console.error("❌ Lokasi PK tidak ditemukan dari SKU");
      return null;
    }

    const warehouse_name = skuResults.location_name;
    console.log("✅ PK Lokasi:", warehouse_name);

    const firstLetter = warehouse_name.match(/[A-Z]/i)?.[0] || "X";
    const gudangName = `GUDANG ${firstLetter.toUpperCase()}`;

    console.log("✅ Gudang:", gudangName);

    return { warehouse_name, gudangName };
  } catch (err) {
    console.error("❌ Error saat fetch Inventree API:", err.message);
    return null;
  }
};

        
                const inventreeData = await getLocationWarehouse(item);
                if (!inventreeData) continue;
        
                const { warehouse_name, gudangName} = inventreeData;

        const businessKeyCurrent = await getBusinessKeyCurrent(item.proc_inst_id);
        console.log("✅ business_key current:", businessKeyCurrent);
        
if (!businessKeyCurrent) {
  console.error("❌ business_key tidak ditemukan untuk proc_inst_id:", item.proc_inst_id);
  continue;
}

const dataCamunda = {
  type: "complete",
  endpoint: `/engine-rest/task/{taskId}/complete`,
  instance: item.proc_inst_id,
  variables: {
    variables: {
      terima_refill: { value: item.terima_refill, type: "boolean" },
      quantity_approve: { value: item.quantity_approve, type: "Integer" },
      business_key: {
        value: `${businessKeyCurrent}:${gudangName}:${warehouse_name}`,
        type: "string",
      },
    },
  },
};


        const responseCamunda = await camundaConfig(dataCamunda, instanceId, process);
        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          // const instanceId = responseCamunda.data.processInstanceId;
            const dataQuery = {
              graph: {
                method: "mutate",
                endpoint: GRAPHQL_API,
                gqlQuery: `mutation MyMutation($proc_inst_id: String!, $quantity_approve: Int!, $notes: String, $stock_pk: Int!, $task_def_key: String!, $warehouse_sku: String!, $created_at: timestamp!, $created_by: String!,  $status: String!, $id: Int!) {
  update_mo_refill(where: {proc_inst_id: {_eq: $proc_inst_id}}, _set: {quantity_approve: $quantity_approve, stock_pk_resource: $stock_pk, warehouse_sku: $warehouse_sku, status: $status}) {
    affected_rows
  }
  insert_mo_refill_detail(objects: {quantity: $quantity_approve, notes: $notes, created_at: $created_at, created_by: $created_by, task_def_key: $task_def_key, refill_id: $id}) {
    affected_rows
  }
}`,
                variables: {
                  proc_inst_id: item.proc_inst_id,
                  quantity_approve: item.quantity_approve,
                  stock_pk: item.source_location || 0,
                  status: item.terima_refill ? "On Progress" : "Rejected Refill",
                  task_def_key: "Mirorim_Operasional.Refill.Terima_Refill",
                  notes: item.notes || '',
                  created_at: item.date,
                  created_by: item.name_employee,
                  id: item.id,
                  warehouse_sku: warehouse_name || 'UNKNOWN',
                },
              },
            };

          const responseQuery = await configureQuery(fastify, dataQuery);

          console.log("responseQuery", responseQuery);

          results.push({
            message: "Create event processed successfully",
            camunda: responseCamunda.data,
            database: responseQuery.data,
          });
        }
      } catch (error) {
        console.error(`Error executing handler for event: ${eventKey}`, error);
        //console.log( `graphql error: ${error.dataQuery}`);
        
        throw error;
      }
    }

    return results;
  },

  async onChange(data) {
    //console.log("Handling onChange with data:", data);
    // Implementasi onChange
    return { message: "onChange executed", data };
  },
};

const handle = async (eventData) => {
  const { eventKey, data, process } = eventData;
  console.log("eventData", eventKey, data, process);

  if (!eventHandlers[eventKey]) {
    throw new Error(`No handler found for event: ${eventKey}`);
  }

  // Panggil handler yang sesuai berdasarkan event
  try {
    return await eventHandlers[eventKey](data, process);
  } catch (error) {
    console.error(`Error executing handler for event: ${eventKey}`, error);
    throw error;
  }
};

module.exports = { handle };
