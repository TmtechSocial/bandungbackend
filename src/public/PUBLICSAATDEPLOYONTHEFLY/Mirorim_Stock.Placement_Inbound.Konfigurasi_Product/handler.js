const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const GRAPHQL_API = process.env.GRAPHQL_API;

const eventHandlers = {
  async onSubmit(data, process, eventKey) {
    const results = [];

    for (const item of data) {
      try {
      const instanceId = item.proc_inst_id || null;
      console.log("item", item);

      const weight_per_unit = item.weight_per_unit || null;
      const pack_gudang = parseInt(item.pack_gudang || null);
      const pack_supplier = parseInt(item.pack_supplier || null);
      const merge_decision_inbound = item.merged_stock?.[0]?.apakahDisatukan || null;

      // ambil data konversi
      const konversi = item.konversiQuantity?.[0] || null;
      const unit = konversi
        ? (konversi.adaKonversi ? konversi.konversiSesudah : konversi.unit)
        : null;

        console.log({
          weight_per_unit,
          pack_gudang,
          pack_supplier,
          merge_decision_inbound,
          unit,
        });
       const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {
              weight_per_unit: {
                value: JSON.stringify(weight_per_unit), // ⬅️ stringify array
                type: "Object",
                valueInfo: {
                  objectTypeName: "java.util.ArrayList",
                  serializationDataFormat: "application/json",
                },
              },
              pack_gudang: { value: pack_gudang, type: "Integer" },
              pack_supplier: { value: pack_supplier, type: "Integer" },
              merge_decision_inbound: { value: merge_decision_inbound, type: "String" },
              unit_konversi: { value: unit, type: "String"}
            },
          },
        };

        const responseCamunda = await camundaConfig(
          dataCamunda,
          instanceId,
          process
        );

        if (responseCamunda.status === 200 || responseCamunda.status === 204) {

          const dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
                  mutation MyMutation($proc_inst_id: String!, $unit: String!, $quantity_konversi: Int!) {
  update_mi_products(where: {proc_inst_id: {_eq: $proc_inst_id}}, _set: {unit_konversi: $unit, quantity_konversi: $quantity_konversi}) {
    affected_rows
  }
}
                `,
                variables: {
                  proc_inst_id: item.proc_inst_id,
                  unit: unit,
                  quantity_konversi: item.quantityHasilKonversi
                }
            },
            query: [],
          };

          console.log("dataQuery", dataQuery);

          const responseQuery = await configureQuery(fastify, dataQuery);

          console.log("responseQuery", responseQuery);

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
