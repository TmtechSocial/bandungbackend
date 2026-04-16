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
        // 1. Cek apakah resi sudah ada di mo_retur_receive atau resi_retur
        const checkQuery = {
          graph: {
            method: "query",
            endpoint: GRAPHQL_API,
            gqlQuery: `
              query CheckResi($resi: String!) {
  asesmen_360(where: {id_karyawan: {_eq: $resi}}) {
    id_karyawan
  }
}
            `,
            variables: { resi: item.id_asesor },
          },
          query: [],
        };

        const checkResponse = await configureQuery(fastify, checkQuery);
        const checkData = checkResponse.data[0].graph;
        const moRetur = checkData.asesmen_360 || [];

        if (moRetur.length > 0) {
          throw new Error(`${item.id_asesor} sudah ada di database`);
        }
        // 2. Start Camunda process
        const dataCamunda = {
          type: "start",
          endpoint: `/engine-rest/process-definition/key/HR_Management.Asesmen_360/start`,
          variables: {
            variables: {
              id_asesor: { value: item.id_asesor, type: "string" },
            },
            businessKey: `${item.id_asesor}:${item.name_employee}:${item.date}`,
          },
        };

        const responseCamunda = await camundaConfig(dataCamunda, instanceId);
        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          const instanceId = responseCamunda.data.processInstanceId;

          // Insert retur_receive + retur_evidence dalam satu mutation
          const dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
        mutation InsertReturReceiveAndEvidence(
          $proc_inst_id: String!, 
          $id_karyawan: String!, 
        ) { 
          insert_asesmen_360(
            objects: {
              proc_inst_id: $proc_inst_id, 
              id_karyawan: $id_karyawan
            }
          ) {
            affected_rows 
          }
        }
      `,
              variables: {
                proc_inst_id: instanceId,
                id_karyawan: item.id_asesor,
              },
            },
            query: [],
          };

          const responseQuery = await configureQuery(fastify, dataQuery);
          const resultData = responseQuery?.data?.data;
          console.log(
            "[RETUR] RAW responseQuery:",
            JSON.stringify(responseQuery, null, 2)
          );

          const gqlErrors =
            responseQuery?.errors || responseQuery?.data?.errors;
          if (gqlErrors) {
            console.error(
              "[RETUR] GraphQL Errors:",
              JSON.stringify(gqlErrors, null, 2)
            );
          }

          results.push({
            message: "Create event processed successfully",
            camunda: responseCamunda.data,
            database: responseQuery.data,
          });
        }
      } catch (error) {
        console.error("Error executing handler onSubmit:", error.message);
        throw error;
      }
    }

    return results;
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
