const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const GRAPHQL_API = process.env.GRAPHQL_API;
const CAMUNDA_API = process.env.CAMUNDA_API;
const axios = require("axios");

const eventHandlers = {
  async onSubmit(data, process, eventKey) {
    const results = [];

    for (const item of data) {
      try {
        const instanceId = item.parent_inst_id || null;
        const camundaResponse = await axios.get(
          `${CAMUNDA_API}engine-rest/process-instance/${item.parent_inst_id}`
        );

        const businessKey = camundaResponse.data?.businessKey || null;
        console.log("businessKey >>>", businessKey);
        const type_supplier = businessKey ? businessKey.split(":")[0] : null;
        console.log("type_supplier >>>", type_supplier);

        let new_date;
        if(type_supplier === "Import"){
          new_date = "PT10080M";
        } else {
          new_date = "PT2880M";
        }

        console.log("new_date >>>", new_date);
        
        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.parent_inst_id,
          variables: {
            variables: {
              date: { value: new_date, type: "String" },
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
                  mutation MyMutation($invoice: String!, $notes: String, $created_by: String!, $created_at: timestamp!, $status: String!) {
  insert_mi_followup(objects: {invoice: $invoice, notes: $notes, created_by: $created_by, created_at: $created_at, status: $status}) {
    affected_rows
  }
}
                `,
              variables: {
                created_at: item.created_at,
                created_by: item.created_by,
                invoice: item.invoice,
                notes: item.notes || null,
                status: item.status,
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
