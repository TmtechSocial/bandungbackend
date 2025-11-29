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
        let instanceId = item.parent_inst_id || null;
          // Kirim ke Camunda
          const dataCamunda = {
            type: "complete",
            endpoint: `/engine-rest/task/{taskId}/complete`,
            instance: item.parent_inst_id,
            variables: {
              variables: {
                invoice: { value: item.invoice || "", type: "string" },
                resi_match: { value: item.resi_match, type: "string" },
                barang: { value: item.barang_match || "", type: "string" },
                AR: { value: "retur" || "", type: "string" },
              },
            },
          };

          const responseCamunda = await camundaConfig(
            dataCamunda,
            instanceId,
            process
          );

          if (responseCamunda.status === 200 || responseCamunda.status === 204) {
            const dataQuery = {
              graph: {
                method: "mutate",
                endpoint: GRAPHQL_API,
                gqlQuery: `mutation MyMutation($parent_inst_id: String!, $invoice: String!, $notes: String!, $file: String!, $task: String!, $date: timestamp!) { update_mo_retur_receive(where: {parent_inst_id: {_eq: $parent_inst_id}}, _set: {invoice: $invoice, notes_on_duty: $notes, file_onduty: $file, task_def_key: $task, unboxed_at: $date}) { affected_rows } }`,
                variables: {
                  parent_inst_id: item.parent_inst_id,
                  invoice: item.invoice || "",
                  notes: item.notes_on_duty || "",
                  date: item.unboxed_date || new Date().toISOString(),
                  file: item.evidence[0] || "",
                  task: (() => {
                    if (item.resi_match === "not match") {
                      return "Reject, invalid invoice";
                    }
                    if (
                      item.resi_match === "match" &&
                      item.barang_match === "match check"
                    ) {
                      return "Mirorim_Operasional.Retur.Physical_Check";
                    }
                    if (
                      item.resi_match === "match" &&
                      item.barang_match === "match"
                    ) {
                      return "Mirorim_Operasional.Retur.Update_Status_MP";
                    }
                    if (
                      item.resi_match === "match" &&
                      item.barang_match === "mismatch"
                    ) {
                      return "Mirorim_Operasional.Retur.Follow_Up_MP";
                    }
                    return "Unknown";
                  })(),
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


