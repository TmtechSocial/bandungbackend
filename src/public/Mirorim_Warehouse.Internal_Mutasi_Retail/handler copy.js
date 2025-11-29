const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const axios = require("axios");
const GRAPHQL_API = process.env.GRAPHQL_API;
const LDAP_API_MANAGE = process.env.LDAP_API_MANAGE;

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];
    for (const {
      clock_out,
      id_karyawan,
      kegiatan,
      aksi,
      cnFromDn,
      delegasiUser,
    } of data) {
      if (kegiatan == "clockOut") {
        try {
          const today = new Date().toISOString().split("T")[0]; // "2025-10-31"
          // POST ke LDAP API untuk clockin
          let ldapResult = null;
          console.log("Clock Out Time:", clock_out);

          try {
            const ldapResponseAttaendace = await axios.post(
              `${LDAP_API_MANAGE}/attendance/delegation-flag`,
              { uid: id_karyawan, delegation: "false" },
              {
                headers: {
                  "Content-Type": "application/json",
                },
              }
            );
            ldapResult = ldapResponseAttaendace;
            console.log("LDAP ClockIn Response:", ldapResult.data);
          } catch (ldapError) {
            console.error("Error calling LDAP API:", ldapError.message);
            ldapResult = { success: false, error: ldapError.message };
          }

          try {
            const ldapResponse = await axios.post(
              `${LDAP_API_MANAGE}/attendance/clockout`,
              { uid: id_karyawan },
              {
                headers: {
                  "Content-Type": "application/json",
                },
              }
            );
            ldapResult = ldapResponse;
            console.log("LDAP ClockIn Response:", ldapResult.data);
          } catch (ldapError) {
            console.error("Error calling LDAP API:", ldapError.message);
            ldapResult = { success: false, error: ldapError.message };
          }

          const dataQueryFirst = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
            mutation updateClockIn($clockOut: String!, $today: String!, $id_karyawan: String!) {
              update_absen(_set: {clock_out: $clockOut}, where: {id_karyawan: {_eq: $id_karyawan}, clock_in: {_ilike: $today}}) {
                affected_rows
                  returning {
                    clock_out
                    clock_in
                }
              }
            }
            `,
              variables: {
                id_karyawan: id_karyawan,
                clockOut: new Date(Date.now() + 7 * 60 * 60 * 1000)
                .toISOString()
                .replace("T", " ")
                .substring(0, 19),
                today: `${today}%`,
              },
            },
            query: [],
          };

          const dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
            mutation updateClockIn($clockOut: String!, $today: String!, $id_karyawan: String!) {
              update_absen(_set: {clock_out: $clockOut}, where: {id_karyawan: {_eq: $id_karyawan}, clock_in: {_ilike: $today}}) {
                affected_rows
                  returning {
                    clock_out
                    clock_in
                }
              }
            }
            `,
              variables: {
                id_karyawan: id_karyawan,
                clockOut: new Date(Date.now() + 7 * 60 * 60 * 1000)
                .toISOString()
                .replace("T", " ")
                .substring(0, 19),
                today: `${today}%`,
              },
            },
            query: [],
          };

          const responseQuery = await configureQuery(fastify, dataQuery, dataQueryFirst);
                    console.log("Responseeeee GraphQL:", JSON.stringify(responseQuery.data, null, 2));  
          console.log("!! Response GraphQL:", dataQuery.graph.variables);

          const dataCamunda = {
            type: "start",
            endpoint: `/engine-rest/process-definition/key/HR_Management.Absensi_New/start`,
            variables: {
              variables: {
                DelegasiClockout: { value: true, type: "boolean" },
                initiatorId: { value: id_karyawan, type: "string" },
              },
            },
          };

          const responseCamunda = await camundaConfig(dataCamunda, process);
          console.log("Response Camunda:", responseCamunda);
        } catch (error) {
          console.error(
            `Error executing handler for event: ${eventKey}`,
            error
          );
          throw error;
        }
      }

      if (aksi == "delegasiSaja") {
        console.log("Delegasi Saja logic here");
        try {
          // Step 0: Get user DN from LDAP for delegated user
          const userUrl = `${LDAP_API_MANAGE}/users/${delegasiUser}`;
          console.log(`Fetching user DN for uid: ${delegasiUser}`);
          const userResponse = await axios.get(userUrl);
          const userDn = userResponse.data.dn;
          console.log(`User DN retrieved: ${userDn}`);

          // Step 0.1: Get current user DN from LDAP (user yang mendelegasikan)
          const currentUserUrl = `${LDAP_API_MANAGE}/users/${id_karyawan}`;
          console.log(`Fetching current user DN for uid: ${id_karyawan}`);
          const currentUserResponse = await axios.get(currentUserUrl);
          const currentUserDn = currentUserResponse.data.dn;
          console.log(`Current User DN retrieved: ${currentUserDn}`);

          // Step 1: Remove current user (User A yang mendelegasikan) from their group FIRST
          const removeCurrentUserUrl = `${LDAP_API_MANAGE}/groups/${cnFromDn}/memberuid`;
          const removeCurrentUserBody = {
            memberUid: currentUserDn,
          };

          console.log(
            `Removing current user ${id_karyawan} from group ${cnFromDn}`
          );
          try {
            await axios.delete(removeCurrentUserUrl, {
              data: removeCurrentUserBody,
            });
            console.log(
              `Successfully removed current user from group ${cnFromDn}`
            );
          } catch (deleteError) {
            console.error(
              `Error removing current user from group ${cnFromDn}:`,
              deleteError.message
            );
          }

          // Step 2: Delete User B from all previous groups
          if (
            data[0].groupSebelumnya &&
            Array.isArray(data[0].groupSebelumnya)
          ) {
            for (const group of data[0].groupSebelumnya) {
              const groupCn = group.groupName || group.cn || group; // Handle groupName, cn, or string formats
              const deleteUrl = `${LDAP_API_MANAGE}/groups/${groupCn}/memberuid`;
              const deleteBody = {
                memberUid: userDn,
              };

              console.log(
                `Deleting user ${delegasiUser} from group ${groupCn}. ${groupCn[0]}`
              );
              try {
                await axios.delete(deleteUrl, { data: deleteBody });
                console.log(`Successfully removed user from group ${groupCn}`);
              } catch (deleteError) {
                console.error(
                  `Error removing user from group ${groupCn}:`,
                  deleteError.message
                );
                // Continue with other groups even if one fails
              }
            }
          }

          // Step 3: Add User B to new group (menggantikan User A)
          const addUrl = `${LDAP_API_MANAGE}/groups/${cnFromDn}/memberuid`;
          const addBody = {
            memberUid: userDn,
          };

          console.log(`Adding user ${delegasiUser} to group ${cnFromDn}`);
          const addResponse = await axios.post(addUrl, addBody);
          console.log(
            `Successfully added user to group ${cnFromDn}:`,
            addResponse.data
          );

          // Step 4: Add flag delegation user B
          const addFlagUrl = `${LDAP_API_MANAGE}/attendance/delegation-flag`;
          const addFlagBody = {
            uid: delegasiUser,
            delegation: "true",
          };

          console.log(`Adding delegation flag for user ${delegasiUser}`);
          const addFlagResponse = await axios.post(addFlagUrl, addFlagBody);
          console.log(
            `Successfully added delegation flag for user ${delegasiUser}:`,
            addFlagResponse
          );

          // Step 5: Remove flag delegation user A
          const removeFlagUrl = `${LDAP_API_MANAGE}/attendance/delegation-flag`;
          const removeFlagBody = {
            uid: id_karyawan,
            delegation: "false",
          };

          console.log(`Removing delegation flag for user ${id_karyawan}`);
          const removeFlagResponse = await axios.post(
            removeFlagUrl,
            removeFlagBody
          );
          console.log(
            `Successfully removed delegation flag for user ${id_karyawan}:`,
            removeFlagResponse
          );

          const dataCamunda = {
            type: "start",
            endpoint: `/engine-rest/process-definition/key/HR_Management.Absensi_New/start`,
            variables: {
              variables: {
                DelegasiClockout: { value: false, type: "boolean" },
                initiatorId: { value: id_karyawan, type: "string" },
              },
            },
          };

          const responseCamunda = await camundaConfig(dataCamunda, process);
          console.log("Response Camunda:", responseCamunda);

          results.push({
            status: "success",
            action: "delegasiSaja",
            delegasiUser,
            userDn,
            currentUserId: id_karyawan,
            currentUserDn,
            newGroup: cnFromDn,
          });
        } catch (error) {
          console.error("Error in delegasiSaja:", error);
          results.push({
            status: "error",
            action: "delegasiSaja",
            error: error.message,
          });
        }
      }

      if (aksi == "delegasiDanClockout") {
        console.log("🔄 Delegasi dan Clockout logic here - DELEGATION FIRST");
        try {
          // ==================== PHASE 1: DELEGATION ====================
          console.log("📋 PHASE 1: Starting Delegation Process...");

          // Step 1: Get user DN from LDAP for delegated user (User B)
          const userUrl = `${LDAP_API_MANAGE}/users/${delegasiUser}`;
          console.log(`Fetching user DN for uid: ${delegasiUser}`);
          const userResponse = await axios.get(userUrl);
          const userDn = userResponse.data.dn;
          console.log(`✅ User B DN retrieved: ${userDn}`);

          // Step 2: Get current user DN from LDAP (User A yang mendelegasikan)
          const currentUserUrl = `${LDAP_API_MANAGE}/users/${id_karyawan}`;
          console.log(`Fetching current user DN for uid: ${id_karyawan}`);
          const currentUserResponse = await axios.get(currentUserUrl);
          const currentUserDn = currentUserResponse.data.dn;
          console.log(`✅ User A DN retrieved: ${currentUserDn}`);

          // Step 3: Remove current user (User A) from their group FIRST
          const removeCurrentUserUrl = `${LDAP_API_MANAGE}/groups/${cnFromDn}/memberuid`;
          const removeCurrentUserBody = {
            memberUid: currentUserDn,
          };

          console.log(
            `🔻 Removing User A (${id_karyawan}) from group ${cnFromDn}`
          );
          await axios.delete(removeCurrentUserUrl, {
            data: removeCurrentUserBody,
          });
          console.log(`✅ Successfully removed User A from group ${cnFromDn}`);

          // Step 4: Delete User B from all previous groups
          if (
            data[0].groupSebelumnya &&
            Array.isArray(data[0].groupSebelumnya)
          ) {
            console.log(`🧹 Cleaning User B from previous groups...`);
            for (const group of data[0].groupSebelumnya) {
              const groupCn = group.groupName || group.cn || group;
              const deleteUrl = `${LDAP_API_MANAGE}/groups/${groupCn}/memberuid`;
              const deleteBody = {
                memberUid: userDn,
              };

              console.log(
                `🔻 Deleting User B (${delegasiUser}) from group ${groupCn}`
              );
              try {
                await axios.delete(deleteUrl, { data: deleteBody });
                console.log(
                  `✅ Successfully removed User B from group ${groupCn}`
                );
              } catch (deleteError) {
                console.error(
                  `⚠️ Error removing User B from group ${groupCn}:`,
                  deleteError.message
                );
                // Continue with other groups even if one fails
              }
            }
          }

          // Step 5: Add User B to new group (menggantikan User A)
          const addUrl = `${LDAP_API_MANAGE}/groups/${cnFromDn}/memberuid`;
          const addBody = {
            memberUid: userDn,
          };

          console.log(
            `➕ Adding User B (${delegasiUser}) to group ${cnFromDn}`
          );
          const addResponse = await axios.post(addUrl, addBody);
          console.log(
            `✅ Successfully added User B to group ${cnFromDn}:`,
            addResponse.data
          );

          // Step 6: Add flag delegation for User B
          const addFlagUrl = `${LDAP_API_MANAGE}/attendance/delegation-flag`;
          const addFlagBody = {
            uid: delegasiUser,
            delegation: "true",
          };

          console.log(`🚩 Adding delegation flag for User B (${delegasiUser})`);
          const addFlagResponse = await axios.post(addFlagUrl, addFlagBody);
          console.log(
            `✅ Successfully added delegation flag for User B:`,
            addFlagResponse.data
          );

          // Step 7: Remove flag delegation for User A
          const removeFlagUrl = `${LDAP_API_MANAGE}/attendance/delegation-flag`;
          const removeFlagBody = {
            uid: id_karyawan,
            delegation: "false",
          };

          console.log(
            `🚩 Removing delegation flag for User A (${id_karyawan})`
          );
          const removeFlagResponse = await axios.post(
            removeFlagUrl,
            removeFlagBody
          );
          console.log(
            `✅ Successfully removed delegation flag for User A:`,
            removeFlagResponse.data
          );

          console.log("✅ PHASE 1: Delegation Completed Successfully!");

          // ==================== PHASE 2: CLOCKOUT ====================
          console.log("🕐 PHASE 2: Starting Clockout Process...");

          // Step 8: POST ke LDAP API untuk clockout
          let ldapClockoutResult = null;
          try {
            const ldapClockoutResponse = await axios.post(
              `${LDAP_API_MANAGE}/attendance/clockout`,
              { uid: id_karyawan },
              {
                headers: {
                  "Content-Type": "application/json",
                },
              }
            );
            ldapClockoutResult = ldapClockoutResponse;
            console.log("✅ LDAP ClockOut Response:", ldapClockoutResult.data);
          } catch (ldapError) {
            console.error(
              "❌ Error calling LDAP clockout API:",
              ldapError.message
            );
            // Jangan throw error, clockout tetap lanjut ke database
            ldapClockoutResult = { success: false, error: ldapError.message };
          }

          // Step 9: Update database - Perform clock out
          const today = new Date().toISOString().split("T")[0];
          const dataQuery = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
            mutation updateClockIn($clock_out: String!, $today: String!, $_eq: String = "") {
              update_absen(_set: {clock_out: $clock_out}, where: {id_karyawan: {_eq: $_eq}, clock_in: {_like: $today}}) {
                affected_rows
              }
            }
            `,
              variables: {
                _eq: id_karyawan,
                clock_out: new Date(Date.now() + 7 * 60 * 60 * 1000)
                .toISOString()
                .replace("T", " ")
                .substring(0, 19),
                today: `${today}%`,
              },
            },
            query: [],
          };

          const responseQuery = await configureQuery(fastify, dataQuery);
          console.log(
            "✅ GraphQL Clock Out Response:",
            responseQuery.data[0].graph
          );

          console.log("✅ PHASE 2: Clockout Completed Successfully!");

          // ==================== PHASE 3: COMPLETE CAMUNDA ====================
          console.log("🎯 PHASE 3: Completing Camunda Process...");

          const dataCamunda = {
            type: "start",
            endpoint: `/engine-rest/process-definition/key/HR_Management.Absensi_New/start`,
            variables: {
              variables: {
                DelegasiClockout: { value: true, type: "boolean" },
                initiatorId: { value: id_karyawan, type: "string" },
              },
            },
          };

          const responseCamunda = await camundaConfig(dataCamunda, process);
          console.log("✅ Camunda Process Started:", responseCamunda);

          console.log("🎉 ALL PHASES COMPLETED SUCCESSFULLY!");

          results.push({
            camunda: responseCamunda.data,
          });
        } catch (error) {
          console.error("❌ Error in delegasiDanClockout:", error);
          console.error("❌ Error details:", error.stack);
          results.push({
            status: "error",
            action: "delegasiDanClockout",
            error: error.message,
            errorStack: error.stack,
          });
          // Re-throw untuk stop process jika delegasi gagal
          throw error;
        }
      }
      if (kegiatan == "rollback") {
        console.log("Rollback logic here");
        try {
          // Step 1: POST ke LDAP API untuk rollback attendance (mengembalikan role)
          let rollbackResult = null;
          try {
            const rollbackResponse = await axios.post(
              `${LDAP_API_MANAGE}/attendance/rollback`,
              { uid: id_karyawan },
              {
                headers: {
                  "Content-Type": "application/json",
                },
              }
            );
            rollbackResult = rollbackResponse;
            console.log("LDAP Rollback Response:", rollbackResult.data);
          } catch (rollbackError) {
            console.error(
              "Error calling LDAP rollback API:",
              rollbackError.message
            );
            rollbackResult = { success: false, error: rollbackError.message };
          }

          // Step 2: Set flag delegation = true (mengembalikan role berarti user kembali aktif dengan delegation)
          const setFlagUrl = `${LDAP_API_MANAGE}/attendance/delegation-flag`;
          const setFlagBody = {
            uid: id_karyawan,
            delegation: "true",
          };

          console.log(
            `Setting delegation flag to TRUE for user ${id_karyawan} (rollback)`
          );
          const setFlagResponse = await axios.post(setFlagUrl, setFlagBody);
          console.log(
            `Successfully set delegation flag to TRUE for user ${id_karyawan}:`,
            setFlagResponse.data
          );

          // Step 3: Start Camunda process
          const dataCamunda = {
            type: "start",
            endpoint: `/engine-rest/process-definition/key/HR_Management.Absensi_New/start`,
            variables: {
              variables: {
                DelegasiClockout: { value: false, type: "boolean" },
                initiatorId: { value: id_karyawan, type: "string" },
              },
            },
          };

          const responseCamunda = await camundaConfig(dataCamunda, process);
          console.log("Response Camunda:", responseCamunda);

          results.push({
            camunda: responseCamunda.data,
          });
        } catch (error) {
          console.error("Error in rollback:", error);
          results.push({
            status: "error",
            action: "rollback",
            error: error.message,
          });
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