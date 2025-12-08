const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")();
const GRAPHQL_API = process.env.GRAPHQL_API;
const fetch = require("node-fetch");

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
              matched: { value: item.approve, type: "Boolean" },
              dropship: { value: true, type: "Boolean" },
              instance_id: { value: item.proc_inst_id, type: "String" },
              invoice: { value: item.invoice, type: "String" },
              courier_name: { value: item.courier_name, type: "String"}
            },
          },
        };
        const responseCamunda = await camundaConfig(dataCamunda, instanceId, process);
        console.log("responseCamunda", responseCamunda);

        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          const checkedProducts = item.products.filter(product => product.check === true);

          const dataQuery = checkedProducts.map(product => ({
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
                mutation MyMutation(
                  $proc_inst_id: String!,
                  $sku: String!,
                  $correction_notes: String!,
                  $status: String!
                ) {
                  update_mo_dropship(
                    where: {
                      proc_inst_id: { _eq: $proc_inst_id },
                      sku: { _eq: $sku }
                    },
                    _set: {
                      correction_notes: $correction_notes,
                      status: $status
                    }
                  ) {
                    affected_rows
                  }
                }
              `,
              variables: {
                proc_inst_id: instanceId,
                sku: product.sku, // konsisten nama variabel
                correction_notes: product.correction_notes,
                status: product.status
              }
            },
            query: [],
          }));

          console.log("dataQuery", dataQuery);
          const responseQuery = await Promise.all(
            dataQuery.map(query => configureQuery(fastify, query))
          );

          results.push({
            message: "Save event processed successfully",
            database: responseQuery.map(res => res.data),
          });
        }
      } catch (error) {
        console.error(`Error executing handler for event: ${data?.eventKey || "unknown"}`, error);
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
  const { eventKey, data, process } = eventData;

  if (!eventHandlers[eventKey]) {
    throw new Error(`No handler found for event: ${eventKey}`);
  }

  try {
    return await eventHandlers[eventKey](data, process);
  } catch (error) {
    console.error(`Error executing handler for event: ${eventKey}`, error);
    throw error;
  }
};

module.exports = { handle };
