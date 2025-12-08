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

        const totalQuantity = item.quantity_not_ok + item.quantity_ok;
        console.log("totalQuantity", totalQuantity);

        const evidence = JSON.stringify(item.evidence) ||  [];

        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {
              quantity_ok: { value: item.quantity_ok, type: "Integer" },
              quantity_not_ok: { value: item.quantity_not_ok, type: "Integer" },
              total_quantity_qc: { value: totalQuantity, type: "Integer" },
              evidence_counting_repack_inbound: { value: evidence, type: "String" },
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
                  mutation UpdateMiOrder($proc_inst_id: String!, $quantity_ok: Int!, $quantity_not_ok: Int!) {
  update_mi_products(where: {proc_inst_id: {_eq: $proc_inst_id}}, _set: {quantity_ok: $quantity_ok, quantity_not_ok: $quantity_not_ok}) {
    affected_rows
  }
}

                `,
              variables: {
                proc_inst_id: item.proc_inst_id,
                quantity_ok: item.quantity_ok,
                quantity_not_ok: item.quantity_not_ok,
              },
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

