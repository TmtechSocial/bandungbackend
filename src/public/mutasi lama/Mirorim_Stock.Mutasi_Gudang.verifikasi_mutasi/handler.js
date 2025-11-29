const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")();
const axios = require("axios");

const GRAPHQL_API = process.env.GRAPHQL_API;
const SERVER_INVENTREE = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];

    for (const item of data) {
      try {
        const {
          proc_inst_id,
          notes,
          products = [],
          id: requestId,
          name_employee,
          date,
        } = item;

        const source = products.map((product) => ({
          source_id: product.source_sku,
          quantity: product.quantity,
          quantity_sisa: product.quantity_sisa,
        }));

        console.log("📥 Data source:", source);
        console.log("📥 Data form picking_sku:", products);
        console.log("📥 Notes:", notes || "");

        // Setup axios inventree
        const inventree = axios.create({
          baseURL: `${SERVER_INVENTREE}/api`,
          headers: {
            Authorization: `Token ${INVENTREE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          timeout: 10000,
        });

        // Ambil lokasi source tiap product dari Inventree API
        for (const product of products) {
          try {
            const stockResponse = await inventree.get(
              `/stock/${product.source_sku}/`
            );
            product.source_location_name =
              stockResponse.data?.location_name || "UnknownLocation";
          } catch (err) {
            product.source_location_name = "UnknownLocation";
            product.destination_location_name = "UnknownLocation";
          }
        }

        const totalQty = products.reduce(
          (sum, p) => sum + (p.quantity || 0),
          0
        );
        // Kirim complete task ke Camunda
	const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {
              valid: { value: item.valid, type: "boolean" },
              source: {value: JSON.stringify(source), type: "String"},
            },
          },
        };

        const responseCamunda = await camundaConfig(
          dataCamunda,
          proc_inst_id,
          process
        );
        console.log("responseCamunda", responseCamunda);
          if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          // Update mutasi_request quantity
          const dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
      mutation updateBoth($proc_inst_id: String!, $notes: String!, $status: String!, $request_id: Int!, $quantity: Int!) {
        update_mutasi_request(
          where: {proc_inst_id: {_eq: $proc_inst_id}},
          _set: {quantity: $quantity, notes: $notes, status: $status}
        ) {
          affected_rows
        }
        update_mutasi_request_details(
          where: {
            _and: [
              {request_id: {_eq: $request_id}},
              {type: {_eq: "destination"}}
            ]
          },
          _set: {quantity: $quantity}
        ) {
          affected_rows
        }
      }
    `,
              variables: {
                proc_inst_id: item.proc_inst_id,
                request_id: item.id,
                quantity: totalQty,
                notes: item.notes || "",
                status: item.valid ? "processed" : "rejected",
              },
            },
            query: [],
          };

          const responseQuery = await configureQuery(fastify, dataQuery);
          console.log("responseQuery", responseQuery);

          // Insert mutasi_request_details untuk setiap product
          const dataQueryDetails = products.map((product) => ({
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
                mutation insertMutasiDetail(
                  $request_id: Int!,
                  $type: String!,
                  $location_id: String!,
                  $sku_id: String!,
                  $quantity: Int!,
                  $updated_at: timestamp!,
                  $created_at: timestamp!,
                  $created_by: String!,
                  $updated_by: String!
                ) {
                  insert_mutasi_request_details(objects: {
                    request_id: $request_id,
                    type: $type,
                    location_id: $location_id,
                    sku_id: $sku_id,
                    quantity: $quantity,
                    updated_at: $updated_at,
                    created_at: $created_at,
                    created_by: $created_by,
                    updated_by: $updated_by
                  }) { affected_rows }
                }
              `,
              variables: {
                request_id: requestId,
                type: "source",
                location_id: product.source_location_name || "WH001",
                sku_id: String(product.source_sku),
                quantity: product.quantity,
                updated_at: item.created_at || new Date().toISOString(),
                created_at: item.created_at || new Date().toISOString(),
                created_by: item.user || "Unknown",
                updated_by: item.user || "Unknown",
              },
            },
            query: [],
          }));

          const responseDetails = await Promise.all(
            dataQueryDetails.map(async (q) => {
              try {
                const res = await configureQuery(fastify, q);
                const bodyJson = res.body ? JSON.parse(res.body) : res.data;

                if (bodyJson.errors) {
                  console.error("GraphQL errors:", bodyJson.errors);
                  return null;
                }

                return (
                  bodyJson.data?.insert_mutasi_request_details?.affected_rows ||
                  null
                );
              } catch (err) {
                console.error("Insert mutasi_detail error:", err);
                return null;
              }
            })
          );

          results.push({ message: "Save event processed successfully" });
        }
      } catch (error) {
        const errMsg = error?.response?.data
          ? JSON.stringify(error.response.data, null, 2)
          : error.message || "Unknown error";
        throw new Error(`Handler gagal: ${errMsg}`);
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

  return await eventHandlers[eventKey](data, process);
};

module.exports = { handle };
