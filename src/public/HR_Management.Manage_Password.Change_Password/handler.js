const camundaConfig = require("../../utils/camunda/camundaConfig");
const axios = require("axios");
const CAMUNDA_API = process.env.CAMUNDA_API;
const LDAP_API_MANAGE = process.env.LDAP_API_MANAGE;

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];
    console.log("1. Handling onSubmit with data:", data);
    for (const item of data) {
      try {
        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {
            },
          },
        };

        const responseCamunda = await camundaConfig(
          dataCamunda,
          item.proc_inst_id,
          process
        );
        console.log("Response Camunda:", responseCamunda);

        results.push({
          camunda: responseCamunda.data,
        });

        if (responseCamunda.status == 204) {
          const updaatePassword = await axios.put(
            `${LDAP_API_MANAGE}/users/${item.text_}/change-password`,
            { password: item.passwordTerbaru },
          )

          console.log("Update Password Response:", updaatePassword.data);
        }

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
