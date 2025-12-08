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
            },
          },
        };

        const responseCamunda = await camundaConfig(dataCamunda, instanceId, process);
        console.log("responseCamunda", responseCamunda);
        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          // const instanceId = responseCamunda.data.processInstanceId;
          let dataQuery;
          if(item.action == "update"){
        dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `mutation MyMutation($proc_inst_id: String!, $date: timestamp!, $task: String!, $user_admin: String!, $resi: String!) {
  update_mo_order(where: {proc_inst_id: {_eq: $proc_inst_id}}, _set: {on_duty_at: $date, task_def_key: $task, user_admin: $user_admin, resi: $resi}) {
    affected_rows
  }
  update_mo_order_shop(where: {proc_inst_id: {_eq: $proc_inst_id}}, _set: {resi: $resi}) {
    affected_rows
  }
}
`,
              variables: {
                proc_inst_id: item.proc_inst_id,
                date: item.on_duty_at,
                user_admin: item.user_admin,
                task: "Mirorim_Operasional.Order.Picking",
                resi: item.resi_update || item.resi,
              },
            },
            query: [],
          };
          }else {
            dataQuery = {
              graph: {
                method: "mutate",
                endpoint: GRAPHQL_API,
                gqlQuery: `mutation MyMutation($proc_inst_id: String!, $date: timestamp!, $task: String!, $user_admin: String!) { update_mo_order(where: {proc_inst_id: {_eq: $proc_inst_id}}, _set: {on_duty_at: $date, task_def_key: $task, user_admin: $user_admin}) { affected_rows } }`,
                variables: {
                  proc_inst_id: item.proc_inst_id,
                  date: item.on_duty_at,
                  user_admin: item.user_admin,
                  task: "Mirorim_Operasional.Order.Picking",
                },
              },
              query: [],
            };
          }

          const responseQuery = await configureQuery(fastify, dataQuery);
          console.log("responseQuery", responseQuery);

          results.push({
            message: "Create event processed successfully",
            camunda: responseCamunda.data,
            database: responseQuery.data,
          });
        }
      } catch (error) {
        console.error(`Error executing handler for event: ${eventKey}`, error);
        console.log( `graphql error: ${error.dataQuery}`);
        
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
