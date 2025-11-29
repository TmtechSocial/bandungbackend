const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const axios = require("axios");
const GRAPHQL_API = process.env.GRAPHQL_API;
const SERVER_INVENTREE = process.env.SERVER_INVENTREE;
const INVENTREE_TOKEN = process.env.INVENTREE_API_TOKEN;

const eventHandlers = {
  async onSubmit(data, process, eventKey) {
    const results = [];
    for (const item of data) {
      try {
        let taskId;
        let instanceId = item.proc_inst_id || null;
        const inventree = axios.create({
          baseURL: `${SERVER_INVENTREE}/api`,
          headers: {
            Authorization: `Token ${INVENTREE_TOKEN}`,
            "Content-Type": "application/json",
          },
        });
        const qtyApprove = item.quantity_approve ?? 0;
        const qtyAdjust = item.quantity_adjust ?? 0;
        const stockpk = item.stock_pk_resource;

        if (qtyAdjust === qtyApprove) {
          console.log(
            `✅ Tidak ada adjustment untuk proc_inst_id: ${item.proc_inst_id}`
          );
        } else {
          const selisih = qtyAdjust - qtyApprove;
          const responseInventree = await inventree.post(`/stock/${selisih > 0 ? "add" : "remove"}/`, {
            items: [
              {
                pk: stockpk,
                quantity: Math.abs(selisih)
              }
            ],
            notes: `Adjustment Packaging Supplier | Selisih: ${selisih} | Proc Inst ID: ${item.proc_inst_id}`
          });
        }

        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {
              quantity_approve: {
                value: item.quantity_adjust,
                type: "integer",
              },
            },
          },
        };
        const responseCamunda = await camundaConfig(
          dataCamunda,
          instanceId,
          process
        );
        console.log("responseCamunda", responseCamunda);
        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          // const instanceId = responseCamunda.data.processInstanceId;
          const dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `mutation MyMutation($proc_inst_id: String!, $quantity: Int!, $task_def_key: String!, $created_at: timestamp!, $created_by: String!, $id: Int!) {
      update_mo_refill(
        where: {proc_inst_id: {_eq: $proc_inst_id}},
        _set: {
          quantity_approve: $quantity
        }
      ) {
        affected_rows
      }
        insert_mo_refill_detail(objects: {quantity: $quantity, created_at: $created_at, created_by: $created_by, task_def_key: $task_def_key, refill_id: $id}) {
    affected_rows
  }
    }`,
              variables: {
                proc_inst_id: item.proc_inst_id,
                quantity: item.quantity_adjust,
                task_def_key: "Mirorim_Operasional.Refill.Adjustment_Pack",
                created_at: item.date,
                created_by: item.name_employee,
                id: item.id,
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
  const { eventKey, data, process } = eventData;

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
