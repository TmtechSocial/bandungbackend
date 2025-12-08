const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const GRAPHQL_API = process.env.GRAPHQL_API;
const SERVER_INVENTREE = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;
const axios = require("axios");

const eventHandlers = {
  async onSubmit(data, process, eventKey) {
    const results = [];

    for (const item of data) {
      try {
        const instanceId = item.parent_inst_id || null;
        let dataQuery;

        for (const product of item.products) {
        const inventree = axios.create({
                  baseURL: `${SERVER_INVENTREE}/api`,
                  headers: {
                    Authorization: `Token ${INVENTREE_API_TOKEN}`,
                    "Content-Type": "application/json",
                  },
                  timeout: 10000,
                });
        
                const PatchPayload = {
                  name: product.product_name,
                };
        
                const { data: nameData } = await inventree.patch(
                  `/part/${product.part_pk}/`,
                  PatchPayload
                );
              }
        
        // const dataCamunda = {
        //   type: "complete",
        //   endpoint: `/engine-rest/task/{taskId}/complete`,
        //   instance: item.parent_inst_id,
        //   variables: {
        //     variables: {
        //     },
        //   },
        // };

        // const responseCamunda = await camundaConfig(
        //   dataCamunda,
        //   instanceId,
        //   process
        // );
        // if (responseCamunda.status === 200 || responseCamunda.status === 204) {
        if (item) {

          if (item.status == "Ya, Follow Up Supplier") {
          dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
                  mutation MyMutation($evidence: [mi_followup_insert_input!]!) {
  insert_mi_followup(objects: $evidence) {
    affected_rows
  }
}
                `,
              variables: {
                evidence: (item.evidence || []).map((file) => ({
                created_at: item.created_at,
                created_by: item.created_by,
                invoice: item.invoice,
                notes: item.notes || null,
                status: item.status,
                evidence_followup: file || null,
              })),
              },
            },
            query: [],
          };
          } else {
            dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
                  mutation MyMutation($parent_inst_id: String!, $invoice: String!, $notes: String, $created_by: String!, $created_at: timestamp!, $status: String!, $status_order: String!) {
  insert_mi_followup(objects: {invoice: $invoice, notes: $notes, created_by: $created_by, created_at: $created_at, status: $status}) {
    affected_rows
  }
  update_mi_order(where: {parent_inst_id: {_eq: $parent_inst_id}}, _set: {status: $status_order})
}
                `,
              variables: {
                created_at: item.created_at,
                created_by: item.created_by,
                invoice: item.invoice,
                notes: item.notes || null,
                status: item.status,
                status_order: item.status === "Ya, Follow Up Supplier" ? "Done Follow Up Supplier" : "Done",
                parent_inst_id: item.parent_inst_id,
              },
            },
            query: [],
          };
          }

          console.log("dataQuery", JSON.stringify(dataQuery, null, 2));

          const responseQuery = await configureQuery(fastify, dataQuery);

          console.log("responseQuery", responseQuery);

          results.push({
            message: "Create event processed successfully",
            // camunda: responseCamunda.data,
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
