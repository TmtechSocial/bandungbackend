const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const GRAPHQL_API = process.env.GRAPHQL_API;

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];
    for (const item of data) {
      try {
        let taskId;
        let instanceId = item.proc_inst_id || null;

        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {
              quantity_request: {
                value: item.quantity_request,
                type: "Integer",
              },
              lokasi_tujuan: { value: item.location, type: "string" },
              part_id: { value: item.product_name, type: "string" },
            },
          },
        };

        const responseCamunda = await camundaConfig(
          dataCamunda,
          instanceId,
          process
        );
        console.log("responseCamunda", responseCamunda);
        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          // const instanceId = responseCamunda.data.processInstanceId;
          const dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `mutation MyMutation($proc_inst_id: String!, $label_product_name: String!, $product_name: Int!, $quantity_request: Int!, $location: String!, $label_location_name: String!) { update_mo_refill(where: { proc_inst_id: { _eq: $proc_inst_id } }, _set: { product_name: $label_product_name, product_key: $product_name, quantity_request: $quantity_request, location: $location, destination_location_name: $label_location_name }) { affected_rows } }`,
              variables: {
                proc_inst_id: item.proc_inst_id,
                label_product_name: item.label_product_name,
                label_location_name: item.label_location_name,
                product_name: item.product_name,
                quantity_request: item.quantity_request,
                location: item.location.toString(),
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
        throw error;
      }
    }

    return results;
  },

  async onChange(data, process) {
    console.log("Handling onChange with data:", data);

    // Ambil nilai objek utama (dengan key angka seperti '0') jika ada
    const firstKey = Object.keys(data).find((key) => !isNaN(key));
    let responseData = { ...(data[firstKey] || {}) };

    // Tambahkan properti lain dari data (seperti quantity_request di luar objek '0')
    for (const key in data) {
      if (key !== firstKey) {
        responseData[key] = data[key];
      }
    }

    // Cek dan isi field default jika belum ada
    if (!responseData.quantity_request) {
      responseData.quantity_request = 10;
      responseData.refill_type = "non manual";
    }

    if (responseData.product_name && !responseData.location) {
      responseData.location = "WAREHOUSE-A";
    }

    console.log("Processed onChange data:", responseData);

    return {
      message: "onChange executed",
      data: responseData,
    };
  },
};

const handle = async (eventData) => {
  const { eventKey, data, process } = eventData;
  console.log("eventData", eventData);

  if (!eventHandlers[eventKey]) {
    throw new Error(`No handler found for event: ${eventKey}`);
  }

  // Panggil handler yang sesuai berdasarkan event
  try {
    // Pastikan event data diproses dengan benar, sesuaikan dengan format yang diharapkan
    return await eventHandlers[eventKey](data, process);
  } catch (error) {
    console.error(`Error executing handler for event: ${eventKey}`, error);
    throw error;
  }
};

module.exports = { handle };
