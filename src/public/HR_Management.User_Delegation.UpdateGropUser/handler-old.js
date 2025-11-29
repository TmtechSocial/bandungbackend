const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const GRAPHQL_API = process.env.GRAPHQL_API;
const axios = require("axios");
const LDAP_API_MANAGE = process.env.LDAP_API_MANAGE;

const eventHandlers = {
  async onSubmit(data, process) {
    console.log("!!", data);
    for (const element of data[0].team_members) {
      // Process each team member
      console.log("Processing team member:", element);
    }
    const results = [];
    for (const item of data) {
      if (item.kegiatan == "alokasiResource") {
        console.log("Processing item:", item);
        try {
          // Build action array from team_members
          const actionArray = [];
          const userArray = [];

          // Proses LDAP untuk setiap member
          for (const member of item.team_members) {
            userArray.push(String(member.nama));

            console.log(`\n🔄 Processing user: ${member.nama}`);

            // Step 1: Ambil DN user dari LDAP
            const userResponse = await axios.get(
              `${LDAP_API_MANAGE}/users/${member.nama}`
            );
            const userData = userResponse.data;
            const userDN = userData.dn;
            console.log(`✅ User DN: ${userDN}`);

            // Step 2: Ambil groups user saat ini
            const groupsResponse = await axios.get(
              `${LDAP_API_MANAGE}/memberuid/${encodeURIComponent(
                userDN
              )}/groups`
            );
            const currentGroups = groupsResponse.data.groups || [];
            console.log(
              `📦 Current groups: ${currentGroups.map((g) => g.cn).join(", ")}`
            );

            if (member.employeeType === "Staff") {
              // WORKER: MOVE dari group lama ke group baru
              const beforeGroups = member.groupName
                .split(",")
                .map((g) => g.trim());
              const afterGroup = member.updateGroupSingle || "";

              console.log(
                `🔀 WORKER MOVE: ${beforeGroups.join(", ")} → ${afterGroup}`
              );

              // Step 3: DELETE dari semua group yang ada (kecuali PKL atau mirorim)
              for (const group of currentGroups) {
                if (group.cn !== "PKL" && group.cn !== "mirorim") {
                  console.log(`🗑️ Deleting from group: ${group.cn}`);
                  await axios.delete(
                    `${LDAP_API_MANAGE}/groups/${group.cn}/memberuid`,
                    {
                      data: { memberUid: userDN },
                      headers: { "Content-Type": "application/json" },
                    }
                  );
                  console.log(`✅ Deleted from ${group.cn}`);
                } else {
                  console.log(`⏭️ Skipping PKL & mirorim group`);
                }
              }

              // Step 4: POST ke group baru
              if (afterGroup) {
                console.log(`➕ Adding to group: ${afterGroup}`);
                await axios.post(
                  `${LDAP_API_MANAGE}/groups/${afterGroup}/memberuid`,
                  { memberUid: userDN },
                  { headers: { "Content-Type": "application/json" } }
                );
                console.log(`✅ Added to ${afterGroup}`);
              }

              // Build action object untuk worker
              const actionObj = {
                user: String(member.nama),
                action: "move",
                before: member.groupName,
                after: afterGroup,
              };
              actionArray.push(actionObj);
            } else {
              // NON-WORKER: ADD dan REMOVE
              const groupNameArray = member.groupName
                .split(",")
                .map((g) => g.trim());
              const updateGroupArray = member.updateGroupMulti || [];

              // Ambil daftar cn dari current groups user
              const currentGroupNames = currentGroups.map((g) => g.cn);

              // groupRemove: yang ada di groupName tapi tidak ada di updateGroupMulti
              const groupsToRemove = groupNameArray.filter(
                (g) => !updateGroupArray.includes(g)
              );

              // groupAdd: yang ada di updateGroupMulti tapi BELUM ADA di current groups
              const groupsToAdd = updateGroupArray.filter(
                (g) => !currentGroupNames.includes(g)
              );

              const groupAdd = updateGroupArray.join(", ");
              const groupRemove = groupsToRemove.join(", ");

              console.log(
                `➕ Groups to ADD: ${groupsToAdd.join(", ")} (dari ${groupAdd})`
              );
              console.log(`🗑️ Groups to REMOVE: ${groupsToRemove.join(", ")}`);

              // Step 3: DELETE dari groups yang perlu dihapus (kecuali PKL)
              for (const groupName of groupsToRemove) {
                if (groupName !== "PKL" && groupName !== "mirorim") {
                  console.log(`🗑️ Removing from group: ${groupName}`);
                  await axios.delete(
                    `${LDAP_API_MANAGE}/groups/${groupName}/memberuid`,
                    {
                      data: { memberUid: userDN },
                      headers: { "Content-Type": "application/json" },
                    }
                  );
                  console.log(`✅ Removed from ${groupName}`);
                } else {
                  console.log(`⏭️ Skipping PKL & mirorim group removal`);
                }
              }

              // Step 4: POST ke groups baru (hanya yang belum ada)
              for (const groupName of groupsToAdd) {
                console.log(`➕ Adding to group: ${groupName}`);
                await axios.post(
                  `${LDAP_API_MANAGE}/groups/${groupName}/memberuid`,
                  { memberUid: userDN },
                  { headers: { "Content-Type": "application/json" } }
                );
                console.log(`✅ Added to ${groupName}`);
              }

              // Log groups yang sudah ada sebelumnya (skip)
              const alreadyInGroups = updateGroupArray.filter((g) =>
                currentGroupNames.includes(g)
              );
              if (alreadyInGroups.length > 0) {
                console.log(
                  `ℹ️ User sudah berada di group: ${alreadyInGroups.join(
                    ", "
                  )} (skip POST)`
                );
              }

              // Build action object untuk non-worker
              const actionObj = {
                user: String(member.nama),
                groupAdd: groupAdd,
                groupRemove: groupRemove,
              };
              actionArray.push(actionObj);
            }
          }

          console.log("\n✅ Semua proses LDAP selesai! Updating GraphQL...");

          // Create date_approve (current timestamp) - UTC+7 untuk Indonesia
          const now = new Date();
          const wibTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
          const date_approve = wibTime
            .toISOString()
            .replace("T", " ")
            .split(".")[0];

          const dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
              mutation insertAlokasi($proc_inst_id: String!, $action: jsonb!, $date_approve: timestamp!, $status: String!) {
                update_alokasi_resource(where: {proc_inst_id: {_eq: $proc_inst_id}}, _set: {action: $action, date_approve: $date_approve, status: $status}) {
                  affected_rows
                }
              }
            `,
              variables: {
                proc_inst_id: item.proc_inst_id,
                action: actionArray,
                date_approve: date_approve,
                status: "Approve",
              },
            },
            query: [],
          };

          console.log("📊 Action Array:", JSON.stringify(actionArray, null, 2));
          console.log("👥 User String:", userArray.join(", "));

          const responseQuery = await configureQuery(fastify, dataQuery);
          console.log(
            "✅ Response GraphQL Update Alokasi Resource:",
            JSON.stringify(responseQuery, null, 2)
          );

          // Build Camunda variable dengan tipe "System"
          const actionLogForCamunda = actionArray.map((action) => ({
            ...action,
            tipe: "System",
          }));

          const dataCamunda = {
            type: "complete",
            endpoint: `/engine-rest/task/{taskId}/complete`,
            instance: item.proc_inst_id,
            variables: {
              variables: {
                actionLog: {
                  value: JSON.stringify(actionLogForCamunda),
                  type: "json",
                },
              },
            },
          };

          console.log(
            "📊 Action Log for Camunda (System):",
            JSON.stringify(actionLogForCamunda, null, 2)
          );

          const responseCamunda = await camundaConfig(
            dataCamunda,
            item.proc_inst_id,
            process
          );
          console.log("✅ Response Camunda:", responseCamunda);
        } catch (error) {
          console.error(
            `❌ Error executing handler for event: ${eventKey}`,
            error
          );
          console.error(
            "Error details:",
            error.response?.data || error.message
          );
          throw error;
        }
      } else if (item.kegiatan == "approvalAlokasi") {
        try {
          console.log("Processing approvalAlokasi for item:", item);

          // Pisahkan approve dan reject
          const approvedMembers = (item.approval_team_members || []).filter(
            (apr) => apr.approveAction === "approve"
          );
          const rejectedMembers = (item.approval_team_members || []).filter(
            (apr) => apr.approveAction === "reject"
          );

          console.log(
            `📊 Total: ${item.approval_team_members?.length || 0} | Approve: ${
              approvedMembers.length
            } | Reject: ${rejectedMembers.length}`
          );

          const actionArray = [];
          const ldapOperations = [];

          // Step 1: Proses yang APPROVE - kumpulkan operasi LDAP
          for (const apr of approvedMembers) {
            console.log(`\n✅ Processing APPROVE for user: ${apr.user}`);

            // Get DN
            const userResponse = await axios.get(
              `${LDAP_API_MANAGE}/users/${apr.user}`
            );
            const userData = userResponse.data;
            const userDN = userData.dn;
            console.log(`✅ User DN: ${userDN}`);

            // Get current groups by DN
            const groupsResponse = await axios.get(
              `${LDAP_API_MANAGE}/memberuid/${encodeURIComponent(
                userDN
              )}/groups`
            );
            const currentGroups = groupsResponse.data.groups || [];
            const currentGroupNames = currentGroups.map((g) => g.cn);
            console.log(`📦 Current groups: ${currentGroupNames.join(", ")}`);

            // Parse before_ and after_
            const beforeList = (apr.before_ || "")
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            const afterList = (apr.after_ || "")
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
              console.log(beforeList, afterList);

            // Siapkan operasi DELETE
            for (const g of beforeList) {
              if (g === "PKL" && g === "mirorim") {
                console.log(`⏭️ Skipping PKL & mirorim removal for ${g}`);
                continue;
              }
              if (currentGroupNames.includes(g)) {
                ldapOperations.push({
                  type: "delete",
                  user: apr.user,
                  group: g,
                  userDN: userDN,
                });
              }
            }

            // Siapkan operasi POST
            for (const g of afterList) {
              if (!currentGroupNames.includes(g)) {
                ldapOperations.push({
                  type: "post",
                  user: apr.user,
                  group: g,
                  userDN: userDN,
                });
              }
            }

            // Build action object untuk approve
            const actionObj = {
              user: String(apr.user),
              status: "approve",
            };

            if (afterList.length > 0 && beforeList.length > 0) {
              actionObj.action = "move";
              actionObj.before = beforeList.join(", ");
              actionObj.after = afterList.join(", ");
            } else if (afterList.length > 0) {
              actionObj.groupAdd = afterList.join(", ");
              actionObj.groupRemove = "";
            } else if (beforeList.length > 0) {
              actionObj.groupAdd = "";
              actionObj.groupRemove = beforeList.join(", ");
            }

            actionArray.push(actionObj);
          }

          // Step 2: Proses yang REJECT - hanya catat di action array (TIDAK update LDAP)
          for (const apr of rejectedMembers) {
            console.log(
              `\n❌ Processing REJECT for user: ${apr.user} - Skip LDAP operations`
            );

            const beforeList = (apr.before_ || "")
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            const afterList = (apr.after_ || "")
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);

            // Build action object untuk reject
            const actionObj = {
              user: String(apr.user),
              status: "reject",
            };

            if (afterList.length > 0 && beforeList.length > 0) {
              actionObj.action = "move";
              actionObj.before = beforeList.join(", ");
              actionObj.after = afterList.join(", ");
            } else if (afterList.length > 0) {
              actionObj.groupAdd = afterList.join(", ");
              actionObj.groupRemove = "";
            } else if (beforeList.length > 0) {
              actionObj.groupAdd = "";
              actionObj.groupRemove = beforeList.join(", ");
            }

            actionArray.push(actionObj);
          }

          // Step 3: Eksekusi LDAP operations (hanya untuk yang approve)
          if (ldapOperations.length > 0) {
            console.log(
              `\n📋 Total ${ldapOperations.length} operasi LDAP siap dieksekusi...`
            );

            for (const op of ldapOperations) {
              if (op.type === "delete") {
                console.log(`🗑️ Removing ${op.user} from group: ${op.group}`);
                await axios.delete(
                  `${LDAP_API_MANAGE}/groups/${op.group}/memberuid`,
                  {
                    data: { memberUid: op.userDN },
                    headers: { "Content-Type": "application/json" },
                  }
                );
                console.log(`✅ Removed from ${op.group}`);
              } else if (op.type === "post") {
                console.log(`➕ Adding ${op.user} to group: ${op.group}`);
                await axios.post(
                  `${LDAP_API_MANAGE}/groups/${op.group}/memberuid`,
                  { memberUid: op.userDN },
                  { headers: { "Content-Type": "application/json" } }
                );
                console.log(`✅ Added to ${op.group}`);
              }
            }
          } else {
            console.log(
              "\nℹ️ Tidak ada operasi LDAP (semua reject atau tidak ada perubahan)"
            );
          }

          // Step 4: Tentukan status global
          let globalStatus = "Approve";
          if (rejectedMembers.length > 0 && approvedMembers.length > 0) {
            globalStatus = "Partial";
          } else if (
            rejectedMembers.length > 0 &&
            approvedMembers.length === 0
          ) {
            globalStatus = "Reject";
          }

          console.log(`\n📊 Global Status: ${globalStatus}`);

          // Step 5: Update GraphQL dengan action array lengkap (approve + reject)
          const now = new Date();
          const wibTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
          const date_approve = wibTime
            .toISOString()
            .replace("T", " ")
            .split(".")[0];

          const dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
                mutation updateAlokasiApproval($proc_inst_id: String!, $action: jsonb!, $date_approve: timestamp!, $status: String!) {
                  update_alokasi_resource(where: {proc_inst_id: {_eq: $proc_inst_id}}, _set: {action: $action, date_approve: $date_approve, status: $status}) {
                    affected_rows
                  }
                }
              `,
              variables: {
                proc_inst_id: item.proc_inst_id,
                action: actionArray,
                date_approve: date_approve,
                status: globalStatus,
              },
            },
            query: [],
          };

          console.log("📊 Action Array:", JSON.stringify(actionArray, null, 2));

          const responseQuery = await configureQuery(fastify, dataQuery);
          console.log(
            "✅ Response GraphQL Update Alokasi Resource:",
            JSON.stringify(responseQuery, null, 2)
          );

          const instanceId = item.proc_inst_id;

          // Step 6: Build Camunda variable dengan tipe "Manual"
          const actionLogForCamunda = actionArray.map((action) => ({
            ...action,
            tipe: "Manual",
          }));

          // Step 7: Complete Camunda task (baik approve/reject/partial)
          const dataCamunda = {
            type: "complete",
            endpoint: `/engine-rest/task/{taskId}/complete`,
            instance: instanceId,
            variables: {
              variables: {
                actionLog: {
                  value: JSON.stringify(actionLogForCamunda),
                  type: "json",
                },
              },
            },
          };

          console.log(
            "📊 Action Log for Camunda (Manual):",
            JSON.stringify(actionLogForCamunda, null, 2)
          );

          const responseCamunda = await camundaConfig(
            dataCamunda,
            instanceId,
            process
          );
          console.log("✅ Response Camunda:", responseCamunda);
        } catch (error) {
          console.error(
            "⚠️ Rollback otomatis - tidak ada perubahan yang diterapkan"
          );
          throw error;
        }
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
