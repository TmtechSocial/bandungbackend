const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")();
const GRAPHQL_API = process.env.GRAPHQL_API;
const fetch = require("node-fetch");
const axios = require("axios");
const { unclaimTask } = require("../../utils/camunda/camundaClaim");

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];

    for (const item of data) {
      try {
        let instanceId = item.proc_inst_id || null;

        if (item.action === "save") {
          const checkedProducts = item.products.filter(product => product.check === true);

          const dataQuery = checkedProducts.map(product => ({
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
                mutation MyMutation($build_order_id: Int!, $sku_toko: String!, $is_flagged: Boolean!, $status_picked: String!, $date: timestamp!, $user_picker: String!) {update_manufacture_picking_items(where: {build_order_id: {_eq: $build_order_id}, location: {_eq: $sku_toko}}, _set: {picked_status: $status_picked, uuid_picker: $user_picker, picked_at: $date, is_flagged: $is_flagged}) {affected_rows}}`,
              variables: {
                build_order_id: item.build_order_id,
                sku_toko: product.location,
                is_flagged: product.flag,
                status_picked: "picked",
                date: item.picked_at,
                user_picker: item.user_picker
              }
            },
            query: [],
          }));

          const responseQuery = await Promise.all(
            dataQuery.map(query => configureQuery(fastify, query))
          );

          results.push({
            message: "Save event processed successfully",
            database: responseQuery.map(res => res.data),
          });
          
          try {
            if (instanceId && item.user_picker_id) {
              // Ambil task definition key dari Camunda berdasarkan instanceId
              const camundaUrl = "https://mirorim.ddns.net:6789/api/engine-rest/";
              const resTask = await axios.get(`${camundaUrl}task?processInstanceId=${instanceId}`);
              if (resTask.status === 200 && Array.isArray(resTask.data) && resTask.data.length > 0) {
                const taskDefinitionKey = resTask.data[0].taskDefinitionKey;
                await unclaimTask({
                  body: {
                    instance: instanceId,
                    taskDefinitionKey,
                    userId: item.user_picker_id
                  }
                }, { send: () => {} });
              }
              console.warn("berhasil unclaim task ✅")
            }
          } catch (e) {
            console.warn("Gagal unclaim task setelah save:", e.message);
          }

        } else {
          const flag = item.products.map(product => product.flag);

          // Kirim ke Camunda
          const dataCamunda = {
            type: "complete",
            endpoint: `/engine-rest/task/{taskId}/complete`,
            instance: item.proc_inst_id,
            variables: {
              variables: {
                flag_habis_gudang: { value: flag, type: "String" }
              },
            },
          };

          const responseCamunda = await camundaConfig(dataCamunda, instanceId, process);

          if (responseCamunda.status === 200 || responseCamunda.status === 204) {
            const checkedProducts = item.products.filter(product => product.check === true);

            const dataQuery = checkedProducts.map(product => ({
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
                mutation MyMutation($build_order_id: Int!, $sku_toko: String!, $is_flagged: Boolean!, $status_picked: String!, $date: timestamp!, $user_picker: String!) {update_manufacture_picking_items(where: {build_order_id: {_eq: $build_order_id}, location: {_eq: $sku_toko}}, _set: {picked_status: $status_picked, uuid_picker: $user_picker, picked_at: $date, is_flagged: $is_flagged}) {affected_rows}}`,
              variables: {
                build_order_id: item.build_order_id,
                sku_toko: product.location,
                is_flagged: product.flag,
                status_picked: "picked",
                date: item.picked_at,
                user_picker: item.user_picker
              }
            },
            query: [],
          }));

            const responseQuery = await Promise.all(
              dataQuery.map(query => configureQuery(fastify, query))
            );

            results.push({
              message: "Complete event processed successfully",
              camunda: responseCamunda.data,
              database: responseQuery.map(res => res.data),
            });
          }
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