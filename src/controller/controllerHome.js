require("dotenv").config();
const { Client } = require("pg");
const { DB_USER, DB_PASSWORD, DB_HOST, DB_PORT } = process.env;

async function getDynamicHome(fastify) {
  const connectionString = `postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/db_configure_form`;
  const client = new Client({ connectionString });

  try {
    await client.connect();

    const query = `
      SELECT proc_def_key AS process, icon_id AS icon
      FROM db_conf_proc_form
      ORDER BY proc_def_key
    `;

    const result = await client.query(query);

    return result.rows;
  } catch (error) {
    throw new Error("Gagal mengambil data dynamic home: " + error.message);
  } finally {
    await client.end();
  }
}

module.exports = { getDynamicHome };
