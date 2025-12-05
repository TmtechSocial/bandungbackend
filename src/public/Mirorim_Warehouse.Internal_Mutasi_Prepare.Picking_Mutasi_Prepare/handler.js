const { Source } = require("graphql");
const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const {
  transferStock,
  getDescStock,
} = require("../../utils/inventree/inventreeActions");
const fastify = require("fastify");
const axios = require("axios");
const GRAPHQL_API = process.env.GRAPHQL_API;

const eventHandlers = {
  async onSubmit(data, process, eventKey) {
    const results = [];

    for (const item of data) {
      try {
        const instanceId = item.proc_inst_id || null;
        let dataCamunda = null;
        let stockGetDesc = null;

        // Jika bukan print ulang → lakukan transfer stock dan ambil desc stock
        if (!item.printUlang) {
          const partPk = item.part_id;
          const locationPk = 6225;
          const stockPk = item.source_id;
          const quantity = item.quantity_staging;

          const notesTransfer = `Transfer stock WIP In Transit ${instanceId}`;

          console.log("source_id:", stockPk);

          const stockTransfer = await transferStock(
            stockPk,
            quantity,
            locationPk,
            notesTransfer
          );
          stockGetDesc = await getDescStock(partPk, locationPk);

          console.log("stockGetDesc:", stockGetDesc);

          // Payload Camunda untuk mode normal
          dataCamunda = {
            type: "complete",
            endpoint: `/engine-rest/task/{taskId}/complete`,
            instance: instanceId,
            variables: {
              variables: {
                product_name: {
                  value: item.product_name || null,
                  type: "String",
                },
                coordinator: {
                  value: "InventoryPrepareCoordinator",
                  type: "String",
                },
                part_id: { value: item.part_id, type: "Integer" },
                source_stock: { value: stockGetDesc, type: "Integer" },
                primary_stock: { value: item.source_id, type: "Integer" },
                id: { value: item.id, type: "Integer" },
                quantity_staging: {
                  value: item.quantity_staging,
                  type: "Integer",
                },
                WIPLocation: { value: 1000006, type: "Integer" },
                table_reference: { value: "mutasi_request", type: "String" },
                printUlang: { value: false, type: "Boolean" },
              },
            },
          };
        } else {
          // Payload Camunda untuk print ulang
          dataCamunda = {
            type: "complete",
            endpoint: `/engine-rest/task/{taskId}/complete`,
            instance: instanceId,
            variables: {
              variables: {
                printUlang: { value: true, type: "Boolean" },
              },
            },
          };
        }

        // Kirim ke Camunda
        const responseCamunda = await camundaConfig(
          dataCamunda,
          instanceId,
          process
        );
        console.log("responseCamunda", responseCamunda);

        // Jika sukses, lakukan update ke Hasura (kecuali mode printUlang)
        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          for (const product of item.products) {
            if (item.printUlang) {
              console.log("🖨️ Mode print ulang, skip update Hasura.");
              continue;
            }

            console.log("stockGetDesc:", stockGetDesc);

            const dataQuery = {
              graph: {
                method: "mutate",
                endpoint: GRAPHQL_API,
                gqlQuery: `
                  mutation UpdateMutasi($request_id: Int!, $source_id: String!, $stock_id: String!, $user: String!, $date: timestamp!, $quantity_pick: Int!, $quantity_fisik: Int!, $quantity_data: Int!, $proc_inst_id: String!, $status: String!, $evidence_picking: String!) {
  updateDetails: update_mutasi_request_details(where: {request_id: {_eq: $request_id}, source_id: {_eq: $source_id}, type: {_eq: "source"}}, _set: {updated_by: $user, updated_at: $date, quantity: $quantity_pick, quantity_physical: $quantity_fisik, quantity_data: $quantity_data, source_id: $stock_id}) {
    affected_rows
  }
  updateRequest: update_mutasi_request(where: {proc_inst_id: {_eq: $proc_inst_id}}, _set: {quantity: $quantity_pick, status: $status, evidence_picking: $evidence_picking}) {
    affected_rows
  }
}
                `,
                variables: {
                  proc_inst_id: item.proc_inst_id,
                  request_id: product.request_id,
                  source_id: product.source_id,
                  stock_id: String(stockGetDesc),
                  user: item.updated_by,
                  date: item.updated_at,
                  quantity_pick: product.quantity_pick || 0,
                  quantity_fisik: product.quantity_fisik || 0,
                  quantity_data: item.quantity_data || 0,
                  status: "Completed",
                  evidence_picking: item.evidence[0] || "",
                },
              },
              query: [],
            };

            const responseQuery = await configureQuery(fastify, dataQuery);
            console.log(
              `Updated mutasi_request_details request_id ${product.request_id}`
            );
            console.log(responseQuery.data);
          }

          results.push({
            message: "Create event processed successfully",
            camunda: responseCamunda.data,
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
    return { message: "onChange executed", data };
  },
};

const handle = async (eventData) => {
  const { eventKey, data, process } = eventData;
  console.log("eventData", eventData);

  if (!eventHandlers[eventKey]) {
    throw new Error(`No handler found for event: ${eventKey}`);
  }

  return await eventHandlers[eventKey](data, process, eventKey);
};

module.exports = { handle };
