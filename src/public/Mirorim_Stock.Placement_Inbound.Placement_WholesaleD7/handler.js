const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const GRAPHQL_API = process.env.GRAPHQL_API;
const SERVER_INVENTREE = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;
const INVENTREE_LOCATION_WIP_WHOLESALE_D7 = process.env.INVENTREE_LOCATION_WIP_WHOLESALE_D7;
const { transferStock } = require("../../utils/inventree/inventreeActions");
const axios = require("axios");

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];

    for (const item of data) {
      try {
        const instanceId = item.proc_inst_id || null;
        console.log("Id", item.id);
        item.loop_upload.forEach((x) => {
          console.log("location_id", x.location_id);
          console.log("quantity", x.quantity_placement);
          console.log("file", x.file);
        });
        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {
              // evidence_placement_inbound_wholesale: { value: evidence, type: "String" },
            },
          },
        };

        const responseCamunda = await camundaConfig(
          dataCamunda,
          instanceId,
          process
        );
        // if (instanceId) {
        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          const inventree = axios.create({
            baseURL: `${SERVER_INVENTREE}/api`,
            headers: {
              Authorization: `Token ${INVENTREE_API_TOKEN}`,
              "Content-Type": "application/json",
            },
            timeout: 10000,
          });

          const { data: stockItems } = await inventree.get(
            `/stock/?location=${INVENTREE_LOCATION_WIP_WHOLESALE_D7}&part=${item.part_pk}&status=10&ordering=-updated&limit=1`
          );

          const stockItemId = stockItems.results.length > 0 ? stockItems.results[0].pk : null;

          const dataQuery = [];

          let totalQty = 0;

          for (const product of item.loop_upload) {

            const quantity = product.quantity_placement;
            const locationId = product.location_id;
            const placementId = item.id;
            const evidence = product.file?.[0]?.name || null;

            totalQty += quantity;

            const notes = `Transfer Inbound WholesaleD7 | Proc ID: ${item.proc_inst_id}`;

            const stockTransfer = await transferStock(
              stockItemId,
              quantity,
              locationId,
              notes
            );

            console.log("stock Transfer", stockTransfer);

            // INSERT mi_distributed
            dataQuery.push({
              graph: {
                method: "mutate",
                endpoint: GRAPHQL_API,
                gqlQuery: `
      mutation InsertDistributed(
        $placement_id: Int!,
        $location_id: Int!,
        $quantity: Int!,
        $evidence: String,
    $created_at: timestamp!,
        $created_by: String!
      ) {
        insert_mi_distributed(
          objects: {
            placement_id: $placement_id,
            location_id: $location_id,
            quantity_distribute: $quantity,
            evidence: $evidence,
            created_at: $created_at,
            created_by: $created_by
          }
        ) {
          affected_rows
        }
      }
      `,
                variables: {
                  placement_id: placementId,
                  location_id: locationId,
                  quantity: quantity,
                  evidence: evidence,
                  created_at: item.updated_at,
                  created_by: item.updated_by
                }
              },
              query: []
            });

          }

          // UPDATE mi_placement (TOTAL)
          dataQuery.push({
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
              mutation UpdatePlacement(
                $updated_at: timestamp!,
                $updated_by: String!,
                $id: Int!,
                $quantity: Int!
              ) {
                update_mi_placement(
                  where: {id: {_eq: $id}},
                  _set: {
                    quantity_placement: $quantity,
                    updated_at: $updated_at,
                    updated_by: $updated_by
                  }
                ) {
                  affected_rows
                }
              }
              `,
              variables: {
                updated_at: item.updated_at,
                updated_by: item.updated_by,
                id: item.id,
                quantity: totalQty
              }
            },
            query: []
          });


          // EXECUTE
          const responseQuery = await Promise.all(
            dataQuery.map((query) => configureQuery(fastify, query))
          );

          console.log("responseQuery", JSON.stringify(responseQuery, null, 2));

          results.push({
            message: "Create event processed successfully",
            camunda: responseCamunda.data,
            database: responseQuery.map((r) => r.data),
          });
        }
      } catch (error) {
        console.error(
          `❌ Error executing handler for event: ${error.message}`,
          error
        );
      }
    }

    return results;
  },

  async onChange(data) {
    console.log("⚙️ Handling onChange with data:", data);
    return { message: "onChange executed", data };
  },
};

const handle = async (eventData) => {
  const { eventKey, data, process } = eventData;
  console.log("eventData", eventData);

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
