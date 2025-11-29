const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const GRAPHQL_API = process.env.GRAPHQL_API;
const axios = require("axios");
const LDAP_API_MANAGE = process.env.LDAP_API_MANAGE;

const eventHandlers = {
  async onSubmit(data, process) {
    console.log("!!", data);
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

              // Step 3: DELETE dari semua group yang ada (kecuali PKL dan mirorim)
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
                  console.log(`⏭️ Skipping ${group.cn} group`);
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
              // Ambil daftar cn dari current groups user
              const currentGroupNames = currentGroups.map((g) => g.cn);

              let groupsToRemove = [];
              let groupsToAdd = [];
              let actionType = ""; // "add" atau "remove"
              let finalGroups = []; // Group final setelah operasi

              // Tentukan aksi berdasarkan aksiGroup
              if (member.aksiGroup === "remove") {
                // REMOVE: hapus group dari updateGroupMultiRemove
                groupsToRemove = member.updateGroupMultiRemove || [];
                groupsToAdd = [];
                actionType = "remove";

                // Group final = current groups - groups yang dihapus (kecuali PKL dan mirorim tetap)
                finalGroups = currentGroupNames.filter(
                  (g) => !groupsToRemove.includes(g)
                );
              } else if (member.aksiGroup === "add") {
                // ADD: tambah group dari updateGroupMultiAdd
                const groupsToAddAll = member.updateGroupMultiAdd || [];
                groupsToAdd = groupsToAddAll.filter(
                  (g) => !currentGroupNames.includes(g) // hanya yang belum ada
                );
                groupsToRemove = [];
                actionType = "add";

                // Group final = current groups + groups yang ditambah
                finalGroups = [...currentGroupNames, ...groupsToAdd];
              }

              console.log(`➕ Groups to ADD: ${groupsToAdd.join(", ")}`);
              console.log(`🗑️ Groups to REMOVE: ${groupsToRemove.join(", ")}`);
              console.log(
                `🎯 Final groups after ${actionType}: ${finalGroups.join(", ")}`
              );

              // Step 3: DELETE dari groups yang perlu dihapus (kecuali PKL dan mirorim)
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
                  console.log(`⏭️ Skipping ${groupName} group removal`);
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
              if (member.aksiGroup === "add") {
                const alreadyInGroups = (
                  member.updateGroupMultiAdd || []
                ).filter((g) => currentGroupNames.includes(g));
                if (alreadyInGroups.length > 0) {
                  console.log(
                    `ℹ️ User sudah berada di group: ${alreadyInGroups.join(
                      ", "
                    )} (skip POST)`
                  );
                }
              }

              // Build action object untuk non-worker (SAMA FORMAT seperti Staff)
              const actionObj = {
                user: String(member.nama),
                action: actionType, // "add" atau "remove"
                before: member.groupName, // group saat ini (dari form)
                after: finalGroups.join(", "), // group final setelah operasi
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

            console.log(`📋 Before: ${beforeList.join(", ")}`);
            console.log(`📋 After: ${afterList.join(", ")}`);

            // ==================== PERBAIKAN LOGIKA ====================
            // Tentukan tipe aksi berdasarkan perbandingan before_ dan after_
            let actionType = "move"; // default
            let groupsToAdd = [];
            let groupsToRemove = [];

            // Deteksi tipe aksi
            if (beforeList.length > 0 && afterList.length > beforeList.length) {
              // Jika after lebih banyak dari before, kemungkinan ADD
              // Cek apakah semua item di before ada di after
              const allBeforeInAfter = beforeList.every((g) =>
                afterList.includes(g)
              );

              if (allBeforeInAfter) {
                // Ini adalah ADD action
                actionType = "add";
                groupsToAdd = afterList.filter((g) => !beforeList.includes(g));
                groupsToRemove = [];
                console.log(`🔵 Detected action: ADD`);
              } else {
                // Ini adalah MOVE action (ada perubahan group)
                actionType = "move";
                groupsToRemove = beforeList.filter(
                  (g) => !afterList.includes(g)
                );
                groupsToAdd = afterList.filter((g) => !beforeList.includes(g));
                console.log(`🔵 Detected action: MOVE`);
              }
            } else if (beforeList.length > afterList.length) {
              // Jika before lebih banyak dari after, ini adalah REMOVE
              actionType = "remove";
              groupsToRemove = beforeList.filter((g) => !afterList.includes(g));
              groupsToAdd = [];
              console.log(`🔵 Detected action: REMOVE`);
            } else if (beforeList.length === afterList.length) {
              // Jika jumlah sama, cek apakah ada perbedaan
              const isDifferent =
                beforeList.some((g) => !afterList.includes(g)) ||
                afterList.some((g) => !beforeList.includes(g));

              if (isDifferent) {
                // Ada perbedaan = MOVE
                actionType = "move";
                groupsToRemove = beforeList.filter(
                  (g) => !afterList.includes(g)
                );
                groupsToAdd = afterList.filter((g) => !beforeList.includes(g));
                console.log(`🔵 Detected action: MOVE`);
              } else {
                // Tidak ada perubahan
                actionType = "no-change";
                console.log(`🔵 No changes detected`);
              }
            }

            console.log(
              `➕ Groups to ADD: ${groupsToAdd.join(", ") || "none"}`
            );
            console.log(
              `🗑️ Groups to REMOVE: ${groupsToRemove.join(", ") || "none"}`
            );

            // Siapkan operasi DELETE (hanya untuk yang perlu dihapus)
            for (const g of groupsToRemove) {
              if (g === "PKL" || g === "mirorim") {
                console.log(`⏭️ Skipping PKL/mirorim removal for ${g}`);
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

            // Siapkan operasi POST (hanya untuk yang perlu ditambah dan belum ada)
            for (const g of groupsToAdd) {
              if (!currentGroupNames.includes(g)) {
                ldapOperations.push({
                  type: "post",
                  user: apr.user,
                  group: g,
                  userDN: userDN,
                });
              } else {
                console.log(`ℹ️ User sudah berada di group ${g} (skip POST)`);
              }
            }

            // Build action object untuk approve
            const actionObj = {
              user: String(apr.user),
              status: "approve",
              action: actionType,
            };

            // Set before dan after berdasarkan tipe aksi
            if (actionType === "add") {
              // ADD: before = group awal, after = group final (awal + baru)
              actionObj.before = beforeList.join(", ");
              actionObj.after = afterList.join(", ");
            } else if (actionType === "remove") {
              // REMOVE: before = group awal, after = group final (awal - dihapus)
              actionObj.before = beforeList.join(", ");
              actionObj.after = afterList.join(", ");
            } else if (actionType === "move") {
              // MOVE: before = group awal, after = group final (berbeda)
              actionObj.before = beforeList.join(", ");
              actionObj.after = afterList.join(", ");
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

            console.log(`📋 Before: ${beforeList.join(", ")}`);
            console.log(`📋 After: ${afterList.join(", ")}`);

            // Tentukan tipe aksi (sama seperti approve, tapi tidak eksekusi LDAP)
            let actionType = "move"; // default

            if (beforeList.length > 0 && afterList.length > beforeList.length) {
              const allBeforeInAfter = beforeList.every((g) =>
                afterList.includes(g)
              );
              if (allBeforeInAfter) {
                actionType = "add";
                console.log(`🔵 Detected action: ADD (rejected)`);
              } else {
                actionType = "move";
                console.log(`🔵 Detected action: MOVE (rejected)`);
              }
            } else if (beforeList.length > afterList.length) {
              actionType = "remove";
              console.log(`🔵 Detected action: REMOVE (rejected)`);
            } else if (beforeList.length === afterList.length) {
              const isDifferent =
                beforeList.some((g) => !afterList.includes(g)) ||
                afterList.some((g) => !beforeList.includes(g));
              if (isDifferent) {
                actionType = "move";
                console.log(`🔵 Detected action: MOVE (rejected)`);
              } else {
                actionType = "no-change";
                console.log(`🔵 No changes detected (rejected)`);
              }
            }

            // Build action object untuk reject
            const actionObj = {
              user: String(apr.user),
              status: "reject",
              action: actionType,
              before: beforeList.join(", "),
              after: afterList.join(", "),
            };

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

          results.push({
            proc_inst_id: responseCamunda.data.id,
          });
        } catch (error) {
          console.error(
            `❌ Error executing handler for event: approvalAlokasi`,
            error
          );
          console.error(
            "Error details:",
            error.response?.data || error.message
          );
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
