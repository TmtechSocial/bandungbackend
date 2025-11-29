const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")();
const dotenv = require("dotenv");
const axios = require("axios");

dotenv.config();
const GRAPHQL_API = process.env.GRAPHQL_API;

const eventHandlers = {
  async onSubmit(data, eventKey) {
    const results = [];

    for (const item of data) {
      try {
        const instanceId = item.proc_inst_id || null;

        const dataCamunda = {
          type: "start",
          endpoint: `/engine-rest/process-definition/key/Mirorim_Stock.Trigger_Inbound/start`,
          variables: {
            variables: {
              invoice_supplier: { value: item.invoice, type: "String" },
            },
            businessKey: `${item.invoice}:${item.created_at}:${item.created_by}`,
          },
        };

        const responseCamunda = await camundaConfig(dataCamunda, instanceId);
        console.log(
          "✅ Camunda response",
          responseCamunda?.data || responseCamunda
        );

        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          const instanceId = responseCamunda.data.processInstanceId;

          const dataQueryOrder = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
                mutation UpdateMPOrder($invoice: String!, $status: String!) {
  update_mi_order(where: {invoice: {_eq: $invoice}}, _set: {status: $status}) {
    affected_rows
  }
}
              `,
              variables: {
                invoice: item.invoice,
                status: "On Progress",
              },
            },
            query: [],
          };

          const responseQuery = [];

          try {
            const resOrder = await configureQuery(fastify, dataQueryOrder);
            responseQuery.push(resOrder);
          } catch (err) {
            console.error("❌ Error saat Update mp_order:", err);
            throw err;
          }

          for (const product of item.products) {
            const dataQueryProduct = {
              graph: {
                method: "mutate",
                endpoint: GRAPHQL_API,
                gqlQuery: `
                  mutation MyMutation($created_at: timestamp!, $created_by: String!, $invoice: String!, $part: Int, $quantity: Int!, $task_def_key: String!) {
  insert_mi_logs(objects: {created_at: $created_at, created_by: $created_by, invoice: $invoice, part_pk: $part, quantity: $quantity, task_def_key: $task_def_key}) {
    affected_rows
  }
    update_mi_products( where: {part_pk: {_eq: $part}, invoice: {_eq: $invoice}}, _set: {quantity_received: $quantity}) {
    affected_rows
  }
}
                `,
                variables: {
                  created_at: item.created_at,
                  created_by: item.created_by,
                  task_def_key: "Mirorim_Stock.Trigger_Inbound",
                  invoice: item.invoice,
                  part: product.part_pk || null,
                  quantity: product.quantity_received,
                },
              },
              query: [],
            };

            try {
              const resProduct = await configureQuery(
                fastify,
                dataQueryProduct
              );
              responseQuery.push(resProduct);

              console.log(JSON.stringify(dataQueryProduct, null, 2));
            } catch (err) {
              console.error(
                `❌ Error saat insert mp_products (SKU: ${p.sku}):`,
                err
              );
              throw err;
            }
          }
          results.push({
            message: "✅ Create event processed successfully",
            camunda: responseCamunda.data,
            database: responseQuery,
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

/**
 * ⛓️ Handler utama
 */
const handle = async (eventData) => {
  const { eventKey, data } = eventData;
  console.log("📥 Received eventData", eventData);

  if (!eventHandlers[eventKey]) {
    throw new Error(`❌ No handler found for event: ${eventKey}`);
  }

  try {
    return await eventHandlers[eventKey](data, eventKey);
  } catch (error) {
    console.error(`❌ Error executing handler for event: ${eventKey}`, error);
    throw error;
  }
};

module.exports = { handle };
