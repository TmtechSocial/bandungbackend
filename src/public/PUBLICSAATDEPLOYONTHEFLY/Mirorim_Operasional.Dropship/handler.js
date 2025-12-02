const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const GRAPHQL_API = process.env.GRAPHQL_API;

const eventHandlers = {
  async onSubmit(data) {
    const results = [];
    for (const item of data) {
      try {
        let taskId;
        let instanceId = item.proc_inst_id || null;

        const dataCamunda = {
          type: "start",
          endpoint: `/engine-rest/process-definition/key/Mirorim_Operasional.Dropship/start`,
          // instance: item.proc_inst_id, // jika menggunakan complete maka dibutuhkan instance
          variables: {
            variables: {
              group: { value: item.group, type: "string" }
            },
            businessKey: `${item.kurir}:${item.invoice}:${item.date}`,
          },
        };

        const responseCamunda = await camundaConfig(dataCamunda, instanceId);
        console.log("responseCamunda", responseCamunda);
        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          const instanceId = responseCamunda.data.processInstanceId;

          const dataQuery = item.products.map(product => ({
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
                mutation MyMutation(
                  $proc_inst_id: String!,
                  $sku: String!,
                  $quantity: Int!,
                  $courier_name: String!,
                  $invoice: String!,
                  $resi: String!,
                  $date: timestamp!,
                  $requester: String!
                ) {
                  insert_mo_dropship(objects: {
                    proc_inst_id: $proc_inst_id,
                    invoice: $invoice,
                    resi: $resi,
                    sku: $sku,
                    quantity: $quantity,
                    courier_name: $courier_name,
                    created_at: $date,
                    requester: $requester
                  }) {
                    affected_rows
                  }
                }
              `,
              variables: {
                proc_inst_id: instanceId,
                invoice: item.invoice,
                resi: item.resi,
                sku: product.sku,
                quantity: product.quantity,
                courier_name: item.kurir,
                date: item.date,
                requester: item.name_employee
              }
            },
            query: [],
          }));

          console.log("dataQuery", dataQuery);

          // Jalankan semua query secara paralel
          const responseQuery = await Promise.all(
            dataQuery.map(query => configureQuery(fastify, query))
          );

          results.push({
            message: "Save event processed successfully",
            database: responseQuery.map(res => res.data),
          });

        }
      } catch (error) {
        console.error(`Error executing handler for event: ${eventKey}`, error);
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
  const { eventKey, data } = eventData;
  console.log("eventData", eventData);

  if (!eventHandlers[eventKey]) {
    throw new Error(`No handler found for event: ${eventKey}`);
  }

  // Panggil handler yang sesuai berdasarkan event
  try {
    return await eventHandlers[eventKey](data);
  } catch (error) {
    console.error(`Error executing handler for event: ${eventKey}`, error);
    throw error;
  }
};

module.exports = { handle };

