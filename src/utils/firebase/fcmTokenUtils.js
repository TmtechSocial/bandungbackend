const axios = require("axios");

const HASURA_GRAPHQL_ENDPOINT = process.env.GRAPHQL_API;

async function updateKaryawanFcmToken(id_karyawan, token) {
  if (!HASURA_GRAPHQL_ENDPOINT) {
    throw new Error("HASURA_GRAPHQL_ENDPOINT or HASURA_ADMIN_SECRET not set in env");
  }
  const mutation = `
    mutation UpdateKaryawanToken($id: String!, $token: String!) {
      update_karyawan(where: {id_karyawan: {_eq: $id}}, _set: {token: $token}) {
        affected_rows
      }
    }
  `;
  const variables = { id: id_karyawan, token };
  try {
    const response = await axios.post(
      HASURA_GRAPHQL_ENDPOINT,
      {
        query: mutation,
        variables,
      }
    );
    return response.data;
  } catch (err) {
    console.error("GraphQL update token error:", err.response?.data || err.message);
    throw err;
  }
}

module.exports = { updateKaryawanFcmToken };
