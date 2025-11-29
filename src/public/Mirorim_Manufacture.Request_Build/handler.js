const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const axios = require("axios"); // pastikan axios di-import
const GRAPHQL_API = process.env.GRAPHQL_API;
const SERVER_INVENTREE = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;

const eventHandlers = {
  async onSubmit(data) {
    const results = [];

    for (const item of data) {
      try {
        const { part_id, quantity, created_at } = item;

        // ✅ Membuat reference build order baru
        const inventree = axios.create({
          baseURL: `${SERVER_INVENTREE}/api`,
          headers: {
            Authorization: `Token ${INVENTREE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          timeout: 10000,
        });

        // ✅ Ambil part_name dari InvenTree (full_name)
    let part_name = "UnknownPart";
    try {
      const partResponse = await inventree.get(`/part/${part_id}/`);
      part_name = partResponse.data?.full_name || "UnknownPart";
    } catch (partErr) {
      console.warn(`⚠️ Gagal ambil part_name untuk part_id ${part_id}`);
    }

        // Ambil reference terakhir
        const { data: buildList } = await inventree.get(
          "/build/?limit=1&ordering=-pk"
        );
        const lastRef = buildList?.results?.[0]?.reference || "BO-0000";
        let lastNumber = parseInt(lastRef.split("-")[1] || "0", 10);

        lastNumber += 1;
        const reference = `BO-${lastNumber.toString().padStart(4, "0")}`;

        // ✅ Jalankan Camunda instance
        const dataCamunda = {
          type: "start",
          endpoint: `/engine-rest/process-definition/key/Mirorim_Manufacture.Request_Build/start`,
          variables: {
            variables: {
              reference: { value: reference, type: "string" },
            },
            businessKey: `${reference}:${part_name}:Manual`,
          },
        };

        const responseCamunda = await camundaConfig(dataCamunda);
        console.log("responseCamunda", responseCamunda);

        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          // ✅ Buat Build Order di InvenTree
          try {
            const buildRes = await inventree.post("/build/", {
              part: part_id,
              quantity: quantity,
              reference: reference,
              title: "Produksi",
            });

            console.log(
              `✅ Build Order dibuat: Part ${part_id}, ID: ${buildRes.data.pk}`
            );
          } catch (buildError) {
            console.error(
              `❌ Gagal buat build order untuk part_id: ${part_id}`
            );
            if (buildError.response?.data) {
              console.log(
                "🧾 Detail:",
                JSON.stringify(buildError.response.data, null, 2)
              );
            }
            throw buildError;
          }

          // ✅ Masukkan data ke database via GraphQL
          const instanceId = responseCamunda.data.processInstanceId;
          const dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `mutation insertManufactureRequest(
  $parent_inst_id: String!,
  $part_pk: Int!,
  $reference: String!,
  $date: timestamp!,
  $status: String!
) {
  insert_manufacture_request(objects: {
    parent_inst_id: $parent_inst_id,
    part_id: $part_pk,
    reference: $reference,
    created_at: $date,
    status: $status
  }) {
    affected_rows
  }
}
`,
              variables: {
                parent_inst_id: instanceId,
                part_pk: part_id,
                reference: reference,
                date: created_at,
                status: "waiting scheduling",
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
        console.error(`Error executing handler for event: onSubmit`, error);
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
