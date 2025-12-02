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
            file: { value: item.evidence[0], type: "string" }
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
          console.log("invoice", item.list_invoice);
          const checkedProducts = item.list_invoice.filter(product => product.check === true);
          console.log("checkedProducts", checkedProducts);

          const dataQuery = checkedProducts.map((product) => ({
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
      mutation MyMutation(
        $proc_inst_id: String!, 
        $invoice: String!, 
        $status: String!, 
        $date: timestamp!
      ) {
        update_mo_order_stock_check(
          where: {
            proc_inst_id: { _eq: $proc_inst_id }, 
            invoice: { _eq: $invoice }
          }, 
          _set: {
            status: $status, 
            updated_at: $date
          }
        ) {
          affected_rows
        }
      }
    `,
              variables: {
                proc_inst_id: instanceId,
                invoice: product.invoice,
                status: "Updated",
                date: item.updated_at,
              },
            },
            query: [],
          }));

          console.log("dataQuery", dataQuery);

          // Jalankan semua query secara paralel
          const responseQuery = await Promise.all(
            dataQuery.map((query) => configureQuery(fastify, query))
          );

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
