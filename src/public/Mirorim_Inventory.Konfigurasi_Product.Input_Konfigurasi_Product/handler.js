const camundaConfig = require("../../utils/camunda/camundaConfig");

const eventHandlers = {
  async onSubmit(data, process) {
    console.log("!!", data[0]);
    const results = [];
    for (const item of data) {
      try {
        let nett_weight_per_pcs
        let gross_weight_per_pcs

        if (item.weight_type_used === 'net') {
          nett_weight_per_pcs = item.weight_per_pcs
        } else if (item.weight_type_used === 'gross') {
          gross_weight_per_pcs = item.weight_per_pcs
        }

        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {
              configured_by: { value: item.configured_by, type: "string" },
              configured_by_uid: { value: item.configured_by_uid, type: "string" },
              lokasi: { value: item.lokasi, type: "string" },
              product_name: { value: item.product_name, type: "string" },
              product_tolerance_percent: { value: item.product_tolerance, type: "string" },
              threshold_per_item: { value: item.threshold_per_item, type: "string" },
              weight_per_pcs: { value: item.weight_per_pcs, type: "string" },
              nett_weight_per_pcs: { value: nett_weight_per_pcs, type: "string" },
              gross_weight_per_pcs: { value: gross_weight_per_pcs, type: "string" },
              manual_count: { value: "False", type: "string" },
              manual_count_wholesale: { value: "False", type: "string" },
              weight_type: { value: item.weight_type_used, type: "string" },
              evidence: { value: item.evidence[0], type: "string" },
            },
          },
        };

        const responseCamunda = await camundaConfig(dataCamunda, item.proc_inst_id, process);
        console.log("responseCamunda", responseCamunda);

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