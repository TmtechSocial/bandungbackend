const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const GRAPHQL_API = process.env.GRAPHQL_API

const eventHandlers = {
    async onSubmit(data, process) {
        const results = [];
        for (const item of data) {
            try {
                let taskId;
                let instanceId = item.proc_inst_id || null;

                const dataCamunda = {
                    type: "complete",
                    endpoint: `/engine-rest/task/{taskId}/complete`,
                    instance: item.proc_inst_id,
                    variables: {
                        variables: {
                            complete: { value: item.complete, type: "Boolean" },
                        },
                    },
                };
                const responseCamunda = await camundaConfig(dataCamunda, instanceId, process);
                console.log("responseCamunda", responseCamunda);
                if (responseCamunda.status === 200 || responseCamunda.status === 204) {
                    let dataQuery;

                    if (item.complete === true) {
                        dataQuery = {
                            graph: {
                                method: "mutate",
                                endpoint: GRAPHQL_API,
                                gqlQuery: `
                                mutation MyMutation($proc_inst_id: String!, $quantity_output: Int!) { 
                                    update_mo_prepare_build_order(
                                    where: { proc_inst_id: { _eq: $proc_inst_id } }, 
                                    _set: { quantity_output: $quantity_output }
                                    ) {
                                    affected_rows
                                    }
                                }
                                `,
                                variables: {
                                    proc_inst_id: item.proc_inst_id,
                                    quantity_output: item.quantity_build,
                                },
                            },
                            query: [],
                        };
                    } else {
                       dataQuery = {
                            graph: {
                                method: "mutate",
                                endpoint: GRAPHQL_API,
                                gqlQuery: `
                                mutation InsertPartial(
                                    $proc_inst_id: String!, 
                                    $part_id: Int!, 
                                    $quantity_output: Int!, 
                                    $status: String!,
                                    $build_id: Int!
                                ) {
                                    insert_mo_prepare_build_order_partial(
                                    objects: [{
                                        parent_instance_id: $proc_inst_id,
                                        part_id: $part_id,
                                        quantity_output: $quantity_output,
                                        status: $status,
                                        build_id: $build_id
                                    }]
                                    ) {
                                    affected_rows
                                    }
                                }
                                `,
                                variables: {
                                proc_inst_id: item.proc_inst_id,
                                part_id: item.part_id,
                                quantity_output: item.quantity_build,
                                status: "unprocessed",
                                build_id: item.build_id
                                },
                            },
                            query: [],
                        };
                    }

                    const responseQuery = await configureQuery(fastify, dataQuery);
                    console.log("📨 Hasura Insert Response:", JSON.stringify(responseQuery.data, null, 2));
                    results.push({
                        message: "Create event processed successfully",
                        camunda: responseCamunda.data,
                        database: responseQuery.data,
                    });
                }
            } catch (error) {
                console.error(`Error executing handler for event: ${eventKey}`, error);
                console.log(`graphql error: ${error.dataQuery}`);

                throw error;
            }
        }

        return results;
    },

    async onChange(data) {
        console.log("Handling onChange with data:", data);
        // Implementasi onChange
        return { message: "onChange executed", data };
    },
};

const handle = async (eventData) => {
    const { eventKey, data, process } = eventData;
    console.log("eventData", eventData);

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
