const axios = require("axios"); // Pastikan axios sudah terinstal
require("dotenv").config();
const { Client } = require("pg");
const { DB_USER, DB_PASSWORD, DB_HOST, DB_PORT } = process.env;
const path = require("path");
const fs = require("fs");

async function configureProcess(fastify, processName) {
  const connectionString = `postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/db_configure_form`;

  // Membuat instance Client baru
  const client = new Client({
    connectionString: connectionString,
  });

  try {
    // Menyambung ke database
    await client.connect();

    // Menjalankan query
    const res = await client.query(
      `SELECT event_json, schema_json, schema_grid_json FROM db_conf_task_form WHERE task_def_key = $1`,
      [processName]
    );

    return res.rows; // Mengembalikan hasil query
  } catch (error) {
    console.error("Error querying database:", error);
    throw new Error("Failed to configure process");
  } finally {
    // Pastikan koneksi selalu dilepaskan
    await client.end();
  }
}

async function configureQuery(fastify, request) {
  const { graph, query } = request;

  if (!graph && !query) {
    return { status: 400, message: "query or graph parameter is required" };
  }

  try {
    let results = []; // Pastikan hanya mendeklarasikan 'results' sekali

    //console.log("query", query);
    //console.log("graph", JSON.stringify(graph, null, 2));
    const { method, gqlQuery, endpoint, variables } = graph;

    // if (!endpoint || !gqlQuery) {
    //   return {
    //     status: 400,
    //     message: "GraphQL endpoint and gqlQuery are required",
    //   };
    // }
    // Handle GraphQL query
    if (graph) {
      if (method) {
        const validMethods = ["query", "mutate"];
        if (!validMethods.includes(method)) {
          return {
            status: 400,
            message: "Only GraphQL query or mutate method is supported",
          };
        }
        const gqlResponse = await axios.post(endpoint, {
          query: gqlQuery,
          variables: variables || {},
        });

        //console.log("gqlResponse baru", gqlResponse.data);
        //console.log("gqlResponse baru", JSON.stringify(gqlResponse.data, null, 2));

        results.push({
          graph: gqlResponse.data.data, // Menyimpan hasil GraphQL response
        }); // Menyimpan hasil GraphQL response
      }
    }

    // Handle SQL queries
    if (query && Array.isArray(query)) {
      for (const sqlRequest of query) {
        const { db, table, method, sqlQuery, paramQuery } = sqlRequest;
        const validMethods = ["SELECT", "INSERT", "UPDATE", "DELETE"];
        if (!validMethods.includes(method)) {
          return {
            status: 400,
            message: `Method for table ${table} must be one of SELECT, INSERT, UPDATE, DELETE`,
          };
        }

        if (!table || !db || !sqlQuery) {
          return {
            status: 400,
            message: "Each query must specify table, db, and sqlQuery",
          };
        }

        const connectionString = `postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${db}`;

        // Membuat instance Client baru
        const client = new Client({
          connectionString: connectionString,
        });

        try {
          await client.connect();
          const { rows } = await client.query(
            sqlQuery,
            paramQuery ? [paramQuery] : []
          );

          const queryResponse = {
            table,
            data: rows,
          };

          // Menyimpan hasil query dalam array hasil
          results.push({
            sqlQuery: {
              table: table,
              data: rows, // Hasil query untuk tabel ini
            },
          });
        } catch (error) {
          console.error(
            `Error executing SQL for table ${table} on db ${db}:`,
            error
          );
          // Menyimpan error jika ada masalah pada query SQL
          results.push({
            sqlQuery: {
              table: table,
              error: `Failed to execute SQL for table ${table}`, // Menyimpan pesan error
            },
          });
        } finally {
          await client.end(); // Pastikan koneksi selalu dilepaskan
        }
      }
    }

    return { data: results };
  } catch (error) {
    console.error("Error in configureQuery:", error);
    throw new Error("Failed to execute query");
  }
}

async function configureHandler(fastify, request) {
  const { process, body } = request;

  //console.log("request", request);

  // Cek apakah parameter process dan body ada
  if (!process || !body) {
    return { status: 400, message: "process or body parameter is required" };
  }

  try {
    const eventPath = path.join(
      __dirname,
      "..",
      "public",
      process,
      "handler.js"
    );

    // Ambil eventKey dan data dari body request
    const { eventKey, data } = body;

    // Cek apakah file handler.js ada
    if (!fs.existsSync(eventPath)) {
      return {
        status: 404,
        message: `Handler not found for process: ${process}`,
      };
    }

    // Require file handler.js
    const eventHandler = require(eventPath);

    // Pastikan handler memiliki fungsi handle
    if (typeof eventHandler.handle !== "function") {
      return {
        status: 500,
        message: `Handler for process: ${process} does not have a valid handle function`,
      };
    }

    // Panggil fungsi handle dan tunggu hasilnya
    const responseData = await eventHandler.handle({ eventKey, data, process });

    // Kembalikan respon sukses
    return { message: "Event processed successfully", data: responseData };
  } catch (error) {
    // Tangani error yang mungkin terjadi
    console.error("Error in configureHandler:", error);
    return {
      status: 500,
      message: "An error occurred while processing the event",
      error: error.message,
    };
  }
}

module.exports = {
  configureProcess,
  configureQuery,
  configureHandler,
};
