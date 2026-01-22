const camundaConfig = require("../../utils/camunda/camundaConfig");

const eventHandlers = {
  async onSubmit(data, process) {
    console.log("!!", data[0]);
    const results = [];
    for (const item of data) {
      try {
          const dataCamunda = {
            type: "start",
            endpoint: `/engine-rest/process-definition/key/Mirorim_Inventory.Konfigurasi_Product/start`,
            variables: {
              variables: {
                part_id: { value: item.part_pk_select?.pk, type: "integer" },
                requested_by: { value: item.requested_by, type: "string" },
                requested_by_uid: { value: item.requested_by_uid, type: "string" },
                manual_configure: { value: "manual", type: "string" },
              },
            },
          };

          const responseCamunda = await camundaConfig(dataCamunda, process);
          console.log("Response Camunda:", responseCamunda);
      } catch (error) {
        console.error(`❌ Error executing handler for event: onSubmit`, error);
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
