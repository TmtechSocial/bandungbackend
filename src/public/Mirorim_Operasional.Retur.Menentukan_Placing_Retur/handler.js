const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")();
const GRAPHQL_API = process.env.GRAPHQL_API;

const eventHandlers = {
    async onSubmit(data, process) {
        const results = [];
        for (const item of data) {
            try {
                let instanceId = item.proc_inst_id || null;
                console.log("products", item.products);
                const products = item.products;
                const now = new Date();
                const dateCode = `${String(now.getDate()).padStart(2, "0")}-${String(
                    now.getMonth() + 1
                ).padStart(2, "0")}-${String(now.getFullYear()).slice(2)}`;
                const Reject = products.some(p => p.quantity_not_ok > 0);
                const Retail = products.some(p => p.output_status === "Retail");
                const Wholesale = products.some(p => p.output_status === "Wholesale");
                const uniqueTrxRetail = `RR|${dateCode}|${item.invoice}`;
                const uniqueTrxWholesale = `RW|${dateCode}|${item.invoice}`;
                const uniqueTrxReject = `RJ|${dateCode}|${item.invoice}`;

                // Buat payload Camunda
                const dataCamunda = {
                    type: "complete",
                    endpoint: `/engine-rest/task/{taskId}/complete`,
                    instance: item.proc_inst_id,
                    variables: {
                        variables: {
                            Reject: { value: Reject, type: "Boolean" },
                            Retail: { value: Retail, type: "Boolean" },
                            Wholesale: { value: Wholesale, type: "Boolean" },
                            uniqueTrxRetail: { value: uniqueTrxRetail, type: "String" },
                            uniqueTrxWholesale: { value: uniqueTrxWholesale, type: "String" },
                            uniqueTrxReject: { value: uniqueTrxReject, type: "String" },
                        },
                    },
                };
                const responseCamunda = await camundaConfig(
                    dataCamunda,
                    instanceId,
                    process
                );
                if (responseCamunda.status === 200 || responseCamunda.status === 204) {
                    console.log("products", item.products);
                    const productQueries = [];
                    for (const product of item.products) {
                        const baseId = product.id;
                        const baseOutputStatus = product.output_status;
                        const baseLocation = product.location_id;
                        if (product.quantity_ok > 0) {
                            const prefix = baseOutputStatus === "Retail" ? "RR" : "RW";
                            const unique_trx = `${prefix}|${dateCode}|${item.invoice}`;
                            productQueries.push({
                                graph: {
                                    method: "mutate",
                                    endpoint: GRAPHQL_API,
                                    gqlQuery: `
                                        mutation insertPlacement(
                                        $quantity_distributed: Int!,
                                        $mo_retur_id: Int!,
                                        $output: String!,
                                        $location_id: Int!,
                                        $unique_trx: String!
                                        ) {
                                            insert_mo_retur_placement(
                                                objects: {
                                                quantity_distributed: $quantity_distributed,
                                                mo_retur_id: $mo_retur_id,
                                                output: $output,
                                                location_id: $location_id,
                                                unique_trx: $unique_trx
                                                }
                                            ) {
                                                affected_rows
                                            }
                                        }
                                    `,
                                    variables: {
                                        quantity_distributed: product.quantity_ok,
                                        mo_retur_id: baseId,
                                        output: baseOutputStatus,
                                        location_id: baseLocation,
                                        unique_trx,
                                    },
                                },
                            });
                        }

                        // ✅ INSERT untuk quantity_not_ok > 0
                        if (product.quantity_not_ok > 0) {
                            const unique_trx = `RJ|${dateCode}|${item.invoice}`;

                            productQueries.push({
                                graph: {
                                    method: "mutate",
                                    endpoint: GRAPHQL_API,
                                    gqlQuery: `
            mutation insertPlacementReject(
              $quantity_distributed: Int!,
              $mo_retur_id: Int!,
              $output: String!,
              $unique_trx: String!
            ) {
              insert_mo_retur_placement(
                objects: {
                  quantity_distributed: $quantity_distributed,
                  mo_retur_id: $mo_retur_id,
                  output: $output,
                  unique_trx: $unique_trx
                }
              ) {
                affected_rows
              }
            }
          `,
                                    variables: {
                                        quantity_distributed: product.quantity_not_ok,
                                        mo_retur_id: baseId,
                                        output: "Reject",
                                        unique_trx,
                                    },
                                },
                            });
                        }
                    }

                    const responseQuery = [];

                    // 🔁 Jalankan satu per satu biar gak error
                    for (const pq of productQueries) {
                        try {
                            const res = await configureQuery(fastify, pq);
                            console.log("🧪 Raw GraphQL Response:", JSON.stringify(res, null, 2));
                            if (res?.data?.[0]?.graph?.data?.errors) {
                                console.error("❌ GraphQL Error:", JSON.stringify(res.data[0].graph.data.errors, null, 2));
                            } else if (res?.data?.[0]?.graph?.data?.data) {
                                console.log("✅ Success:", JSON.stringify(res.data[0].graph.data.data, null, 2));
                            } else {
                                console.warn("⚠️ Unknown GraphQL Response:", JSON.stringify(res, null, 2));
                            }
                            responseQuery.push(res);
                        } catch (err) {
                            console.error("🔥 configureQuery failed:", err);
                            responseQuery.push({ error: err.message });
                        }
                    }

                    results.push({
                        message: "Complete event processed successfully",
                        database: responseQuery,
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

