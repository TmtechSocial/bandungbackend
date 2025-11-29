const { default: axios } = require("axios");
const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const GRAPHQL_API = process.env.GRAPHQL_API
const SERVER_INVENTREE = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;

async function getLocationName(stockId) {
  try {
    const response = await axios.get(`${SERVER_INVENTREE}/api/stock/${stockId}/`, {
      headers: {
        "Authorization": `Token ${INVENTREE_API_TOKEN}`,
      },
    });
    return response.data?.location_name || "Unknown";
  } catch (error) {
    console.error(`❌ Gagal ambil location untuk stock ID ${stockId}:`, error.message);
    return "Unknown";
  }
}

const eventHandlers = {
  async onSubmit(data, process) {
  const results = [];
  for (const item of data) {
    try {
      let instanceId = item.proc_inst_id || null;

      const dataCamunda = {
        type: "complete",
        endpoint: `/engine-rest/task/{taskId}/complete`,
        instance: item.proc_inst_id,
        variables: {
          variables: {
            pick_toko: { value: item.toko || false, type: "boolean" },
            pick_gudang: { value: item.gudang || false, type: "boolean" }
          },
        },
      };

      const responseCamunda = await camundaConfig(dataCamunda, instanceId, process);
      console.log("responseCamunda", responseCamunda);

      if (responseCamunda.status === 200 || responseCamunda.status === 204) {
        // Ambil lokasi untuk setiap produk
        const dataQuery = await Promise.all(item.products.map(async product => {
          const locationName = await getLocationName(product.output_location);

          return {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `mutation InsertManufacturePick($id: Int!, $part_id: Int!, $output: String!, $location: String!, $stock_item: Int!, $quantity: numeric!) {
                update_manufacture_picking_items(
                  where: {build_order_id: {_eq: $id}, part_id: {_eq: $part_id}},
                  _set: {
                    stock_item_id: $stock_item,
                    output: $output,
                    location: $location,
                    quantity: $quantity
                  }
                ) {
                  affected_rows
                }
              }`,
              variables: {
                id: item.build_order_id,
                output: product.output,
                part_id: product.part_id,
                stock_item: product.output_location,
                quantity: product.quantity,
                location: locationName, // gunakan location dari Inventree
              }
            },
            query: [],
          };
        }));

        const responseQuery = await Promise.all(
          dataQuery.map(query => configureQuery(fastify, query))
        );

        results.push({
          message: "Create event processed successfully",
          camunda: responseCamunda.data,
          database: responseQuery.data
        });
      }
    } catch (error) {
      console.error(`❌ Error executing handler for event: ${eventKey}`, error);
      throw error;
    }
  }

  return results;
},


  async onChange(data) {
    console.log("Handling onChange with data:", data);
    // Implementasi onChange
    return { message: "onChange executed", data };
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
    return await eventHandlers[eventKey](data, process);
  } catch (error) {
    console.error(`Error executing handler for event: ${eventKey}`, error);
    throw error;
  }
};

module.exports = { handle };
