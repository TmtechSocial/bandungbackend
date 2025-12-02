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
  mo_retur_receive(where: {resi_retur: {_eq: $resi}}) {
    id_retur
  }
}
            `,
            variables: { resi: item.resi },
          },
          query: [],
        };

        const checkResponse = await configureQuery(fastify, checkQuery);
        const checkData = checkResponse.data[0].graph;
        const moRetur = checkData.mo_retur_receive || [];

        if (moRetur.length > 0) {
          throw new Error(`Resi ${item.resi} sudah ada di database`);
        }
        // 2. Start Camunda process
        const dataCamunda = {
          type: "start",
          endpoint: `/engine-rest/process-definition/key/Mirorim_Operasional.Trigger_Retur/start`,
          variables: {
            variables: {
              resi: { value: item.resi, type: "string" },
              courier: { value: item.courier, type: "string" },
            },
            businessKey: `${item.resi}:${item.courier}:${item.retur_date}`,
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
          $courier: String!, 
          $courier_name: String!, 
          $task_def_key: String!, 
          $resi_retur: String!, 
          $created_by: String!, 
          $retur_date: timestamp!,
          $evidence: [mo_retur_evidence_insert_input!]!
        ) { 
          insert_mo_retur_receive(
            objects: {
              parent_inst_id: $proc_inst_id, 
              courier: $courier, 
              courier_name: $courier_name, 
              task_def_key: $task_def_key, 
              resi_retur: $resi_retur, 
              retur_date: $retur_date,
              created_by: $created_by
            }
          ) {
            affected_rows 
          }

          insert_mo_retur_evidence(objects: $evidence) {
            affected_rows
          }
        }
      `,
              variables: {
                proc_inst_id: instanceId,
                courier: item.courier,
                courier_name: item.courier_name,
                task_def_key:
                  "Mirorim_Operasional.Trigger_Retur.Match_Invoice_MP",
                resi_retur: item.resi,
                retur_date: item.retur_date,
                created_by: item.name_employee,
                evidence: (item.evidence || []).map((file) => ({
                  proc_inst_id: instanceId,
                  task_def_key: "Mirorim_Operasional.Trigger_Retur",
                  file_name: file,
                })),
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
