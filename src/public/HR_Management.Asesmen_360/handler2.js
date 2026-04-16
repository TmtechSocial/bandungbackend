const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const GRAPHQL_API = process.env.GRAPHQL_API;

const eventHandlers = {
  async onSubmit(data) {
    const results = [];
    for (const item of data) {
      try {
        let taskId;

        // const { logs, Question, id_asesor } = item;
        // console.log("logs:", logs);
        // console.log("Question:", Question);
        // console.log("id_asesor:", id_asesor);
        // // filter logs SESUAI ASESOR AKTIF
        // const listAsesiFiltered = (logs || [])
        //   .filter((l) => String(l.id_asesor) === String(id_asesor))
        //   .map((l) => ({
        //     id_asesor: l.id_asesor,
        //     id_asesi: l.id_asesi,
        //     nama_asesi: l.nama_asesi,
        //     radio: l.radio ?? null,
        //     essay_answer: l.essay_answer ?? "",
        //   }));

        // // inject ke setiap question (SESUAI FORM.IO)
        // const FINAL_DATA_UTUH = Question.map((q) => ({
        //   id_question: q.id,
        //   question: q.question,
        //   question_type: q.question_type,
        //   listAsesi: (logs || [])
        //     .filter((l) => String(l.id_asesor) === String(id_asesor))
        //     .map((l) => ({
        //       id_asesor: l.id_asesor,
        //       id_asesi: l.id_asesi,
        //       nama_asesi: l.nama_asesi,
        //       radio: q.question_type === "pg" ? l.radio ?? null : undefined,
        //       essay_answer:
        //         q.question_type === "essay" ? l.essay_answer ?? "" : undefined,
        //     })),
        // }));

        // console.log(
        //   "FINAL DATA UTUH:",
        //   JSON.stringify(FINAL_DATA_UTUH, null, 2)
        // );

        // let instanceId = item.proc_inst_id || null;

        const dataCamunda = {
          type: "start",
          endpoint: `/engine-rest/process-definition/key/HR_Management.Asesmen_360/start`,
          // instance: item.proc_inst_id, // jika menggunakan complete maka dibutuhkan instance
          variables: {
            variables: {
              id_asesor: { value: item.id_asesor, type: "string" },
              // answer: { value: JSON.stringify(FINAL_DATA_UTUH), type: "Json" },
            },
            businessKey: `${item.id_asesor}:${item.first_name}:${item.date}`,
          },
        };

        const responseCamunda = await camundaConfig(dataCamunda, instanceId);
        // console.log("responseCamunda", responseCamunda);
        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          const instanceId = responseCamunda.data.processInstanceId;
          console.log("New Instance ID:", instanceId);

          results.push({
            message: "Save event processed successfully",
          });
        }
      } catch (error) {
        console.error(
          "Error executing onSubmit handler for item:",
          item,
          error
        );
        throw error;
      }
    }

    return results;
  },

  async onChange(data) {
    // console.log("Handling onChange with data:", data);
    // Implementasi onChange
    return { message: "onChange executed", data };
  },
};

const handle = async (eventData) => {
  const { eventKey, data } = eventData;
  // console.log("eventData", eventData);

  if (!eventHandlers[eventKey]) {
    // throw new Error(`No handler found for event: ${eventKey}`);
  }

  // Panggil handler yang sesuai berdasarkan event
  try {
    return await eventHandlers[eventKey](data);
  } catch (error) {
    // console.error(`Error executing handler for event: ${eventKey}`, error);
    throw error;
  }
};

module.exports = { handle };
