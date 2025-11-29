const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const axios = require("axios");
const GRAPHQL_API = process.env.GRAPHQL_API;
const LDAP_API_MANAGE = process.env.LDAP_API_MANAGE;

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];
    console.log("1. Handling onSubmit with data:", data);
    for (const {
      proc_inst_id,
      clock_in,
      valid_location,
      id_karyawan,
    } of data) {
      console.log("!!!!", data);
      try {
        const lokasi = valid_location ? "wfo" : "wfh";

        console.log("true apa falase", lokasi);

        // POST ke LDAP API untuk clockin
        let ldapResult = null;
        try {
          const ldapResponse = await axios.post(
            `${LDAP_API_MANAGE}/attendance/clockin`,
            { uid: id_karyawan },
            {
              headers: {
                "Content-Type": "application/json",
              },
            }
          );
          console.log("ldappppp", ldapResponse);

          ldapResult = ldapResponse;
          console.log("LDAP ClockIn Response:", ldapResult.data);
        } catch (ldapError) {
          console.error("Error calling LDAP API:", ldapError.message);
          ldapResult = { success: false, error: ldapError.message };
        }

        const dataQuery = {
          graph: {
            method: "mutate",
            endpoint: GRAPHQL_API,
            gqlQuery: `
              mutation updateClockIn($proc_inst_id: String!, $clock_in: String!, $lokasi: String!) {
            update_absen(
              where: { proc_inst_id: { _eq: $proc_inst_id } },
              _set: { clock_in: $clock_in, lokasi: $lokasi }
            ) {
              affected_rows
            }
              }
            `,
            variables: {
              proc_inst_id,
              clock_in,
              lokasi,
            },
          },
          query: [],
        };

        const responseQuery = await configureQuery(fastify, dataQuery);
        console.log("Response GraphQL:", responseQuery.data[0].graph);

        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: proc_inst_id,
          variables: {
            variables: {
              businessKey: { value: `${clock_in}`, type: "string" },
              ldapClockInSuccess: {
                value: ldapResult ? ldapResult.success : false,
                type: "boolean",
              },
            },
          },
        };

        const responseCamunda = await camundaConfig(
          dataCamunda,
          proc_inst_id,
          process
        );
        console.log("Response Camunda:", responseCamunda);

        results.push({
          camunda: responseCamunda.data,
        });
      } catch (error) {
        console.error(`Error executing handler for event: ${eventKey}`, error);
        throw error;
      }
    }

    return results;
  },

  async onChange(data) {
    console.log("2. Handling onChange with data:", data);
    // Implementasi onChange
    return { message: "onChange executed", data };
  },
};

const handle = async (eventData) => {
  const { eventKey, data, process } = eventData;
  console.log("3. eventData", eventData);

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
