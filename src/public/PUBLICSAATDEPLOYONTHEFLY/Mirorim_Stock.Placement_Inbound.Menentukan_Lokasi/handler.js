const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const GRAPHQL_API = process.env.GRAPHQL_API;

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];

    for (const item of data) {
      try {
        const instanceId = item.proc_inst_id || null;

        const hasWholesale = item.products.some(
        (group) =>
          group.type_location === "Wholesale" &&
          group.products.some((prod) => prod.quantity > 0)
      );

      const hasRetail = item.products.some(
        (group) =>
          group.type_location === "Retail" &&
          group.products.some((prod) => prod.quantity > 0)
      );

      console.log("hasWholesale", hasWholesale);
      console.log("hasRetail", hasRetail);

        // // ✅ buat payload Camunda
        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: instanceId,
          variables: {
            variables: {
              whole: { value: hasWholesale, type: "Boolean" },
              retail: { value: hasRetail, type: "Boolean" },
            },
          },
        };

        const responseCamunda = await camundaConfig(
          dataCamunda,
          instanceId,
          process
        );
        if (responseCamunda.status === 200 || responseCamunda.status === 204) {

          const responseQuery = [];
          for (const productGroup of item.products) {
  const { type_location, products } = productGroup;

  for (const product of products) {

const finalLocationId =
      product.available === true
        ? product.location_available
        : product.location_id;


    const dataQueryProduct = {
      graph: {
        method: "mutate",
        endpoint: GRAPHQL_API,
        gqlQuery: `mutation MyMutation($created_at: timestamp!, $created_by: String!, $type: String!, $location_id: Int, $quantity_inbound: Int, $id: Int!) {
  insert_mi_placement(objects: {created_at: $created_at, created_by: $created_by, updated_at: $created_at, updated_by: $created_by, type: $type, location_id: $location_id, quantity_inbound: $quantity_inbound, inbound_product_id: $id}) {
    affected_rows
  }
}`,
        variables: {
          created_at: item.created_at,
          created_by: item.created_by,
          id: item.id,
          type: type_location, // ambil dari group
          location_id: finalLocationId  === "" ? null : finalLocationId ,
          quantity_inbound: product.quantity || 0,
        },
      },
      query: [],
    };

    try {
      const resProduct = await configureQuery(fastify, dataQueryProduct);
      responseQuery.push(resProduct);

      console.log(JSON.stringify(dataQueryProduct, null, 2));
    } catch (err) {
      console.error(
        `❌ Error saat insert mi_placement (type: ${type_location}, location: ${product.location_id}):`,
        err
      );
      throw err;
    }
  }
}
          results.push({
            message: "Create event processed successfully",
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
