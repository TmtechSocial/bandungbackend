const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const GRAPHQL_API = process.env.GRAPHQL_API;

const eventHandlers = {
  async onSubmit(data) {
    const results = [];

    for (const item of data) {
      try {
        let instanceId = item.proc_inst_id || null;
        const businessKey2 =
          item.courier_name === "instant" ? item.invoice : item.submission_date;

        // ✅ Jika courier_name = "instant", cek dulu apakah invoice sudah ada
        if (item.courier_name === "instant") {
          const checkQuery = {
            graph: {
              method: "query",
              endpoint: GRAPHQL_API,
              gqlQuery: `
                query checkInvoice($invoice: String!) {
                  mo_order_print(where: {invoice: {_eq: $invoice}}) {
                    invoice
                  }
                }
              `,
              variables: {
                invoice: item.invoice,
              },
            },
            query: [],
          };

          const checkResult = await configureQuery(fastify, checkQuery);
          const existingData = checkResult?.data?.[0].graph?.mo_order_print || [];

          if (existingData.length > 0) {
            throw new Error(
              `Invoice ${item.invoice} sudah pernah diproses, silakan cek kembali.`
            );
          }
        }

        // ✅ Jika lolos pengecekan, lanjut start Camunda
        const dataCamunda = {
          type: "start",
          endpoint: `/engine-rest/process-definition/key/Mirorim_Operasional.Print/start`,
          variables: {
            variables: {
              initiator: { value: item.id_employee, type: "string" },
              initiator_name: { value: item.name_employee, type: "string" },
              courier_name: { value: item.courier_name, type: "string" },
              invoice: { value: item.invoice || "", type: "string" },
            },
            businessKey: `${item.courier_name}:${businessKey2}:${item.name_employee}`,
          },
        };

        const responseCamunda = await camundaConfig(dataCamunda, instanceId);
        console.log("responseCamunda", responseCamunda);

        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          const instanceId = responseCamunda.data.processInstanceId;
          let responseQuery = null;

          // ✅ Insert ke mo_order_print jika instant
          if (item.courier_name === "instant") {
            const dataQuery = {
              graph: {
                method: "mutate",
                endpoint: GRAPHQL_API,
                gqlQuery: `
                  mutation insertPrint(
                    $proc_inst_id: String!,
                    $invoice: String!,
                    $courier_name: String!
                  ) {
                    insert_mo_order_print(objects: {
                      proc_inst_id: $proc_inst_id,
                      invoice: $invoice,
                      courier_name: $courier_name
                    }) {
                      affected_rows
                    }
                  }
                `,
                variables: {
                  proc_inst_id: instanceId,
                  invoice: item.invoice,
                  courier_name: item.courier_name,
                },
              },
              query: [],
            };

            responseQuery = await configureQuery(fastify, dataQuery);
            console.log("responseQuery", responseQuery);
          }

          results.push({
            message: "Create event processed successfully",
            camunda: responseCamunda.data,
            database: responseQuery ? responseQuery.data : null,
          });
        }
      } catch (error) {
        console.error(`Error executing handler for onSubmit`, error);
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
  const { eventKey, data } = eventData;
  console.log("eventData", eventData);

  if (!eventHandlers[eventKey]) {
    throw new Error(`No handler found for event: ${eventKey}`);
  }

  try {
    return await eventHandlers[eventKey](data);
  } catch (error) {
    console.error(`Error executing handler for event: ${eventKey}`, error);
    throw error;
  }
};

module.exports = { handle };
