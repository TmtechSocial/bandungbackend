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
        const instanceId = item.proc_inst_id || null;

        const inventree = axios.create({
          baseURL: `${SERVER_INVENTREE}/api`,
          headers: {
            Authorization: `Token ${INVENTREE_API_TOKEN}`,
          },
          timeout: 5000,
        });

        const upsertParameter = async (part_pk, template, value) => {
          const exist = await inventree.get(
            `/part/parameter/?part=${part_pk}&template=${template}`
          );

          if (exist.data?.results?.length > 0) {
            const paramId = exist.data.results[0].pk;
            await inventree.patch(`/part/parameter/${paramId}/`, {
              data: value,
            });
          } else {
            await inventree.post("/part/parameter/", {
              part: part_pk,
              template,
              data: value,
            });
          }
        };

        // ambil part_pk yang set_pcs = true
        const pcsPartPks = item.products
          .filter((p) => p.set_pcs === true)
          .map((p) => p.part_pk);

        for (const part_pk of pcsPartPks) {
          await upsertParameter(part_pk, 13, "True");
        }
        // ambil part_pk yang quantity tidak sama
        const partIds = item.products
          .filter((p) => p.out_of_tolerance === true)
          .map((p) => p.part_pk);

        const update_konfigurasi = item.update_konfigurasi === true;

        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: instanceId,
          variables: {
            variables: {
              update_konfigurasi: {
                value: update_konfigurasi,
                type: "Boolean",
              },
              part_ids: {
                value: JSON.stringify(partIds),
                type: "Object",
                valueInfo: {
                  objectTypeName: "java.util.ArrayList",
                  serializationDataFormat: "application/json",
                },
              },
              wasit_json: {
                value: JSON.stringify(item.products),
                type: "Object",
                valueInfo: {
                  objectTypeName: "java.util.ArrayList",
                  serializationDataFormat: "application/json",
                },
              },
            },
          },
        };

        const responseCamunda = await camundaConfig(
          dataCamunda,
          instanceId,
          process
        );

        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          const productsToUpdate = item.products.filter(
            (p) => p.prepare || p.picker || p.checker
          );

          const dataQuery = productsToUpdate.map((product) => ({
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
                mutation UpdateWasit($proc_inst_id: String!, $sku_toko: String!, $wasit: String!) {
                  update_mo_order_shop(
                    where: {
                      proc_inst_id: {_eq: $proc_inst_id},
                      sku_toko: {_eq: $sku_toko}
                    },
                    _set: { wasit: $wasit }
                  ) {
                    affected_rows
                  }
                }
              `,
              variables: {
                proc_inst_id: instanceId,
                sku_toko: product.sku_toko,
                wasit: product.wasit === "" || product.wasit === null ? null : product.wasit
              },
            },
            query: [],
          }));

          dataQuery.push({
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
                mutation UpdateTask($proc_inst_id: String!, $task: String!) {
                  update_mo_order(
                    where: {proc_inst_id: {_eq: $proc_inst_id}},
                    _set: {task_def_key: $task}
                  ) {
                    affected_rows
                  }
                }
              `,
              variables: {
                proc_inst_id: instanceId,
                task: "Mirorim_Operasional.Order.Checking",
              },
            },
            query: [],
          });

          await Promise.all(dataQuery.map((q) => configureQuery(fastify, q)));

          results.push({ message: "Create event processed successfully" });
        }
      } catch (error) {
        console.error(`Error executing handler for event: ${eventKey}`, error);
        throw error;
      }
    }

    return results;
  },

  async onChange(data) {
    return { message: "onChange executed", data };
  },
};

const handle = async (eventData) => {
  const { eventKey, data, process } = eventData;

  if (!eventHandlers[eventKey]) {
    throw new Error(`No handler found for event: ${eventKey}`);
  }

  return await eventHandlers[eventKey](data, process, eventKey);
};

module.exports = { handle };
