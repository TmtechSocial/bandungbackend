const camundaConfig = require("../../utils/camunda/camundaConfig");
const axios = require("axios");
const CAMUNDA_API = process.env.CAMUNDA_API;
const LDAP_API_MANAGE = process.env.LDAP_API_MANAGE;
const WHATSAPP_NOTIFICATION = process.env.WHATSAPP_NOTIFICATION;

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];
    console.log("1. Handling onSubmit with data:", data);
    for (const item of data) {
      const today = new Date().toISOString().split("T")[0]; // "2025-10-31"
      try {
        // forget password
        if (item.id_karyawan == "session.uid") {
          try {
            let dataForgetPassword
            try {
              dataForgetPassword = await axios.get(`${LDAP_API_MANAGE}/users/${item.id_karyawan_lupa_password}`);
            } catch (error) {
              if (error.status == 404) {
                throw new Error(`User dengan ID ${item.id_karyawan_lupa_password} tidak ditemukan.`);
              }
            }
            const noTelpForgetPassword = dataForgetPassword.data.sn;


            const dataCamunda = {
              type: "start",
              endpoint: `/engine-rest/process-definition/key/HR_Management.Manage_Password/start`,
              variables: {
                variables: {
                  businessKey: { value: `${item.id_karyawan_lupa_password}:${today}`, type: "string" },
                  type: { value: "forget", type: "string", },
                  clearDuration: { value: "PT5M", type: "string", },
                  id_karyawan: { value: item.id_karyawan_lupa_password, type: "string", },
                },
              },
            };

            const responseCamunda = await camundaConfig(
              dataCamunda,
              process
            );

            console.log("Response Camunda:", responseCamunda);

            results.push({
              camunda: responseCamunda.data,
            });

            const currentPasswordResponse = await axios.post(
              `${WHATSAPP_NOTIFICATION}/rest-api/send-message`,
              {
                phone: noTelpForgetPassword,
                message: `Hai ${item.id_karyawan_lupa_password}\n\nBerikut link untuk mengubah kata sandi Anda.\nTautan ini berlaku hingga 5 menit setelah pesan ini dikirim:\nhttps://mirorim.ddns.net:5010/form?process=HR_Management.Manage_Password.Change_Password&instance=${responseCamunda.data.processInstanceId}`
              },
              {
                headers: {
                  "Content-Type": "application/json",
                },
              }
            );
            console.log("LDAP Forget Password Response:", currentPasswordResponse.data);

          } catch (error) {
            console.error("Error executing forget password process:", error);
            throw error
          }

          // change password
        } else if (item.id_karyawan != "session.uid") {
          try {
            const currentPasswordResponse = await axios.post(
              `${CAMUNDA_API}engine-rest/identity/verify`,
              { username: item.id_karyawan, password: item.password_saat_ini },
              {
                headers: {
                  "Content-Type": "application/json",
                },
              }
            );

            const isAuthenticated = currentPasswordResponse.data.authenticated;

            // Selalu jalankan Camunda process
            const dataCamunda = {
              type: "start",
              endpoint: `/engine-rest/process-definition/key/HR_Management.Manage_Password/start`,
              variables: {
                variables: {
                  businessKey: { value: `${item.id_karyawan}:${today}`, type: "string" },
                  type: { value: "change", type: "string" },
                },
              },
            };

            const responseCamunda = await camundaConfig(
              dataCamunda,
              process
            );
            console.log("Response Camunda:", responseCamunda);

            results.push({
              camunda: responseCamunda.data,
              authenticated: isAuthenticated,
            });

            // Hanya update password jika authentication berhasil
            if (isAuthenticated) {
              const updatePassword = await axios.put(
                `${LDAP_API_MANAGE}/users/${item.id_karyawan}/change-password`,
                { password: item.password_baru },
              );
              console.log("Update Password Response:", updatePassword.data);

              results[results.length - 1].passwordUpdated = true;
            } else {
              console.log("Authentication failed - password not updated");
              throw new Error("Authentication failed");
            }

          } catch (err) {
            console.error("Error in change password process:", err.message);
            throw new Error(`Password saat ini yang anda masukkan salah.`);
          }
        }

      } catch (error) {
        console.error(`Error processing item:`, error.message);
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

