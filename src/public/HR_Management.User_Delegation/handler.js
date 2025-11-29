const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const axios = require("axios");
const GRAPHQL_API = process.env.GRAPHQL_API;
const CRON_LDAP_GROUP_AVAILABLE = process.env.CRON_LDAP_GROUP_AVAILABLE;

const eventHandlers = {
  async onSubmit(data, process) {
    console.log("!!", data[0]);
    const results = [];
    for (const item of data) {
      try {
        // Build action array from team_members
        const actionArray = [];

        for (const member of item.team_members) {
          if (member.employeeType === "Staff") {
            // Worker: format move (exclude PKL dan mirorim dari before)
            const groupNameArray = member.groupName
              .split(",")
              .map((g) => g.trim())
              .filter((g) => g !== "" && g !== "PKL" && g !== "mirorim");

            const beforeGroups = groupNameArray.join(", ");

            const actionObj = {
              user: String(member.nama),
              action: "move",
              before: beforeGroups,
              after: member.updateGroupSingle || "",
            };
            actionArray.push(actionObj);
          } else {
            // Non-worker (coordinator, leader, manager): format add/remove
            const groupNameArray = member.groupName
              .split(",")
              .map((g) => g.trim())
              .filter((g) => g !== "" && g !== "PKL" && g !== "mirorim");

            let before = "";
            let after = "";
            let action = "";

            if (member.aksiGroup === "add") {
              // Aksi ADD: before = group saat ini, after = group saat ini + group baru
              const updateGroupMultiAdd = member.updateGroupMultiAdd || [];

              before = groupNameArray.join(", "); // Group sebelum add

              const allGroupsAfterAdd = [
                ...groupNameArray,
                ...updateGroupMultiAdd,
              ];
              after = allGroupsAfterAdd.join(", "); // Group setelah add

              action = "add";
            } else if (member.aksiGroup === "remove") {
              // Aksi REMOVE: before = group saat ini, after = group saat ini - group yang dihapus
              const updateGroupMultiRemove =
                member.updateGroupMultiRemove || [];

              before = groupNameArray.join(", "); // Group sebelum remove

              // Filter out groups yang akan dihapus
              const remainingGroups = groupNameArray.filter(
                (g) => !updateGroupMultiRemove.includes(g)
              );
              after = remainingGroups.join(", "); // Group setelah remove

              action = "remove";
            }

            const actionObj = {
              user: String(member.nama),
              action: action,
              before: before,
              after: after,
            };
            actionArray.push(actionObj);
          }
        }

        // Create created_at timestamp (current time) - UTC+7 untuk Indonesia
        const now = new Date();
        const wibTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
        const created_at = wibTime
          .toISOString()
          .replace("T", " ")
          .split(".")[0];

        // Create businessKey: "prioritas : namaKaryawan : created_at"
        const businessKey = `Prioritas : ${item.namaKaryawan} : ${created_at}`;

        console.log("📊 Action Array:", JSON.stringify(actionArray, null, 2));
        console.log("🔑 Business Key:", businessKey);
        console.log("📅 Created At:", created_at);

        const dataCamunda = {
          type: "start",
          endpoint: `/engine-rest/process-definition/key/HR_Management.User_Delegation/start`,
          variables: {
            businessKey: businessKey,
            variables: {
              type: { value: "Manual", type: "string" },
              requestor: { value: item.idKaryawan, type: "string" },
            },
          },
        };

        const responseCamunda = await camundaConfig(dataCamunda, process);
        console.log("✅ Response Camunda:", responseCamunda);

        const dataQuery = {
          graph: {
            method: "mutate",
            endpoint: GRAPHQL_API,
            gqlQuery: `
              mutation insertRequest($action: jsonb!, $created_at: timestamp!, $proc_inst_id: String!, $requestor: String!) {
                insert_alokasi_resource(objects: {action: $action, created_at: $created_at, proc_inst_id: $proc_inst_id, requestor: $requestor}) {
                  affected_rows
                }
              }
            `,
            variables: {
              proc_inst_id: responseCamunda.data.processInstanceId,
              requestor: item.idKaryawan,
              created_at: created_at,
              action: actionArray,
            },
          },
          query: [],
        };

        const responseQuery = await configureQuery(fastify, dataQuery);
        console.log(
          "✅ Response GraphQL Insert Alokasi Resource:",
          JSON.stringify(responseQuery, null, 2)
        );

        results.push({
          proc_inst_id: responseCamunda.data.id,
          action: actionArray,
          requestor: item.idKaryawan,
        });

        // Optional: Log delegation ke CRON service (non-blocking)
        console.log("✅ TEST log berhasil dikirim ke CRON service");
        try {
          await axios.post(`${CRON_LDAP_GROUP_AVAILABLE}/api/delegation/log`, {
            proc_inst_id: responseCamunda.data.processInstanceId,
            id_requestor: item.idKaryawan,
          });
          console.log("✅ Delegation log berhasil dikirim ke CRON service");
        } catch (logError) {
          console.warn(
            "⚠️ Warning: Gagal mengirim log ke CRON service (port 8011), tapi proses tetap lanjut"
          );
          console.warn("Error details:", logError.message);
        }
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
