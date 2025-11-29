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

        if (item.resi_match === true) {
          const dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `mutation MyMutation($proc_inst_id: String!, $file: String!, $invoice: String!, $date: timestamp!, $notes: String!) { update_mo_retur_receive(where: {proc_inst_id: {_eq: $proc_inst_id}}, _set: {invoice: $invoice, unboxed_at: $date, notes_on_duty: $notes, file_onduty: $file}) { affected_rows } }`,
              variables: {
                proc_inst_id: item.proc_inst_id,
                invoice: item.invoice || "",
                date: item.unboxed_date || null,
                notes: item.notes_on_duty || "",
                file: item.evidence[0] || "",
              },
            },
            query: [],
          };

          console.log("dataQuery", dataQuery);
          const responseQuery = await configureQuery(fastify, dataQuery);
          console.log("responseQuery", responseQuery);

          results.push({
            message: "Save event processed successfully",
            database: responseQuery.data,
          });
        } else {
          // Kirim ke Camunda
          const dataCamunda = {
            type: "complete",
            endpoint: `/engine-rest/task/{taskId}/complete`,
            instance: item.proc_inst_id,
            variables: {
              variables: {
                invoice: { value: item.invoice || "", type: "string" },
                resi_match: { value: item.resi_match, type: "string" },
                barang: { value: item.barang_match || "", type: "string" },
              },
            },
          };

          const responseCamunda = await camundaConfig(
            dataCamunda,
            instanceId,
            process
          );

          if (
            responseCamunda.status === 200 ||
            responseCamunda.status === 204
          ) {
            const dataQuery = {
              graph: {
                method: "mutate",
                endpoint: GRAPHQL_API,
                gqlQuery: `mutation MyMutation($proc_inst_id: String!, $invoice: String!, $notes: String!, $file: String!) { update_mo_retur_receive(where: {proc_inst_id: {_eq: $proc_inst_id}}, _set: {invoice: $invoice, notes_on_duty: $notes, file_onduty: $file}) { affected_rows } }`,
                variables: {
                  proc_inst_id: item.proc_inst_id,
                  invoice: item.invoice || "",
                  notes: item.notes_on_duty || "",
                  file: item.evidence[0] || "",
                },
              },
              query: [],
            };

            const responseQuery = await configureQuery(fastify, dataQuery);

            results.push({
              message: "Complete event processed successfully",
              camunda: responseCamunda.data,
              database: responseQuery.data,
            });
          }
        }
      } catch (error) {
        console.error(
          `Error executing handler for event: ${data?.eventKey || "unknown"}`,
          error
        );
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
