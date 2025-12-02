const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")();
const axios = require("axios");
const GRAPHQL_API = process.env.GRAPHQL_API;
const BIGCAPITAL_API = process.env.BIGCAPITAL_API;
const BIGCAPITAL_TOKEN = process.env.BIGCAPITAL_TOKEN;
const BIGCAPITAL_ORGANIZATION_ID = process.env.BIGCAPITAL_ORGANIZATION_ID;

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];

    for (const item of data) {
      try {
        const instanceId = item.proc_inst_id || null;

        let status = null;
        let status_invoice = null;
        if (item.banding == "cukup") {
          status = item.hasil_banding_cukup;
          status_invoice = "Banding Selesai";
        } else {
          status = "Banding Ulang";
          status_invoice = "Banding Ulang";
        }
        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: instanceId,
          variables: {
            variables: {
              banding: { value: item.banding, type: "string" },
              hasil_banding_cukup: {
                value: item.hasil_banding_cukup,
                type: "string",
              },
              input_dana : {
                value: item.input_dana || 0,
                type: "integer",
              },
              date_timer: { value: item.date_timer, type: "String" },
            },
          },
        };
        const responseCamunda = await camundaConfig(
          dataCamunda,
          instanceId,
          process
        );
        console.log("✅ responseCamunda:", responseCamunda.status);
        if ([200, 204].includes(responseCamunda.status)) {
          const dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
      mutation insertLogs(
        $invoice: String!,
        $task_def_key: String!,
        $notes: String!,
        $created_at: timestamp!,
        $created_by: String!,
        $proc_def_key: String!,
        $status_invoice: String!,
        $status: String!,
        $proc_inst_id: String!
      ) {
        insert_mo_order_logs(objects: {
          invoice: $invoice,
          task_def_key: $task_def_key,
          notes: $notes,
          created_at: $created_at,
          created_by: $created_by,
          proc_def_key: $proc_def_key,
          status: $status
        }) {
          affected_rows
        }
        update_mo_order_closing(
          where: {proc_inst_id: {_eq: $proc_inst_id}},
          _set: {status_invoice: $status_invoice}
        ) {
          affected_rows
        }
      }
    `,
              variables: {
                invoice: String(item.invoice),
                task_def_key: "Mirorim_Operasional.Finish_Order.Hasil_Banding",
                notes: item.notes_input || "",
                created_at: item.created_at,
                created_by: item.created_by,
                proc_def_key: "Mirorim_Operasional.Finish_Order",
                status,
                status_invoice,
                proc_inst_id: item.proc_inst_id,
              },
            },
          };
          console.log(
            "📦 dataQuery dikirim ke configureQuery:",
            JSON.stringify(dataQuery, null, 2)
          );
          const responseQuery = await configureQuery(fastify, dataQuery);
          console.log(
            "🧾 responseQuery:",
            JSON.stringify(responseQuery, null, 2)
          );
          results.push({
            message: "Create event processed successfully",
            camunda: responseCamunda.data,
            database: responseQuery.data,
          });
        }
      } catch (error) {
        console.error(`❌ Error executing onSubmit handler`, error);
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
    console.error(`❌ Error executing handler for event: ${eventKey}`, error);
    throw error;
  }
};

module.exports = { handle };
