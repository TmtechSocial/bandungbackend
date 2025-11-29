const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const dotenv = require("dotenv");
const axios = require("axios");
const GRAPHQL_API = process.env.GRAPHQL_API;

dotenv.config();
const eventHandlers = {
  async onSubmit(data) {
    const results = [];
    for (const item of data) {
      try {
        let taskId;
        let instanceId = item.proc_inst_id || null;

        console.log("📦 Id Refrence:", item.build_order);

        const getPartPk = async (item) => {
          try {
            const baseURL = process.env.SERVER_INVENTREE;
            const token = process.env.INVENTREE_API_TOKEN;

            const axiosInstance = axios.create({
              baseURL,
              headers: {
                Authorization: `Token ${token}`,
              },
            });

            const responseSku = await axiosInstance.get(
              `/api/build/?reference=${encodeURIComponent(item.build_order)}`
            );

            const skuResults = responseSku.data.results;

            if (!skuResults || skuResults.length === 0) {
              console.error("❌ Lokasi PK tidak ditemukan dari Refrence");
              return null;
            }

            const partPk = skuResults[0].part; // ini yang kamu mau
            const partName = skuResults[0].part_name; // ini juga

            console.log("✅ Part PK:", partPk);
            console.log("✅ Part Name:", partName);

            return { partPk, partName };
          } catch (error) {
            console.error("❌ Error mengambil part PK dan name:", error);
            return null;
          }
        };

        const { partPk, partName } = await getPartPk(item);

        const dataCamunda = {
          type: "start",
          endpoint: `/engine-rest/process-definition/key/Mirorim_Manufacture.Worker_Produksi/start`,
          variables: {
            variables: {
              worker: { value: item.worker, type: "string" },
            },
            businessKey: `${item.build_order}:${partName}:${item.date}`,
          },
        };

        const responseCamunda = await camundaConfig(dataCamunda, instanceId);
        console.log("responseCamunda", responseCamunda);
        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          const instanceId = responseCamunda.data.processInstanceId;
          console.log("item", item);

          const dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `mutation insertTaskWorker(
              $proc_inst_id: String!,
              $task_def_key: String!,
              $proc_def_key: String!,
              $user: String!,
              $part_pk: String!,
              $reference: String!,
              $date: timestamp!,
              $requestor: String!,
              $quantity_request: Int!
            ) {
              insert_task_worker(objects: {
                proc_inst_id: $proc_inst_id,
                task_def_key: $task_def_key,
                proc_def_key: $proc_def_key,
                user: $user,
                part_pk: $part_pk,
                reference: $reference,
                created_at: $date,
                requestor: $requestor,
                quantity_request: $quantity_request
              }) {
                affected_rows
              }
            }
            `,
              variables: {
                proc_inst_id: instanceId,
                task_def_key:
                  "Mirorim_Manufacture.Worker_Produksi.Processing_Product",
                proc_def_key: "Mirorim_Manufacture.Worker_Produksi",
                user: item.worker.toString(),
                part_pk: partPk.toString(),
                reference: item.build_order,
                date: item.date,
                requestor: item.created_by,
                quantity_request: item.quantity_request,
              },
            },
            query: [],
          };

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
