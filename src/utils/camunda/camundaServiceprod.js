const fastify = require("fastify")();
const dotenv = require("dotenv");
const axios = require("axios");

const { Pool } = require("pg");

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_INVENTREE, // inventree
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || "5432"),
});

dotenv.config();

const CAMUNDA_API = process.env.CAMUNDA_API;
const GRAPHQL_API = process.env.GRAPHQL_API;
const { configureQuery } = require("../../controller/controllerConfig");

console.log("CAMUNDA_API:", CAMUNDA_API);
console.log("GRAPHQL_API:", GRAPHQL_API);

import("camunda-external-task-client-js").then(
    ({ Client, logger, Variables }) => {
        const config = {
            baseUrl: `http://localhost:8080/engine-rest`,
            use: logger,
            asyncResponseTimeout: 100,
        };

        const client = new Client(config);
        console.log("Client berhasil diinisialisasi.");

        client.on("error", (err) => {
            console.error("Camunda Client Error:", err);
        });

    client.subscribe("ServiceRefillToko", async ({ task, taskService }) => {
        try {
          const proc_inst_id = task.processInstanceId;
          const inventree = axios.create({
            baseURL: `${process.env.SERVER_INVENTREE}/api`,
            headers: {
              Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
            },
          });

          const { data } = await configureQuery(fastify, {
            graph: {
              method: "query",
              endpoint: process.env.GRAPHQL_API,
              gqlQuery: `query ($proc_inst_id: String!) {
                mo_refill(where: {proc_inst_id: {_eq: $proc_inst_id}}) {
                  id
                  quantity_approve
                  stock_pk_resource
                  destination_location_id
                  sku
                  warehouse_sku
                  part_id
                }
              }`,
              variables: { proc_inst_id },
            },
          });

          const refill = data[0]?.graph?.mo_refill?.[0];
          console.log("Data Refill:", refill);

          if (!refill) throw new Error("Refill ID tidak ditemukan");

          const getLastQty = async (key) => {
            const res = await configureQuery(fastify, {
              graph: {
                method: "query",
                endpoint: process.env.GRAPHQL_API,
                gqlQuery: `query($id:Int!,$key:String!){
                  mo_refill_detail(
                    where:{refill_id:{_eq:$id},task_def_key:{_eq:$key}}
                    order_by:{id:desc} limit:1
                  ){quantity}}`,
                variables: { id: refill.id, key },
              },
            });
            return res?.data?.[0]?.graph?.mo_refill_detail?.[0]?.quantity ?? null;
          };

          const sku = refill.sku;
          const skugudang = refill.warehouse_sku;
          const approve = refill.quantity_approve ?? 0;
          const qCompare = await getLastQty("Mirorim_Operasional.Refill.Compare_Refill");
          const qQc = await getLastQty("Mirorim_Operasional.Refill.QC_Refill");
          const qWasit = await getLastQty("Mirorim_Operasional.Refill.Adjusment_Refill");

          const adjCompare = qCompare != null ? qCompare - approve : 0;
          const adjQc = qQc != null && qCompare != null ? qQc - qCompare : 0;
          const adjWasit = qWasit != null && qQc != null ? qWasit - qQc : 0;
          const refill_qty = approve + adjCompare + adjQc + adjWasit;

          console.log({
            approve,
            qCompare,
            qQc,
            qWasit,
            adjCompare,
            adjQc,
            adjWasit,
            refill_qty,
          });

          // 🔎 Cek history dulu sebelum eksekusi
          const checkHistory = async (itemPk, notes) => {
            try {
              const res = await inventree.get("/stock/track/", {
                params: { item: itemPk, search: notes },
              });
              return res?.data?.count > 0;
            } catch (err) {
              console.error("Error checkHistory:", err.message);
              return false;
            }
          };

          const postAdj = async (val, label, formula) => {
            if (!val) return;
            const notes = `Adjustment ${label} | Rumus: ${formula} | Hasil: ${val} | Proc Inst ID: ${proc_inst_id}`;
            const already = await checkHistory(refill.stock_pk_resource, notes);
            if (already) {
              console.log(`⚠️ Skip postAdj ${label}, sudah ada di history`);
              return;
            }
            return inventree.post(`/stock/${val > 0 ? "add" : "remove"}/`, {
              items: [{ pk: refill.stock_pk_resource, quantity: Math.abs(val) }],
              notes,
            });
          };

          // Adjustment posts
          await postAdj(adjCompare, "QC Gudang", `Compare (${qCompare}) - Approve (${approve})`);
          await postAdj(adjQc, "Toko", `QC (${qQc}) - Compare (${qCompare})`);
          await postAdj(adjWasit, "Wasit", `Wasit (${qWasit}) - QC (${qQc})`);

          // Final remove
          const notesRemove = `Refill Final ke ${sku} dari ${skugudang} | Proc Inst ID: ${proc_inst_id}`;
          const alreadyRemove = await checkHistory(refill.stock_pk_resource, notesRemove);
          if (!alreadyRemove) {
            await inventree.post("/stock/remove/", {
              items: [{ pk: refill.stock_pk_resource, quantity: refill_qty }],
              notes: notesRemove,
            });
          } else {
            console.log("⚠️ Skip final remove, sudah ada di history");
          }

          // Final add
          const dest = await inventree.get("/stock/", {
            params: { location: refill.destination_location_id },
          });
          const dest_pk = dest.data.results[0].pk;
          console.log("dest_pk", dest_pk);

          const notesAdd = `Refill Final ke ${sku} dari ${skugudang} | Proc Inst ID: ${proc_inst_id}`;
          const alreadyAdd = await checkHistory(dest_pk, notesAdd);
          if (!alreadyAdd) {
            await inventree.post("/stock/add/", {
              items: [{ pk: dest_pk, quantity: refill_qty }],
              notes: notesAdd,
            });
          } else {
            console.log("⚠️ Skip final add, sudah ada di history");
          }

          // QC detail
          const resQc = await configureQuery(fastify, {
            graph: {
              method: "query",
              endpoint: process.env.GRAPHQL_API,
              gqlQuery: `query($id:Int!){
                mo_refill_detail(
                  where:{refill_id:{_eq:$id},task_def_key:{_eq:"Mirorim_Operasional.Refill.QC_Refill"}}
                  order_by:{id:desc} limit:1
                ){quantity_physical, quantity_data}}`,
              variables: { id: refill.id },
            },
          });
          const qcDetail = resQc?.data?.[0]?.graph?.mo_refill_detail?.[0];
          const isValid = qcDetail && qcDetail.quantity_data === qcDetail.quantity_physical;

          const partRes = await inventree.get(`/part/${refill.part_id}/`);
          const product_name = partRes?.data?.full_name ?? "Unknown Product";

          // format date
          const date = new Date();
          const formatter = new Intl.DateTimeFormat("id-ID", {
            timeZone: "Asia/Jakarta",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          });
          const parts = formatter.formatToParts(date);
          const formatted = `${parts.find((p) => p.type === "year").value}-${parts.find((p) => p.type === "month").value}-${parts.find((p) => p.type === "day").value} ${parts.find((p) => p.type === "hour").value}:${parts.find((p) => p.type === "minute").value}:${parts.find((p) => p.type === "second").value}`;

          console.log({ isValid, product_name, formatted });

          // Update GraphQL status
          const dataUpdate = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `mutation MyMutation($proc_inst_id: String!, $status: String!) {
                update_mo_refill(
                  where: { proc_inst_id: { _eq: $proc_inst_id } },
                  _set: { status: $status }
                ) {
                  affected_rows
                }
              }`,
              variables: {
                proc_inst_id: proc_inst_id,
                status: "Completed",
              },
            },
            query: [],
          };

          await configureQuery(fastify, dataUpdate);

          // variables ke camunda
          const variables = new Variables();
          variables.set("product_name", product_name);
          variables.set("location_id", refill.destination_location_id);
          variables.set("date", formatted);
          variables.set("part_id", refill.part_id);
          variables.set("ownership", "toko");
          variables.set("type", "Refill");
          variables.set("isValid", isValid);
          await taskService.complete(task, variables);
        } catch (e) {
          console.error("❌ Error:", e.message);
          await taskService.handleFailure(task, {
            errorMessage: e.message,
            errorDetails: e.stack,
            retries: 0,
            retryTimeout: 1000,
          });
        }
      });


    //     client.subscribe("Mutasi_Inventory", async function ({ task, taskService }) {
    //     console.log("Task Dijalankan:", task.id);

    //     try {
    //       const proc_inst_id = task.processInstanceId;

    //       // 1. Ambil data refill dari GraphQL
    //       const dataQuery = {
    //         graph: {
    //           method: "query",
    //           endpoint: GRAPHQL_API,
    //           gqlQuery: `query MyQuery($proc_inst_id: [String!]) {
    //       mo_refill(where: {proc_inst_id: {_in: $proc_inst_id}}, order_by: {created_at: asc}) {
    //         quantity_approve
    //         stock_pk_resource
    //         quantity_approval
    //         destination_location_id
    //         sku
    //         part_id
    //       }
    //     }`,
    //           variables: {
    //             proc_inst_id: [proc_inst_id],
    //           },
    //         },
    //         query: [],
    //       };

    //       const responseQuery = await configureQuery(fastify, dataQuery);
    //       const refills = responseQuery?.data?.[0]?.graph?.mo_refill;
    //       const refill = refills?.[refills.length - 1];
    //       if (!refill)
    //         throw new Error("❌ Data refill tidak ditemukan dari GraphQL");

    //       const {
    //         stock_pk_resource,
    //         destination_location_id,
    //         sku,
    //         quantity_approval,
    //         quantity_approve,
    //         part_id,
    //       } = refill;

    //       // 2. GET stok di lokasi tujuan (toko)
    //       const locationResponse = await axios.get(
    //         `${
    //           process.env.SERVER_INVENTREE
    //         }/api/stock/?location=${encodeURIComponent(
    //           destination_location_id
    //         )}&part=${encodeURIComponent(part_id)}`,
    //         {
    //           headers: {
    //             Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
    //           },
    //         }
    //       );

    //       const locations = locationResponse.data.results || [];
    //       const locationStock = locations[0];
    //       console.log("🔍 Lokasi stok tujuan:", locationStock);

    //       if (!locationStock)
    //         throw new Error("❌ Tidak ada stock tersedia di lokasi tujuan");

    //       // 3. Remove stok gudang
    //       const payloadGudang = {
    //         items: [
    //           {
    //             pk: stock_pk_resource,
    //             quantity: Math.abs(quantity_approve),
    //           },
    //         ],
    //         notes: `Refill ke sku ${sku} | Proc ID: ${proc_inst_id}`,
    //       };

    //       const removeRes = await axios.post(
    //         `${process.env.SERVER_INVENTREE}/api/stock/remove/`,
    //         payloadGudang,
    //         {
    //           headers: {
    //             Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
    //             "Content-Type": "application/json",
    //           },
    //         }
    //       );
    //       console.log(
    //         "🔻 Koreksi stok dikurangi Untuk Gudang:",
    //         removeRes.data
    //       );

    //       // 4. Add stok toko
    //       if (!locationStock?.pk || isNaN(locationStock.pk)) {
    //         throw new Error(
    //           `❌ PK lokasi tidak valid: ${JSON.stringify(locationStock)}`
    //         );
    //       }

    //       const payloadToko = {
    //         items: [
    //           {
    //             pk: locationStock.pk,
    //             quantity: Math.abs(quantity_approve),
    //           },
    //         ],
    //         notes: `Refill ke sku ${sku} | Proc ID: ${proc_inst_id}`,
    //       };

    //       console.log(
    //         "📦 Payload ke InvenTree:",
    //         JSON.stringify(payloadToko, null, 2)
    //       );

    //       const addRes = await axios.post(
    //         `${process.env.SERVER_INVENTREE}/api/stock/add/`,
    //         payloadToko,
    //         {
    //           headers: {
    //             Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
    //             "Content-Type": "application/json",
    //           },
    //         }
    //       );
    //       console.log("🔺 Penambah stok toko:", addRes.data);

    //       // 5. Adjustment jika selisih quantity
    //       if (quantity_approve !== quantity_approval) {
    //         const selisih = quantity_approve - quantity_approval;
    //         console.log("⚖️ Perlu Adjustment Packaging:", selisih);

    //         const stockResponse = await axios.get(
    //           `${process.env.SERVER_INVENTREE}/api/stock/?location=${destination_location_id}&part=${part_id}&ordering=updated`,
    //           {
    //             headers: {
    //               Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
    //             },
    //           }
    //         );

    //         const stockList = stockResponse?.data?.results || [];
    //         const validStocks = stockList
    //           .filter((item) => item.updated !== null)
    //           .sort((a, b) => new Date(b.updated) - new Date(a.updated));

    //         const latestStock = validStocks[0];
    //         if (!latestStock)
    //           throw new Error("❌ Tidak menemukan stock valid untuk koreksi");

    //         const adjustPayload = {
    //           items: [
    //             {
    //               pk: latestStock.pk,
    //               quantity: Math.abs(selisih),
    //             },
    //           ],
    //           notes: `Adjustment Packaging | Proc ID: ${proc_inst_id}`,
    //         };

    //         if (selisih > 0) {
    //           const res = await axios.post(
    //             `${process.env.SERVER_INVENTREE}/api/stock/remove/`,
    //             adjustPayload,
    //             {
    //               headers: {
    //                 Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
    //                 "Content-Type": "application/json",
    //               },
    //             }
    //           );
    //           console.log("🔻 Koreksi stok dikurangi:", res.data);
    //         } else {
    //           const res = await axios.post(
    //             `${process.env.SERVER_INVENTREE}/api/stock/add/`,
    //             adjustPayload,
    //             {
    //               headers: {
    //                 Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
    //                 "Content-Type": "application/json",
    //               },
    //             }
    //           );
    //           console.log("🔺 Koreksi stok ditambahkan:", res.data);
    //         }
    //       } else {
    //         console.log("ℹ️ Tidak ada selisih, stok sudah sesuai.");
    //       }

    //       // ✅ Selesaikan task
    //       await taskService.complete(task);
    //       console.log(`✅ Task ${task.id} berhasil diselesaikan.`);
    //     } catch (error) {
    //       if (error.response) {
    //         console.error(
    //           "❌ Gagal memproses task:",
    //           error.response.status,
    //           error.response.data
    //         );
    //       } else {
    //         console.error("❌ Gagal memproses task:", error.message);
    //       }
    //     }
    //   }
    // );

        client.subscribe("Remove_Stock", async function ({ task, taskService }) {
            console.log("Task Dijalankan:", task.id);

            try {
                const proc_inst_id = task.processInstanceId;
                const invoice = task.variables.get("invoice");

                // 1. Ambil data pesanan dari GraphQL
                const dataQuery = {
                    graph: {
                        method: "query",
                        endpoint: GRAPHQL_API,
                        gqlQuery: `query MyQuery($proc_inst_id: [String!]) {
          mo_order_shop(where: {proc_inst_id: {_in: $proc_inst_id}}) {
            proc_inst_id
            invoice
            sku_toko
            quantity_convert
          }
        }`,
                        variables: {
                            proc_inst_id: [proc_inst_id],
                        },
                    },
                    query: [],
                };

                const responseQuery = await configureQuery(fastify, dataQuery);
                const ordersData = responseQuery.data;
                console.log("ordersData", ordersData);

                if (
                    !ordersData ||
                    ordersData.length === 0 ||
                    !ordersData[0].graph.mo_order_shop.length
                ) {
                    throw new Error(
                        "Data pesanan tidak ditemukan untuk proc_inst_id: " + proc_inst_id
                    );
                }

                const orders = ordersData[0].graph.mo_order_shop;
                console.log("orders", orders);
                const items = [];

                for (const order of orders) {
                    const rawSku = order.sku_toko;
                    const sku_toko = rawSku.split("-")[0]; // Parsing: ambil sebelum "-"
                    const quantity_convert = order.quantity_convert;
                    console.log("order", order, "parsed sku_toko:", sku_toko);

                    // Cari semua lokasi yang cocok
                    const locationResponse = await axios.get(
                        `${process.env.SERVER_INVENTREE
                        }/api/stock/location/?name=${encodeURIComponent(sku_toko)}`,
                        {
                            headers: {
                                Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                            },
                        }
                    );

                    console.log("locationResponse", locationResponse.data);

                    const locations = locationResponse.data.results || [];

                    if (!locations || locations.length === 0) {
                        console.warn(`❗ Lokasi tidak ditemukan untuk SKU: ${sku_toko}`);
                        continue;
                    }

                    for (const location of locations) {
                        const pkLocation = location.pk;

                        // Ambil semua stok di lokasi tersebut
                        const stockResponse = await axios.get(
                            `${process.env.SERVER_INVENTREE}/api/stock/?location=${pkLocation}&cascade=false`,
                            {
                                headers: {
                                    Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                                },
                            }
                        );

                        console.log("stockResponse", stockResponse.data);

                        const stockItems = stockResponse.data.results || [];

                        if (!stockItems || stockItems.length === 0) {
                            console.warn(`❗ Tidak ada stok di lokasi PK: ${pkLocation}`);
                            continue;
                        }

                        // Tambahkan semua stok item ke daftar items
                        for (const stockItem of stockItems) {
                            items.push({
                                pk: stockItem.pk,
                                quantity: quantity_convert, // Gunakan quantity_convert
                            });
                        }
                    }
                }

                if (items.length === 0) {
                    throw new Error("Tidak ada item yang bisa dikurangi dari stok.");
                }

                // Payload pengurangan stok
                const payload = {
                    items,
                    notes: `Order Invoice ${invoice}`,
                };

                // Kirim permintaan ke InvenTree
                const removeStockResponse = await axios.post(
                    `${process.env.SERVER_INVENTREE}/api/stock/remove/`,
                    payload,
                    {
                        headers: {
                            Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                            "Content-Type": "application/json",
                        },
                    }
                );

                console.log("✅ Pengurangan stok berhasil:", removeStockResponse.data);
                await taskService.complete(task);
                console.log(`✅ Task ${task.id} berhasil diselesaikan.`);
            } catch (error) {
                if (error.response) {
                    console.error(
                        "❌ Gagal memproses task:",
                        error.response.status,
                        error.response.data
                    );
                } else {
                    console.error("❌ Gagal memproses task:", error.message);
                }
            }
        });

        client.subscribe("Add_Stock", async function ({ task, taskService }) {
            console.log("Task Dijalankan:", task.id);

            try {
                const proc_inst_id = task.processInstanceId;
                const invoice = task.variables.get("invoice");

                // 1. Ambil data pesanan dari GraphQL
                const dataQuery = {
                    graph: {
                        method: "query",
                        endpoint: GRAPHQL_API,
                        gqlQuery: `query MyQuery($proc_inst_id: [String!]) {
              mo_order_shop(where: {proc_inst_id: {_in: $proc_inst_id}}) {
                proc_inst_id
                invoice
                sku_toko
                quantity_order
              }
            }`,
                        variables: {
                            proc_inst_id: [proc_inst_id],
                        },
                    },
                    query: [],
                };

                const responseQuery = await configureQuery(fastify, dataQuery);
                const ordersData = responseQuery.data;
                console.log("ordersData", ordersData);

                if (
                    !ordersData ||
                    ordersData.length === 0 ||
                    !ordersData[0].graph.mo_order_shop.length
                ) {
                    throw new Error(
                        "Data pesanan tidak ditemukan untuk proc_inst_id: " + proc_inst_id
                    );
                }

                const orders = ordersData[0].graph.mo_order_shop;
                const items = [];

                for (const order of orders) {
                    const { sku_toko, quantity_order } = order;

                    // Cari semua lokasi yang cocok
                    const locationResponse = await axios.get(
                        `${process.env.SERVER_INVENTREE
                        }/api/stock/location/?name=${encodeURIComponent(sku_toko)}`,
                        {
                            headers: {
                                Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                            },
                        }
                    );

                    console.log("locationResponse", locationResponse.data);

                    const locations = locationResponse.data.results || [];

                    if (!locations || locations.length === 0) {
                        console.warn(`❗ Lokasi tidak ditemukan untuk SKU: ${sku_toko}`);
                        continue;
                    }

                    for (const location of locations) {
                        const pkLocation = location.pk;

                        // Ambil semua stok di lokasi tersebut
                        const stockResponse = await axios.get(
                            `${process.env.SERVER_INVENTREE}/api/stock/?location=${pkLocation}&cascade=false`,
                            {
                                headers: {
                                    Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                                },
                            }
                        );

                        console.log("stockResponse", stockResponse.data);

                        const stockItems = stockResponse.data.results || [];

                        if (!stockItems || stockItems.length === 0) {
                            console.warn(`❗ Tidak ada stok di lokasi PK: ${pkLocation}`);
                            continue;
                        }

                        // Tambahkan semua stok item ke daftar items
                        for (const stockItem of stockItems) {
                            items.push({
                                pk: stockItem.pk,
                                quantity: quantity_order, // Atur sesuai strategi distribusi
                            });
                        }
                    }
                }

                if (items.length === 0) {
                    throw new Error("Tidak ada item yang bisa ditambah dari stok.");
                }

                // Payload pengurangan stok
                const payload = {
                    items,
                    notes: `Cancel Invoice ${invoice}`,
                };

                // Kirim permintaan ke InvenTree
                const removeStockResponse = await axios.post(
                    `${process.env.SERVER_INVENTREE}/api/stock/add/`,
                    payload,
                    {
                        headers: {
                            Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                            "Content-Type": "application/json",
                        },
                    }
                );

                console.log("✅ Penambahan stok berhasil:", removeStockResponse.data);
                await taskService.complete(task);
                console.log(`✅ Task ${task.id} berhasil diselesaikan.`);
            } catch (error) {
                if (error.response) {
                    console.error(
                        "❌ Gagal memproses task:",
                        error.response.status,
                        error.response.data
                    );
                } else {
                    console.error("❌ Gagal memproses task:", error.message);
                }
            }
        });

        client.subscribe("Update_API", async function ({ task, taskService }) {
            console.log("Task Dijalankan:", task.id);
            try {
                const proc_inst_id = task.processInstanceId;
                // Ambil data dropship yang status Correction
                const dataQuery = {
                    graph: {
                        method: "query",
                        endpoint: GRAPHQL_API,
                        gqlQuery: `query MyQuery($proc_inst_id: [String!]) {
          mo_dropship(where: {
            _and: [
              { proc_inst_id: { _in: $proc_inst_id } }
            ]
          }) {
            proc_inst_id
            invoice
            sku
          }
        }`,
                        variables: {
                            proc_inst_id: [proc_inst_id],
                        },
                    },
                    query: [],
                };

                const responseQuery = await configureQuery(fastify, dataQuery);
                const ordersData = responseQuery.data;

                if (
                    !ordersData ||
                    ordersData.length === 0 ||
                    !ordersData[0].graph.mo_dropship.length
                ) {
                    throw new Error(
                        "Data pesanan tidak ditemukan untuk proc_inst_id: " + proc_inst_id
                    );
                }

                const orders = ordersData[0].graph.mo_dropship;

                for (const order of orders) {
                    const { sku } = order;

                    const locationResponse = await axios.get(
                        `${process.env.SERVER_INVENTREE
                        }/api/stock/location/?name=${encodeURIComponent(sku)}`,
                        {
                            headers: {
                                Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                            },
                        }
                    );

                    const locations = locationResponse.data.results || [];

                    if (!locations || locations.length === 0) {
                        console.warn(`❗ Lokasi tidak ditemukan untuk SKU: ${sku}`);
                        continue;
                    }

                    for (const location of locations) {
                        const pkLocation = location.pk;

                        const stockResponse = await axios.get(
                            `${process.env.SERVER_INVENTREE}/api/stock/?location=${pkLocation}&cascade=false`,
                            {
                                headers: {
                                    Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                                },
                            }
                        );
                        const stocks = stockResponse.data.results || [];

                        for (const stock of stocks) {
                            const partPk = stock.part;
                            console.log(`📦 SKU: ${sku} | Part: ${partPk}`);

                            // Update part_pk untuk order ini
                            const dataUpdate = {
                                graph: {
                                    method: "mutate",
                                    endpoint: GRAPHQL_API,
                                    gqlQuery: `mutation MyMutation($proc_inst_id: String!, $sku: String!, $part_pk: Int!) {
                update_mo_dropship(
                  where: {
                    proc_inst_id: { _eq: $proc_inst_id },
                    sku: { _eq: $sku }
                  },
                  _set: {
                    part_pk: $part_pk
                  }
                ) {
                  affected_rows
                }
              }`,
                                    variables: {
                                        proc_inst_id: order.proc_inst_id,
                                        sku: sku,
                                        part_pk: partPk,
                                    },
                                },
                                query: [],
                            };

                            await configureQuery(fastify, dataUpdate);
                        }
                    }
                }

                await taskService.complete(task);
            } catch (error) {
                console.error(
                    "❌ Terjadi kesalahan saat memproses task:",
                    error.message
                );
                await taskService.handleFailure(task, {
                    errorMessage: error.message,
                    errorDetails: error.stack,
                    retries: 0,
                    retryTimeout: 1000,
                });
            }
        });

                  client.subscribe("Insert_Dropship", async function ({ task, taskService }) {
            console.log("Task Dijalankan:", task.id);
            try {
              const proc_inst_id = task.processInstanceId;
              const instance_dropship = task.variables.get("instance_id");

              const dataQuery = {
                graph: {
                  method: "query",
                  endpoint: GRAPHQL_API,
                  gqlQuery: `
                    query MyQuery($proc_inst_id: [String!]) {
                      mo_dropship(where: {
                        proc_inst_id: { _in: $proc_inst_id }
                      }) {
                        part_pk
                        invoice
                        resi
                        sku
                        quantity
                        courier_name
                      }
                    }
                  `,
                  variables: {
                    proc_inst_id: instance_dropship,
                  },
                },
                query: [],
              };

              const responseQuery = await configureQuery(fastify, dataQuery);
              const ordersData = responseQuery.data;

              if (
                !ordersData ||
                ordersData.length === 0 ||
                !ordersData[0].graph.mo_dropship.length
              ) {
                throw new Error(
                  "Data pesanan tidak ditemukan untuk proc_inst_id: " + proc_inst_id
                );
              }

              const orders = ordersData[0].graph.mo_dropship;
              console.log(`🔎 Jumlah order ditemukan: ${orders.length}`);

              for (const order of orders) {
                const { part_pk, invoice, resi, sku, quantity, courier_name } = order;

                // --- Ambil detail part ---
                const getName = await axios.get(
                  `${process.env.SERVER_INVENTREE}/api/part/${encodeURIComponent(
                    part_pk
                  )}/`,
                  {
                    headers: {
                      Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                    },
                  }
                );
                const partDetail = getName.data;

                if (!partDetail || !partDetail.full_name) {
                  console.warn(
                    `❗ Gagal ambil full_name part: ${JSON.stringify(partDetail)}`
                  );
                  continue;
                }

                // --- Ambil location berdasarkan sku ---
                const getLocationId = await axios.get(
                  `${process.env.SERVER_INVENTREE}/api/stock/location/?name=${encodeURIComponent(
                    sku
                  )}`,
                  {
                    headers: {
                      Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                    },
                  }
                );

                const locationData = getLocationId.data;

                if (!locationData || !locationData.results || locationData.results.length === 0) {
                  console.warn(`❗ Lokasi dengan name=${sku} tidak ditemukan`);
                  continue;
                }

                const locationId = locationData.results[0];

                // --- Insert ke mo_order_shop ---
                const insertShopQuery = {
                  graph: {
                    method: "mutate",
                    endpoint: GRAPHQL_API,
                    gqlQuery: `
                      mutation MyMutation(
                        $proc_inst_id: String!,
                        $sku: String!,
                        $quantity: Int!,
                        $invoice: String!,
                        $resi: String!,
                        $product_name: String!,
                        $part_pk: Int!,
                        $stock_item_id: Int!
                      ) {
                        insert_mo_order_shop(objects: {
                          proc_inst_id: $proc_inst_id,
                          product_name: $product_name,
                          invoice: $invoice,
                          resi: $resi,
                          sku_toko: $sku,
                          quantity_order: $quantity,
                          part_pk: $part_pk,
                          quantity_convert: $quantity,
                          stock_item_id: $stock_item_id
                        }) {
                          affected_rows
                        }
                      }
                    `,
                    variables: {
                      proc_inst_id: proc_inst_id,
                      product_name: partDetail.full_name,
                      sku: sku,
                      invoice: invoice,
                      quantity: quantity,
                      resi: resi,
                      part_pk: part_pk,
                      stock_item_id: locationId.pk, // hasil dari location
                    },
                  },
                  query: [],
                };

                const shopResult = await configureQuery(fastify, insertShopQuery);
                console.log("✅ Insert mo_order_shop result:", shopResult.data);
              }

              // --- Insert ke mo_order hanya sekali setelah loop ---
              const firstOrder = orders[0]; // ambil 1 data sebagai perwakilan
              const insertOrderQuery = {
                graph: {
                  method: "mutate",
                  endpoint: GRAPHQL_API,
                  gqlQuery: `
                    mutation MyMutation(
                      $proc_inst_id: String!,
                      $invoice: String!,
                      $resi: String!,
                      $courier_name: String!
                    ) {
                      insert_mo_order(objects: {
                        proc_inst_id: $proc_inst_id,
                        invoice: $invoice,
                        resi: $resi,
                        courier_name: $courier_name,
                        proc_def_key: "Mirorim_Operasional.Order",
                        task_def_key: "Mirorim_Operasional.Order.Scan_Invoice",
                        categorized_location: "-",
                        status_mp: "-"
                      }) {
                        affected_rows
                      }
                    }
                  `,
                  variables: {
                    proc_inst_id: proc_inst_id,
                    invoice: firstOrder.invoice,
                    resi: firstOrder.resi,
                    courier_name: firstOrder.courier_name,
                  },
                },
                query: [],
              };

              const orderResult = await configureQuery(fastify, insertOrderQuery);
              console.log("✅ Insert mo_order result:", orderResult.data);
              console.log("Invoice:", firstOrder.invoice);
              console.log("Kurir:", firstOrder.courier_name);

              await taskService.complete(task);
            } catch (error) {
              console.error(
                "❌ Terjadi kesalahan saat memproses task:",
                error.message
              );
              await taskService.handleFailure(task, {
                errorMessage: error.message,
                errorDetails: error.stack,
                retries: 0,
                retryTimeout: 1000,
              });
            }
          });


        client.subscribe("Listing_Refill", async function ({ task, taskService }) {
            console.log("Task Listing_Refill Dijalankan:", task.id);

            try {
                // Ambil proc_inst_id dari task yang sedang berjalan
                const current_proc_inst_id = task.processInstanceId;

                const dataQuery = {
                    graph: {
                        method: "query",
                        endpoint: GRAPHQL_API,
                        gqlQuery: `
              query GetRefillData($proc_inst_id: String!) {
                mo_refill( where: { proc_inst_id: { _eq: $proc_inst_id } }) {
                  id
                  sku
                  refill_type
                  proc_inst_id
                  created_at
                }
              }
            `,
                        variables: {
                            proc_inst_id: current_proc_inst_id
                        },
                    },
                    query: [],
                };

                const responseQuery = await configureQuery(fastify, dataQuery);
                const refillData = responseQuery.data[0].graph.mo_refill;
                console.log("🔍 responseQuery:", JSON.stringify(responseQuery.data[0].graph.mo_refill, null, 2));

                console.log("📦 Data Refill ditemukan:", refillData.length);

                // 2. Proses setiap data refill
                for (const refill of refillData) {
                    try {
                        // Ambil business key dari Camunda untuk proc_inst_id dari mo_refill
                        const camundaResponse = await axios.get(
                            `http://36.50.112.247:8080/engine-rest/process-instance/${refill.proc_inst_id}`
                        );

                        // Ekstrak warehouse dari business key
                        const businessKey = camundaResponse.data.businessKey;
                        const warehouse = businessKey.split(":")[0]; // Ambil bagian "GUDANG C"

                        // 3. Insert ke mo_refill_print dengan proc_inst_id dari current task
                        const insertQuery = {
                            graph: {
                                method: "mutate",
                                endpoint: GRAPHQL_API,
                                gqlQuery: `
                  mutation InsertRefillPrint(
                    $mo_refill_id: Int!,
                    $sku_toko: String!,
                    $gudang: String!,
                    $refill_type: String!,
                    $proc_inst_id: String!,
		    $created_at: timestamp!
                  ) {
                    insert_mo_refill_print_one(object: {
                      mo_refill_id: $mo_refill_id,
                      sku_toko: $sku_toko,
                      gudang: $gudang,
                      refill_type: $refill_type,
                      proc_inst_id: $proc_inst_id,
                      created_at: $created_at
                    }) {
                      proc_inst_id
                    }
                  }
                `,
                                variables: {
                                    mo_refill_id: refill.id,
                                    sku_toko: refill.sku,
                                    gudang: warehouse,
                                    refill_type: refill.refill_type,
                                    proc_inst_id: current_proc_inst_id,
                                    created_at: refill.created_at
                                }
                            },
                            query: [],
                        };

                        const insertResponse = await configureQuery(fastify, insertQuery);
                        console.log("✅ Data berhasil diinsert:", insertResponse.data);

                    } catch (error) {
                        console.error(
                            `❌ Error memproses refill ID ${refill.id}:`,
                            error.message
                        );
                    }
                }

                await taskService.complete(task);
                console.log(`✅ Task ${task.id} berhasil diselesaikan`);

            } catch (error) {
                console.error("❌ Error dalam Listing_Refill service:", error);
                await taskService.handleFailure(task, {
                    errorMessage: error.message,
                    errorDetails: error.stack,
                    retries: 0,
                    retryTimeout: 1000,
                });
            }
        });

        client.subscribe("Recomendation_SimpleAssembly", async function ({ task, taskService }) {
            console.log("▶️ Task Dijalankan:", task.id);

            try {
                const queryText = `
          SELECT 
            part_part.id AS part_pk,
            part_part.name AS product_name,
            stock_stocklocation.name AS location_name
          FROM 
            public.part_part
          INNER JOIN 
            stock_stockitem ON stock_stockitem.part_id = part_part.id
          INNER JOIN 
            stock_stocklocation ON stock_stocklocation.id = stock_stockitem.location_id
          WHERE 
            stock_stocklocation.description = 'TOKO'
            AND part_part.assembly = true
            AND part_part.description = 'Simple Assembly'
          GROUP BY 
            part_part.id, part_part.name, stock_stocklocation.name
          HAVING 
            SUM(stock_stockitem.quantity) = 0;
        `;

                const { rows: parts } = await pool.query(queryText);

                if (!parts.length) {
                    console.log("🚫 Tidak ada part Simple Assembly dengan stock 0 di TOKO.");
                    await taskService.complete(task);
                    return;
                }

                // Fungsi bantu bikin timestamp lokal (tanpa timezone)
                function getCurrentTimestamp() {
                    const now = new Date();
                    const pad = (n) => n.toString().padStart(2, '0');
                    const year = now.getFullYear();
                    const month = pad(now.getMonth() + 1);
                    const day = pad(now.getDate());
                    const hours = pad(now.getHours());
                    const minutes = pad(now.getMinutes());
                    const seconds = pad(now.getSeconds());
                    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
                }

                for (const part of parts) {
                    const { part_pk, product_name, location_name } = part;
                    const business_key = `${location_name}:${product_name}:Recomendation`;

                    try {
                        // Trigger proses baru
                        const response = await axios.post(`${CAMUNDA_API}engine-rest/process-definition/key/Mirorim_Operasional.Prepare/start`, {
                            variables: {
                                part_pk: { value: part_pk, type: "Integer" },
                                product_name: { value: product_name, type: "String" },
                                location_name: { value: location_name, type: "String" },
                                source: { value: "Recomendation_SimpleAssembly", type: "String" }
                            },
                            businessKey: business_key
                        });

                        const newProcInstId = response.data?.id;

                        if (!newProcInstId) {
                            console.warn("⚠️ Tidak ada instance ID baru yang dibuat.");
                            continue;
                        }

                        console.log("🆕 Instance baru:", newProcInstId);

                        const created_at = getCurrentTimestamp(); // format sesuai timestamp (tanpa zona waktu)

                        const dataInsert = {
                            graph: {
                                method: "mutate",
                                endpoint: process.env.GRAPHQL_API,
                                gqlQuery: `
                  mutation InsertBuildOrder(
                    $part_id: Int!,
                    $sku_toko: String!,
                    $proc_inst_id: String!,
                    $date: timestamp!
                  ) {
                    insert_mo_prepare_build_order(objects: {
                      part_id: $part_id,
                      sku_toko: $sku_toko,
                      proc_inst_id: $proc_inst_id,
                      created_at: $date
                    }) {
                      affected_rows
                      returning {
                        id
                        part_id
                        sku_toko
                        proc_inst_id
                        created_at
                      }
                    }
                  }
                `,
                                variables: {
                                    part_id: part_pk,
                                    sku_toko: location_name,
                                    proc_inst_id: newProcInstId,
                                    date: created_at
                                }
                            },
                            query: []
                        };

                        const responseInsert = await configureQuery(fastify, dataInsert);
                        const insertResult = responseInsert?.data?.graph?.insert_mo_prepare_build_order;

                    } catch (err) {
                        console.error("❌ Gagal proses:", err.response?.data || err.message);
                    }
                }

                await taskService.complete(task);
            } catch (err) {
                console.error("❌ Error utama:", err.message);
                await taskService.handleFailure(task, {
                    errorMessage: err.message,
                    errorDetails: err.stack,
                    retries: 0,
                    retryTimeout: 1000
                });
            }
        });

        client.subscribe("Build_Order", async function ({ task, taskService }) {
            console.log("🚀 Task Dijalankan:", task.id);

            const inventree = axios.create({
                baseURL: `${process.env.SERVER_INVENTREE}/api`,
                headers: {
                    Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                    "Content-Type": "application/json",
                },
                timeout: 10000,
            });

            try {
                const proc_inst_id = task.processInstanceId;

                const responseQuery = await configureQuery(fastify, {
                    graph: {
                        method: "query",
                        endpoint: process.env.GRAPHQL_API,
                        gqlQuery: `
              query FetchBuildOrder($proc_inst_id: String!) {
                mo_prepare_build_order(where: { proc_inst_id: { _eq: $proc_inst_id } }) {
                  id
                  part_id
                  quantity
                }
              }`,
                        variables: { proc_inst_id },
                    },
                    query: [],
                });

                const orders = responseQuery?.data?.[0]?.graph?.mo_prepare_build_order || [];
                if (orders.length === 0) throw new Error(`❌ Tidak ada order ditemukan`);

                for (const order of orders) {
                    const { part_id, quantity } = order;

                    // Generate reference Build Order
                    const { data: buildList } = await inventree.get("/build/?limit=1&ordering=-pk");
                    const lastRef = buildList.results?.[0]?.reference || "BO-0000";
                    const nextNumber = parseInt(lastRef.split("-")[1] || "0") + 1;
                    const reference = `BO-${nextNumber.toString().padStart(4, "0")}`;

                    // POST Build Order
                    const buildRes = await inventree.post("/build/", {
                        part: part_id,
                        quantity,
                        reference,
                    });

                    const buildId = buildRes.data.pk;

                    // GET Build Lines
                    const { data: buildLineRes } = await inventree.get(`/build/line/?build=${buildId}`);
                    const buildLines = buildLineRes.results;

                    if (!buildLines || buildLines.length === 0) {
                        throw new Error("❌ Build line kosong");
                    }

                    // 🔁 Loop setiap build line (komponen)
                    const itemsToAllocate = [];

                    for (const line of buildLines) {
                        const sub_part_id = line.bom_item_detail?.sub_part;
                        const line_qty = line.quantity;

                        if (!sub_part_id || !line_qty) {
                            console.warn(`⚠️ Build line tidak valid`);
                            continue;
                        }

                        const stockItems = await fetchStockItemsForPart(part_id, sub_part_id, line_qty);
                        if (stockItems.length === 0) {
                            console.warn(`⚠️ Tidak ada stok tersedia untuk sub_part_id ${sub_part_id}`);
                            continue;
                        }

                        for (const item of stockItems) {
                            itemsToAllocate.push({
                                build_line: line.pk,
                                stock_item: item.id,
                                quantity: item.allocate_qty.toString(),
                            });

                            // Mutasi ke mo_prepare_build_detail
                            await configureQuery(fastify, {
                                graph: {
                                    method: "mutate",
                                    endpoint: process.env.GRAPHQL_API,
                                    gqlQuery: `
                    mutation InsertBuildDetail(
                      $proc_inst_id: String!,
                      $stock_id: Int!,
                      $quantity: Int!,
                      $part_id: Int!
                    ) {
                      insert_mo_prepare_build_detail(objects: {
                        proc_inst_id: $proc_inst_id,
                        stock_id: $stock_id,
                        allocated_quantity: $quantity,
                        part_id: $part_id
                      }) {
                        affected_rows
                      }
                    }`,
                                    variables: {
                                        proc_inst_id,
                                        stock_id: item.id,
                                        quantity: item.allocate_qty,
                                        part_id: sub_part_id,
                                    },
                                },
                                query: [],
                            });
                        }
                    }

                    // POST Allocation
                    if (itemsToAllocate.length > 0) {
                        await inventree.post(`/build/${buildId}/allocate/`, {
                            items: itemsToAllocate,
                        });
                        console.log(`✅ Allocation Sukses untuk Build ID: ${buildId}`);
                    } else {
                        console.warn(`⚠️ Tidak ada item yang dialokasikan untuk Build ID: ${buildId}`);
                    }

                    // Simpan build_id ke tabel mo_prepare_build_order
                    await configureQuery(fastify, {
                        graph: {
                            method: "mutate",
                            endpoint: process.env.GRAPHQL_API,
                            gqlQuery: `
                mutation UpdateBuildOrder($proc_inst_id: String!, $build_id: Int!) {
                  update_mo_prepare_build_order(
                    where: { proc_inst_id: { _eq: $proc_inst_id } },
                    _set: { build_id: $build_id }
                  ) {
                    affected_rows
                  }
                }`,
                            variables: {
                                proc_inst_id,
                                build_id: buildId,
                            },
                        },
                        query: [],
                    });

                    console.log(`🔄 build_id ${buildId} disimpan untuk instance ${proc_inst_id}`);
                }

                await taskService.complete(task);
                console.log("🎉 Task Selesai");
            } catch (error) {
                console.error("❌ Error:", error.message);
                if (error.response?.data) console.log("🧾 Detail:", error.response.data);

                await taskService.handleFailure(task, {
                    errorMessage: error.message,
                    errorDetails: error.stack,
                    retries: 0,
                    retryTimeout: 1000,
                });
            }

            // ✅ Fungsi ambil stock berdasarkan part_bomitem.sub_part_id
            async function fetchStockItemsForPart(parent_part_id, sub_part_id, totalQtyNeeded) {
                try {
                    const query = `
            SELECT
              stock_stockitem.id,
              stock_stockitem.quantity,
              part_bomitem.sub_part_id AS part_id
            FROM part_bomitem
            INNER JOIN stock_stockitem ON stock_stockitem.part_id = part_bomitem.sub_part_id
            INNER JOIN stock_stocklocation ON stock_stocklocation.id = stock_stockitem.location_id
            WHERE part_bomitem.part_id = $1
              AND part_bomitem.sub_part_id = $2
              AND stock_stocklocation.description ILIKE '%GUDANG%'
              AND stock_stockitem.batch IS NOT NULL
              AND stock_stockitem.quantity > 0
            ORDER BY stock_stockitem.updated ASC
          `;

                    const { rows } = await pool.query(query, [parent_part_id, sub_part_id]);

                    const result = [];
                    let remaining = totalQtyNeeded;

                    for (const item of rows) {
                        if (remaining <= 0) break;

                        const allocate_qty = Math.min(item.quantity, remaining);
                        result.push({
                            id: item.id,
                            part_id: item.part_id,
                            allocate_qty,
                        });

                        remaining -= allocate_qty;
                    }

                    return result;
                } catch (err) {
                    console.error("❌ DB Error:", err.message);
                    return [];
                }
            }
        });

        client.subscribe("Issue_Build", async function ({ task, taskService }) {
            console.log("🚀 Task Dijalankan:", task.id);

            try {
                const proc_inst_id = task.processInstanceId;

                // Ambil data build_id dari table mo_prepare_build_order
                const dataQuery = {
                    graph: {
                        method: "query",
                        endpoint: GRAPHQL_API,
                        gqlQuery: `
                  query GetBuildOrder($proc_inst_id: [String!]) {
                    mo_prepare_build_order(where: { proc_inst_id: { _in: $proc_inst_id } }) {
                      build_id
                    }
                  }
                `,
                        variables: {
                            proc_inst_id: [proc_inst_id],
                        },
                    },
                    query: [],
                };

                const responseQuery = await configureQuery(fastify, dataQuery);
                const buildOrders = responseQuery?.data?.[0]?.graph?.mo_prepare_build_order || [];

                if (buildOrders.length === 0) {
                    throw new Error("❌ Data mo_prepare_build_order tidak ditemukan untuk processInstanceId: " + proc_inst_id);
                }

                for (const order of buildOrders) {
                    const { build_id } = order;

                    if (!build_id) {
                        console.warn("⚠️ Build ID kosong, dilewati.");
                        continue;
                    }

                    // POST ke /issue/ untuk mengeluarkan stok
                    const issueResponse = await axios.post(
                        `${process.env.SERVER_INVENTREE}/api/build/${encodeURIComponent(build_id)}/issue/`,
                        {},
                        {
                            headers: {
                                Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                            },
                        }
                    );

                    console.log(`✅ Build ${build_id} berhasil di-issue-kan.`);
                }

                await taskService.complete(task);
                console.log("✅ Task Selesai:", task.id);

            } catch (error) {
                console.error("❌ Terjadi kesalahan saat memproses task:", error.message);
                await taskService.handleFailure(task, {
                    errorMessage: error.message,
                    errorDetails: error.stack,
                    retries: 0,
                    retryTimeout: 1000,
                });
            }
        });

        client.subscribe("Complete_Build", async function ({ task, taskService }) {
            console.log("🚀 Task Dijalankan:", task.id);
            try {
                const proc_inst_id = task.processInstanceId;
                const location = task.variables.get("location");
                const status = task.variables.get("status");

                console.log("ℹ️ Process Instance ID:", proc_inst_id);
                console.log("📍 Lokasi tujuan:", location);
                console.log("🪪 Status custom:", status);

                // Ambil data build_id dari table mo_prepare_build_order
                const dataQuery = {
                    graph: {
                        method: "query",
                        endpoint: GRAPHQL_API,
                        gqlQuery: `
          query GetBuildOrder($proc_inst_id: [String!]) {
            mo_prepare_build_order(where: { proc_inst_id: { _in: $proc_inst_id } }) {
              quantity_output
              build_id
            }
          }
        `,
                        variables: {
                            proc_inst_id: [proc_inst_id],
                        },
                    },
                    query: [],
                };

                const responseQuery = await configureQuery(fastify, dataQuery);
                const buildOrders = responseQuery?.data?.[0]?.graph?.mo_prepare_build_order || [];

                if (buildOrders.length === 0) {
                    throw new Error("❌ Data mo_prepare_build_order tidak ditemukan untuk processInstanceId: " + proc_inst_id);
                }

                for (const order of buildOrders) {
                    const { quantity_output, build_id } = order;
                    console.log(`🔨 Build ID: ${build_id} | Output Quantity: ${quantity_output}`);

                    // Buat output hasil build
                    const createOutput = await axios.post(
                        `${process.env.SERVER_INVENTREE}/api/build/${encodeURIComponent(build_id)}/create-output/`,
                        { quantity: quantity_output },
                        {
                            headers: {
                                Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                            },
                        }
                    );
                    console.log("✅ Output berhasil dibuat:", createOutput.data);

                    // Ambil output (pk) hasil build
                    const selectOutput = await axios.get(
                        `${process.env.SERVER_INVENTREE}/api/stock/?build=${encodeURIComponent(build_id)}&in_stock=false`,
                        {
                            headers: {
                                Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                            },
                        }
                    );

                    const outputItems = selectOutput.data?.results || [];

                    if (outputItems.length === 0) {
                        throw new Error(`⚠️ Output hasil build untuk Build ID ${build_id} tidak ditemukan.`);
                    }

                    for (const item of outputItems) {
                        const pk = item.pk;
                        console.log(`📦 Output ditemukan - PK: ${pk}`);
                        // Complete build untuk setiap output
                        const completeOutput = await axios.post(
                            `${process.env.SERVER_INVENTREE}/api/build/${encodeURIComponent(build_id)}/complete/`,
                            {
                                outputs: [
                                    {
                                        output: pk,
                                    },
                                ],
                                location: location,
                                status_custom_key: status,
                            },
                            {
                                headers: {
                                    Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                                },
                            }
                        );

                        console.log(`🎯 Output PK ${pk} berhasil di-complete.`);
                    }

                    // Finish build
                    const finishOutput = await axios.post(
                        `${process.env.SERVER_INVENTREE}/api/build/${encodeURIComponent(build_id)}/finish/`,
                        {},
                        {
                            headers: {
                                Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                            },
                        }
                    );
                    console.log(`🏁 Build ${build_id} berhasil di-FINISH-kan.`);
                }

                await taskService.complete(task);
                console.log("✅ Task Selesai:", task.id);

            } catch (error) {
                console.error("❌ Terjadi kesalahan saat memproses task:", error.message);
                await taskService.handleFailure(task, {
                    errorMessage: error.message,
                    errorDetails: error.stack,
                    retries: 0,
                    retryTimeout: 1000,
                });
            }
        });

        client.subscribe("Complete_Build_Partial", async function ({ task, taskService }) {
            console.log("🚀 Task Dijalankan:", task.id);

            try {
                const proc_inst_id = task.processInstanceId;
                const location = task.variables.get("location");
                const status = task.variables.get("status");

                console.log("ℹ️ Process Instance ID:", proc_inst_id);
                console.log("📍 Lokasi tujuan:", location);
                console.log("🪪 Status custom:", status);

                // 🔍 Ambil data build_id dari table mo_prepare_build_order_partial
                const dataQuery = {
                    graph: {
                        method: "query",
                        endpoint: GRAPHQL_API,
                        gqlQuery: `
              query GetBuildOrder($proc_inst_id: [String!]) {
                mo_prepare_build_order_partial(where: { proc_inst_id: { _in: $proc_inst_id } }) {
                  quantity_output
                  build_id
                }
              }
            `,
                        variables: {
                            proc_inst_id: [proc_inst_id],
                        },
                    },
                    query: [],
                };

                const responseQuery = await configureQuery(fastify, dataQuery);
                const buildOrders =
                    responseQuery?.data?.[0]?.graph?.mo_prepare_build_order_partial || [];

                if (buildOrders.length === 0) {
                    throw new Error("❌ Data mo_prepare_build_order_partial tidak ditemukan untuk processInstanceId: " + proc_inst_id);
                }

                for (const order of buildOrders) {
                    const { quantity_output, build_id } = order;
                    console.log(`🔨 Build ID: ${build_id} | Output Quantity: ${quantity_output}`);

                    // 🏗️ Buat output hasil build
                    const createOutput = await axios.post(
                        `${process.env.SERVER_INVENTREE}/api/build/${encodeURIComponent(build_id)}/create-output/`,
                        { quantity: quantity_output },
                        {
                            headers: {
                                Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                            },
                        }
                    );
                    console.log("✅ Output berhasil dibuat:", createOutput.data);

                    // 🔍 Ambil stock item hasil build
                    const selectOutput = await axios.get(
                        `${process.env.SERVER_INVENTREE}/api/stock/?build=${encodeURIComponent(build_id)}&in_stock=false`,
                        {
                            headers: {
                                Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                            },
                        }
                    );

                    const outputItems = selectOutput.data?.results || [];

                    if (outputItems.length === 0) {
                        throw new Error(`⚠️ Output hasil build untuk Build ID ${build_id} tidak ditemukan.`);
                    }

                    for (const item of outputItems) {
                        const pk = item.pk;
                        console.log(`📦 Output ditemukan - PK: ${pk}`);

                        // ✅ Complete stock item hasil build
                        await axios.post(
                            `${process.env.SERVER_INVENTREE}/api/build/${encodeURIComponent(build_id)}/complete/`,
                            {
                                outputs: [
                                    {
                                        output: pk,
                                    },
                                ],
                                location: location,
                                status_custom_key: status,
                            },
                            {
                                headers: {
                                    Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                                },
                            }
                        );
                        console.log(`🎯 Output PK ${pk} berhasil di-complete.`);
                    }
                }

                await taskService.complete(task);
                console.log("✅ Task Selesai:", task.id);

            } catch (error) {
                console.error("❌ Terjadi kesalahan saat memproses task:", error.message);
                await taskService.handleFailure(task, {
                    errorMessage: error.message,
                    errorDetails: error.stack,
                    retries: 0,
                    retryTimeout: 1000,
                });
            }
        });

        client.subscribe("Get_Instance_Prepare", async function ({ task, taskService }) {
            console.log("🚀 Task Dijalankan:", task.id);

            try {
                const proc_inst_id = task.processInstanceId;
                const parent_instance_id = task.variables.get("parent_instance_id");

                const response = await configureQuery(fastify, {
                    graph: {
                        method: "mutate",
                        endpoint: process.env.GRAPHQL_API,
                        gqlQuery: `
          mutation updatePartial($proc_inst_id: String!, $parent_instance_id: String!) {
            update_mo_prepare_build_order_partial(
              where: {
                parent_instance_id: { _eq: $parent_instance_id },
                status: { _eq: "unprocessed" }
              },
              _set: {
                proc_inst_id: $proc_inst_id,
                status: "done"
              }
            ) {
              affected_rows
            }
          }
        `,
                        variables: {
                            proc_inst_id,
                            parent_instance_id,
                        },
                    },
                    query: [],
                });

                console.log(`🔄 proc_inst_id "${proc_inst_id}" disimpan ke partial order parent "${parent_instance_id}"`);
                console.log("📊 response Hasura:", JSON.stringify(response.data, null, 2));

                await taskService.complete(task);
                console.log("✅ Task Selesai:", task.id);

            } catch (error) {
                console.error("❌ Terjadi kesalahan saat memproses task:", error.message);
                await taskService.handleFailure(task, {
                    errorMessage: error.message,
                    errorDetails: error.stack,
                    retries: 0,
                    retryTimeout: 1000,
                });
            }
        });
        
            client.subscribe("Trigger_Load", async function ({ task, taskService }) {
      try {
        console.log(">> Menerima task Trigger_Load");

        // Ambil businessKey dari proses induk
        const businessKey = task.variables.get("businessKey");
        const type_ = task.variables.get("type_pesanan") || "";
        console.log(">> Business Key:", businessKey);

        // Kirim request ke proses Load_Data
        const response = await axios.post(`${CAMUNDA_API}engine-rest/process-definition/key/Mirorim_Operasional.Load_Data/start`, {
          variables: {
      type_pesanan: { value: type_, type: "String" }
    },
          businessKey: businessKey
        });

        const newProcInstId = response.data.id;
        console.log(">> Proses Load_Data berhasil dijalankan:", newProcInstId);

const created_at = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString();

        // Hanya insert proc_inst_id dan created_at ke load_data
        const dataInsert = {
          graph: {
            method: "mutate",
            endpoint: process.env.GRAPHQL_API,
            gqlQuery: `
              mutation InsertLoadData(
                $proc_inst_id: String!,
                $date: timestamp!
              ) {
                insert_mo_load_data(objects: {
                  proc_inst_id: $proc_inst_id,
                  created_at: $date
                }) {
                  affected_rows
                }
              }
            `,
            variables: {
              proc_inst_id: newProcInstId,
              date: created_at
            }
          },
          query: []
        };

        const responseInsert = await configureQuery(fastify, dataInsert);
        const insertResult = responseInsert?.data?.graph?.insert_mo_load_data;

        console.log(">> Debug insert:", JSON.stringify(responseInsert, null, 2));

        await taskService.complete(task);
      } catch (err) {
        console.error(">> Gagal men-trigger Load_Data:", err.message);
        await taskService.handleFailure(task, {
          errorMessage: "Gagal trigger Mirorim_Operasional.Load_Data",
          errorDetails: err.toString(),
          retries: 1,
          retryTimeout: 5000
        });
      }
    });
    
     client.subscribe("getInstanceRetur",
      async function ({ task, taskService }) {
        console.log("🚀 Task Dijalankan:", task.id);

        try {
          const proc_inst_id = task.processInstanceId;
          let invoice = task.variables.get("invoice");

	invoice = invoice.toString();

          console.log(proc_inst_id, invoice);

          const response = await configureQuery(fastify, {
            graph: {
              method: "mutate",
              endpoint: process.env.GRAPHQL_API,
              gqlQuery: `
            mutation updateRetur($proc_inst_id: String!, $invoice: String!) {
              update_mo_retur_receive(
                where: { invoice: { _eq: $invoice } }
                _set: {
                  proc_inst_id: $proc_inst_id
                }
              ) {
                affected_rows
              }
            }
          `,
              variables: {
                proc_inst_id,
                invoice,
              },
            },
            query: [],
          });

          console.log(
            `🔄 proc_inst_id "${proc_inst_id}" disimpan ke invoice "${invoice}"`
          );
          console.log(
            "📊 response Hasura:",
            JSON.stringify(response.data, null, 2)
          );

          await taskService.complete(task);
          console.log("✅ Task Selesai:", task.id);
        } catch (error) {
          console.error(
            "❌ Terjadi kesalahan saat memproses task:",
            error.message
          );
          await taskService.handleFailure(task, {
            errorMessage: error.message,
            errorDetails: error.stack,
            retries: 0,
            retryTimeout: 1000,
          });
        }
      }
    );
    
            client.subscribe("getInstanceClosing", async function ({ task, taskService }) {
                console.log("🚀 Task Dijalankan:", task.id);
                try {
                    const proc_inst_id = task.processInstanceId;
                    const invoice = task.variables.get("invoice");
                    const response = await configureQuery(fastify, {
                        graph: {
                            method: "mutate",
                            endpoint: process.env.GRAPHQL_API,
                            gqlQuery: `
                        mutation insert($proc_inst_id: String!, $invoice: String!) {
                            insert_mo_order_closing(
                                objects: {
                                    proc_inst_id: $proc_inst_id,
                                    invoice: $invoice
                                }
                            ) {
                                affected_rows
                            }
                        }
                    `,
                            variables: {
                                proc_inst_id,
                                invoice,
                            },
                        },
                        query: [],
                    });
                    console.log(`🔄 proc_inst_id "${proc_inst_id}" disimpan ke invoice "${invoice}"`);
                    console.log("📊 response Hasura:", JSON.stringify(response.data, null, 2));
                    await taskService.complete(task);
                    console.log("✅ Task Selesai:", task.id);
                } catch (error) {
                    console.error("❌ Terjadi kesalahan saat memproses task:", error.message);
                    await taskService.handleFailure(task, {
                        errorMessage: error.message,
                        errorDetails: error.stack,
                        retries: 0,
                        retryTimeout: 1000,
                    });
                }
            }
        );

        client.subscribe("getInstanceManufacture",
              async function ({ task, taskService }) {
                console.log("🚀 Task Dijalankan:", task.id);
        
                try {
                  const proc_inst_id = task.processInstanceId;
                  const parent_inst_id = task.variables.get("parent_inst_id");
        
                  const response = await configureQuery(fastify, {
                    graph: {
                      method: "mutate",
                      endpoint: process.env.GRAPHQL_API,
                      gqlQuery: `
                    mutation updateManufacture($proc_inst_id: String!, $parent_inst_id: String!) {
                      update_manufacture_request(
                        where: { parent_inst_id: { _eq: $parent_inst_id } }
                        _set: {
                          proc_inst_id: $proc_inst_id
                        }
                      ) {
                        affected_rows
                      }
                    }
                  `,
                      variables: {
                        proc_inst_id,
                        parent_inst_id,
                      },
                    },
                    query: [],
                  });
        
                  console.log(
                    "📊 response Hasura:",
                    JSON.stringify(response.data, null, 2)
                  );
        
                  await taskService.complete(task);
                  console.log("✅ Task Selesai:", task.id);
                } catch (error) {
                  console.error(
                    "❌ Terjadi kesalahan saat memproses task:",
                    error.message
                  );
                  await taskService.handleFailure(task, {
                    errorMessage: error.message,
                    errorDetails: error.stack,
                    retries: 0,
                    retryTimeout: 1000,
                  });
                }
              }
            );
        
            client.subscribe("getParentManufacture",
              async function ({ task, taskService }) {
                console.log("🚀 Task Dijalankan:", task.id);
        
                try {
                  const parent_inst_id = task.processInstanceId;
                  const reference = task.variables.get("reference");
                  if (!reference) {
                    throw new Error(
                      "❌ Variabel 'reference' tidak ditemukan atau kosong"
                    );
                  }
        
                  const response = await configureQuery(fastify, {
                    graph: {
                      method: "mutate",
                      endpoint: process.env.GRAPHQL_API,
                      gqlQuery: `
                    mutation updateManufacture($parent_inst_id: String!, $reference: String!, $status: String!) {
                      update_manufacture_request(
                        where: { reference: { _eq: $reference } }
                        _set: {
                          parent_inst_id: $parent_inst_id,
                          status: $status
                        }
                      ) {
                        affected_rows
                      }
                    }
                  `,
                      variables: {
                        reference,
                        parent_inst_id,
                        status: "waiting scheduling",
                      },
                    },
                    query: [],
                  });
        
                  console.log(
                    "📊 response Hasura:",
                    JSON.stringify(response.data, null, 2)
                  );
        
                  await taskService.complete(task);
                  console.log("✅ Task Selesai:", task.id);
                } catch (error) {
                  console.error(
                    "❌ Terjadi kesalahan saat memproses task:",
                    error.message
                  );
                  await taskService.handleFailure(task, {
                    errorMessage: error.message,
                    errorDetails: error.stack,
                    retries: 0,
                    retryTimeout: 1000,
                  });
                }
              }
            );
        
            client.subscribe("generate_prebuild_order",
              async function ({ task, taskService }) {
                console.log("🚀 Task Dijalankan:", task.id);
        
                const inventree = axios.create({
                  baseURL: `${process.env.SERVER_INVENTREE}/api`,
                  headers: {
                    Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                    "Content-Type": "application/json",
                  },
                  timeout: 10000,
                });
        
                try {
                  const quantity = task.variables.get("quantity_request");
                  const proc_inst_id = task.processInstanceId;
        
                  if (!quantity || isNaN(quantity)) {
                    throw new Error("❌ Quantity tidak valid atau kosong");
                  }
        
                  // Ambil rekomendasi dari GraphQL
                  const responseQuery = await configureQuery(fastify, {
                    graph: {
                      method: "query",
                      endpoint: process.env.GRAPHQL_API,
                      gqlQuery: `
                  query FetchBuildOrder($proc_inst_id: String!) {
                    item_recommendations(where: { proc_inst_id: { _eq: $proc_inst_id } }) {
                      part_id
                      id
                    }
                  }`,
                      variables: { proc_inst_id },
                    },
                    query: [],
                  });
        
                  const orders =
                    responseQuery?.data?.[0]?.graph?.item_recommendations || [];
                  if (orders.length === 0) {
                    throw new Error(
                      `❌ Tidak ada item_recommendations untuk proc_inst_id: ${proc_inst_id}`
                    );
                  }
        
                  // Ambil reference terakhir
                  const { data: buildList } = await inventree.get(
                    "/build/?limit=1&ordering=-pk"
                  );
                  const lastRef = buildList?.results?.[0]?.reference || "BO-0000";
                  let lastNumber = parseInt(lastRef.split("-")[1] || "0", 10);
        
                  let reference = null; // hanya simpan yang pertama berhasil
                  const insertData = [];
        
                  for (const order of orders) {
                    const { part_id, id: recomendation_id } = order;
                    lastNumber += 1;
                    const tempRef = `BO-${lastNumber.toString().padStart(4, "0")}`;
        
                    try {
                      const buildRes = await inventree.post("/build/", {
                        part: part_id,
                        quantity,
                        reference: tempRef,
                        title: "Produksi",
                      });
        
                      console.log(
                        `✅ Build Order dibuat: Part ${part_id}, ID: ${buildRes.data.pk}`
                      );
        
                      reference = tempRef; // simpan reference pertama
        
                      console.log(
                        `🔄 Build Order berhasil dibuat dengan reference: ${reference}`
                      );
        
                      insertData.push({
                        part_id,
                        recomendation_id,
                        reference,
                        created_at: new Date().toISOString().split(".")[0],
                      });
        
                      break; // stop setelah sukses pertama
                    } catch (buildError) {
                      console.error(
                        `❌ Gagal buat build order untuk part_id: ${part_id}`
                      );
                      if (buildError.response?.data) {
                        console.log(
                          "🧾 Detail:",
                          JSON.stringify(buildError.response.data, null, 2)
                        );
                      }
                    }
                  }
        
                  if (!reference) {
                    throw new Error("❌ Tidak ada build order yang berhasil dibuat");
                  }
        
                  // Insert manufacture_request untuk yang pertama berhasil
                  for (const data of insertData) {
                    const insertShopQuery = {
                      graph: {
                        method: "mutate",
                        endpoint: process.env.GRAPHQL_API,
                        gqlQuery: `
                    mutation MyMutation(
                      $recomendation_id: Int!,
                      $part_id: Int!,
                      $reference: String!,
                      $created_at: timestamp!
                    ) {
                      insert_manufacture_request(objects: {
                        part_id: $part_id,
                        recomendation_id: $recomendation_id,
                        reference: $reference,
                        created_at: $created_at
                      }) {
                        affected_rows
                      }
                    }`,
                        variables: data,
                      },
                      query: [],
                    };
                    const shopResult = await configureQuery(fastify, insertShopQuery);
                    console.log(
                      "✅ Insert manufacture_request result:",
                      JSON.stringify(shopResult.data, null, 2)
                    );
                  }
        
                  console.log(`🔄 Reference Build Order pertamaaaaa: ${reference}`);
        
                  const variablesCamunda = new Variables();
                  variablesCamunda.set("reference", reference);
        
                  // Kirim reference pertama ke Camunda
                  await taskService.complete(task, variablesCamunda);
        
                  console.log("🎉 Task Selesai");
                } catch (error) {
                  console.error("❌ Error:", error.message);
                  if (error.response?.data) {
                    console.log(
                      "🧾 Detail:",
                      JSON.stringify(error.response.data, null, 2)
                    );
                  }
        
                  await taskService.handleFailure(task, {
                    errorMessage: error.message,
                    errorDetails: error.stack,
                    retries: 0,
                    retryTimeout: 1000,
                  });
                }
              }
            );
        
            client.subscribe("generate_build_manufacture",
              async function ({ task, taskService }) {
                console.log("🚀 Task Dijalankan:", task.id);
        
                const inventree = axios.create({
                  baseURL: `${process.env.SERVER_INVENTREE}/api`,
                  headers: {
                    Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                    "Content-Type": "application/json",
                  },
                  timeout: 10000,
                });
        
                const graphql = axios.create({
                  baseURL: process.env.GRAPHQL_API,
                  headers: {
                    "Content-Type": "application/json",
                    // Jika perlu authentication:
                    // "x-hasura-admin-secret": process.env.HASURA_ADMIN_SECRET,
                  },
                });
        
                try {
                  const reference = task.variables.get("reference");
                  const parent_inst_id = task.processInstanceId;
        
                  const { data } = await inventree.get(
                    `/build/?reference=${encodeURIComponent(reference)}`
                  );
        
                  const buildId = data?.results?.[0]?.pk;
                  if (!buildId) throw new Error("❌ Build Order tidak ditemukan");
        
                  console.log(`✅ Build ID: ${buildId}`);
        
                  await inventree.post(`/build/${encodeURIComponent(buildId)}/issue/`);
        
                  // 🔄 GraphQL update status
                  const graphqlMutation = {
                    query: `
                  mutation UpdateManufactureRequestStatus($parent_inst_id: String!) {
                    update_manufacture_request(
                      where: { parent_inst_id: { _eq: $parent_inst_id } }
                      _set: { status: "waiting request" }
                    ) {
                      affected_rows
                    }
                  }
                `,
                    variables: {
                      parent_inst_id,
                    },
                  };
        
                  const graphqlResponse = await graphql.post("", graphqlMutation);
                  const affected =
                    graphqlResponse.data.data?.update_manufacture_request
                      ?.affected_rows;
        
                  if (!affected) {
                    throw new Error("❌ Gagal update status manufacture_request");
                  }
        
                  await taskService.complete(task, {
                    variables: {
                      build_id: { value: buildId, type: "Integer" },
                    },
                  });
                } catch (error) {
                  await taskService.handleFailure(task, {
                    errorMessage: error.message,
                    errorDetails: error.stack,
                    retries: 0,
                    retryTimeout: 1000,
                  });
                }
              }
            );
        
            client.subscribe("transfer_stock_manufacture",
              async function ({ task, taskService }) {
                console.log("🚀 Task Dijalankan:", task.id);
        
                const inventree = axios.create({
                  baseURL: `${process.env.SERVER_INVENTREE}/api`,
                  headers: {
                    Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                    "Content-Type": "application/json",
                  },
                  timeout: 10000,
                });
        
                try {
                  const proc_inst_id = task.processInstanceId;
                  const responseQuery = await configureQuery(fastify, {
                    graph: {
                      method: "query",
                      endpoint: process.env.GRAPHQL_API,
                      gqlQuery: `
                            query FetchBuildOrder($proc_inst_id: String!) {
                                manufacture_request(where: { proc_inst_id: { _eq: $proc_inst_id } }) {
                                    id
                                    reference
                                }
                            }`,
                      variables: { proc_inst_id },
                    },
                  });
        
                  const orders =
                    responseQuery?.data?.[0]?.graph?.manufacture_request || [];
                  if (orders.length === 0) {
                    throw new Error(
                      `❌ Tidak ada manufacture_request untuk proc_inst_id: ${proc_inst_id}`
                    );
                  }
        
                  const reference = orders[0]?.reference;
                  if (!reference) throw new Error("❌ Reference tidak ditemukan");
        
                  const { data } = await inventree.get(
                    `/build/?reference=${encodeURIComponent(reference)}`
                  );
                  const idInventree = data?.results?.[0]?.pk;
                  if (!idInventree) throw new Error("❌ Build Order tidak ditemukan");
        
                  console.log(`✅ Build ID: ${idInventree}`);
        
                  for (const order of orders) {
                    const buildOrderId = order.id;
        
                    const getPickingItem = await configureQuery(fastify, {
                      graph: {
                        method: "query",
                        endpoint: process.env.GRAPHQL_API,
                        gqlQuery: `
                                query FetchPickingItems($id: Int!) {
          manufacture_picking_items(where: {build_order_id: {_eq: $id}}) {
            stock_item_id
            quantity
            part_id
          }
        }`,
                        variables: { id: buildOrderId },
                      },
                    });
        
                    const pickingItems =
                      getPickingItem?.data?.[0]?.graph?.manufacture_picking_items || [];
                    if (pickingItems.length === 0) {
                      throw new Error(
                        `❌ Tidak ada picking item untuk build order ID: ${buildOrderId}`
                      );
                    }
        
                    console.log(`🔄 Memproses build order ID: ${buildOrderId}`);
                    console.log("📦 Picking Items:", pickingItems);
        
                    const itemsToAllocate = [];
        
                    for (const item of pickingItems) {
                      const { stock_item_id, quantity, part_id } = item;
        
                      // 🔁 Step 1: Transfer ke lokasi produksi (5995)
                      const transferPayload = {
                        items: [
                          {
                            pk: Number(stock_item_id),
                            quantity: quantity,
                          },
                        ],
                        notes: `Alokasikan Ke Produksi | Proc ID: ${proc_inst_id}`,
                        location: 6003,
                      };
        
                      await inventree.post("/stock/transfer/", transferPayload);
                      console.log(
                        `✅ Transfer berhasil untuk stock_item_id: ${stock_item_id}`
                      );
        
                      // 🔁 Step 2: Ambil stock item terbaru dari lokasi produksi
                      const stockRes = await inventree.get(
                        `/stock/?part=${part_id}&location=6003&available=true&ordering=-updated&limit=1`
                      );
                      const newStockItem = stockRes?.data?.results?.[0];
        
                      if (!newStockItem) {
                        console.warn(
                          `⚠️ Tidak menemukan stock item baru setelah transfer untuk stock_item_id: ${stock_item_id}`
                        );
                        continue;
                      }
        
                      // 🔁 Step 3: Ambil build lines
                      const { data: buildLineRes } = await inventree.get(
                        `/build/line/?build=${idInventree}`
                      );
                      const buildLines = buildLineRes?.results || [];
                      if (buildLines.length === 0) {
                        throw new Error("❌ Build line kosong");
                      }
        
                      // 🔁 Step 4: Alokasikan stock ke setiap build line
                      for (const line of buildLines) {
                        const sub_part_id = line.bom_item_detail?.sub_part;
                        const line_qty = line.quantity;
                        if (!sub_part_id || !line_qty) {
                          console.warn(`⚠️ Build line tidak valid`);
                          continue;
                        }
                        if (sub_part_id === newStockItem.part) {
                          itemsToAllocate.push({
                            build_line: line.pk,
                            stock_item: newStockItem.pk,
                            quantity: quantity.toString(),
                          });
                          break; // lanjut ke picking berikutnya
                        }
                      }
                    }
                    // 🔁 Step 5: Jalankan alokasi
                    if (itemsToAllocate.length > 0) {
                      await inventree.post(`/build/${idInventree}/allocate/`, {
                        items: itemsToAllocate,
                      });
                      console.log("✅ Alokasi selesai:", itemsToAllocate);
                    } else {
                      console.warn("⚠️ Tidak ada item untuk dialokasikan.");
                    }
                  }
                  await taskService.complete(task);
                } catch (error) {
                  console.error("❌ Error:", error.message);
                  await taskService.handleFailure(task, {
                    errorMessage: error.message,
                    errorDetails: error.stack,
                    retries: 0,
                    retryTimeout: 1000,
                  });
                }
              }
            );
        
            client.subscribe("complete_build_manufacture",
  async function ({ task, taskService }) {
    console.log("🚀 Task Dijalankan:", task.id);

    // Setup client untuk Inventree
    const inventree = axios.create({
      baseURL: `${process.env.SERVER_INVENTREE}/api`,
      headers: {
        Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    try {
      // Ambil variable dari Camunda
      const reference = task.variables.get("build_order");
      if (!reference) {
        throw new Error("❌ Variable 'build_order' tidak ditemukan");
      }

      const status = "Finished Request Manufacture";

      // Update ke GraphQL
      const responseQuery = await configureQuery(fastify, {
        graph: {
          method: "mutate",
          endpoint: process.env.GRAPHQL_API,
          gqlQuery: `
            mutation updateManufactureRequest($reference: String!, $status: String!) {
              update_manufacture_request(
                where: { reference: { _eq: $reference } },
                _set: { status: $status }
              ) {
                affected_rows
              }
            }
          `,
          variables: { reference, status },
        },
      });

      console.log(
        "📊 response Query:",
        JSON.stringify(responseQuery?.data, null, 2)
      );

      // Ambil Build Order dari Inventree
      const { data } = await inventree.get(
        `/build/?reference=${encodeURIComponent(reference)}`
      );

      const buildId = data?.results?.[0]?.pk;
      if (!buildId) {
        throw new Error(
          `❌ Build Order dengan reference '${reference}' tidak ditemukan`
        );
      }

      console.log(`✅ Build ID ditemukan: ${buildId}`);

      // Selesaikan Build di Inventree
      await inventree.post(`/build/${buildId}/finish/`);
      console.log(`✅ Build Order ${buildId} berhasil difinish`);

      // Selesaikan task di Camunda
      await taskService.complete(task);
    } catch (error) {
      console.error("❌ Error:", error.message);

      await taskService.handleFailure(task, {
        errorMessage: error.message,
        errorDetails: error.stack || "No stack trace",
        retries: 0,
        retryTimeout: 1000,
      });
    }
  }
);
        
            client.subscribe("complete_build", async function ({ task, taskService }) {
              console.log("🚀 Task Dijalankan:", task.id);
        
              const inventree = axios.create({
                baseURL: `${process.env.SERVER_INVENTREE}/api`,
                headers: {
                  Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                  "Content-Type": "application/json",
                },
                timeout: 10000,
              });
        
              try {
                const reference = task.variables.get("build_order");
                const proc_inst_id = task.processInstanceId;
        
                // Query ke GraphQL untuk data task_worker
                const responseQuery = await configureQuery(fastify, {
                  graph: {
                    method: "query",
                    endpoint: process.env.GRAPHQL_API,
                    gqlQuery: `
                            query taskWorker($proc_inst_id: String!) {
                                task_worker(where: { proc_inst_id: { _eq: $proc_inst_id } }) {
                                    part_pk
                                    quantity_finish_qc
                                    quantity_reject
                                }
                            }`,
                    variables: { proc_inst_id },
                  },
                });
        
                const fetchData = responseQuery?.data?.[0]?.graph?.task_worker?.[0];
                console.log(
                  "📊 response Query:",
                  JSON.stringify(responseQuery.data, null, 2)
                );
        
                if (!fetchData) {
                  throw new Error(
                    `❌ Tidak ada task_worker untuk proc_inst_id: ${proc_inst_id}`
                  );
                }
        
                const {
                  quantity_finish_qc: quantityFinish,
                  quantity_reject: quantityReject,
                  part_pk: partId,
                } = fetchData;
        
                // Ambil Build ID
                const { data } = await inventree.get(
                  `/build/?reference=${encodeURIComponent(reference)}`
                );
                const buildId = data?.results?.[0]?.pk;
                if (!buildId) {
                  throw new Error(
                    `❌ Build Order dengan reference '${reference}' tidak ditemukan`
                  );
                }
        
                console.log(`✅ Build ID ditemukan: ${buildId}`);
        
                // Ambil tanggal hari ini (format YYYY-MM-DD)
                const today = new Date().toISOString().split("T")[0];
        
                // Output OK
                const payloadOK = {
                  quantity: quantityFinish,
                  batch_code: `PRODUKSI ${today}`,
                };
        
                await inventree.post(
                  `/build/${encodeURIComponent(buildId)}/create-output/`,
                  payloadOK
                );
        
                // Ambil stock item ID terbaru untuk part
                const stockResponse = await inventree.get(
                  `/stock/?part=${encodeURIComponent(partId)}&ordering=-updated&limit=1&offset=0&build=${encodeURIComponent(buildId)}`
                );
        
                const latestStockItem = stockResponse?.data?.results?.[0];
                if (!latestStockItem) {
                  throw new Error("❌ Stock item terbaru tidak ditemukan.");
                }
        
                const stockItemId = latestStockItem.pk;
                console.log(`✅ Stock item ID ditemukan: ${stockItemId}`);
                
        
                // Update ke Hasura
                const responseMutation = await configureQuery(fastify, {
                  graph: {
                    method: "mutate",
                    endpoint: process.env.GRAPHQL_API,
                    gqlQuery: `
                            mutation updateStockFinish($proc_inst_id: String!, $stockItemId: Int!) {
                                update_task_worker(
                                    where: { proc_inst_id: { _eq: $proc_inst_id } },
                                    _set: { stock_item_id_finish: $stockItemId }
                                ) {
                                    affected_rows
                                }
                            }
                        `,
                    variables: {
                      proc_inst_id,
                      stockItemId,
                    },
                  },
                });
        
                console.log(
                  "📊 response Hasura:",
                  JSON.stringify(responseMutation.data, null, 2)
                );
        
                // Output REJECT (jika ada)
                if (quantityReject) {
                  const payloadReject = {
                    quantity: quantityReject,
                    batch_code: `REJECT PRODUKSI ${today}`,
                  };
        
                  await inventree.post(
                    `/build/${encodeURIComponent(buildId)}/create-output/`,
                    payloadReject
                  );
        
                  const stockResponseReject = await inventree.get(
                    `/stock/?part=${encodeURIComponent(
                      partId
                    )}&ordering=-updated&limit=1&offset=0&build=${encodeURIComponent(buildId)}`
                  );
        
                  const latestStockItemReject = stockResponseReject?.data?.results?.[0];
                  if (!latestStockItemReject) {
                    throw new Error("❌ Stock item terbaru (reject) tidak ditemukan.");
                  }
        
                  const stockItemIdReject = latestStockItemReject.pk;
        
                  // Update ke Hasura
                  const responseMutationReject = await configureQuery(fastify, {
                    graph: {
                      method: "mutate",
                      endpoint: process.env.GRAPHQL_API,
                      gqlQuery: `
                        mutation updateStockReject($proc_inst_id: String!, $stockItemIdReject: Int!) {
                            update_task_worker(
                                where: { proc_inst_id: { _eq: $proc_inst_id } },
                                _set: { stock_item_id_reject: $stockItemIdReject }
                            ) {
                                affected_rows
                            }
                        }
                    `,
                      variables: {
                        proc_inst_id,
                        stockItemIdReject,
                      },
                    },
                  });
        
                  console.log(
                    "📊 response Hasura (Reject):",
                    JSON.stringify(responseMutationReject.data, null, 2)
                  );
                } else {
                  console.log("✅ Tidak ada quantity reject");
                }
        
                await taskService.complete(task);
                console.log("✅ Task Selesai:", task.id);
              } catch (error) {
                console.error("❌ Error:", error.message);
                await taskService.handleFailure(task, {
                  errorMessage: error.message,
                  errorDetails: error.stack || "No stack trace",
                  retries: 0,
                  retryTimeout: 1000,
                });
              }
            });
        
            client.subscribe("getFlaggedComponents",
          async function ({ task, taskService }) {
            console.log("🚀 Task Dijalankan:", task.id);
        
            try {
              const proc_inst_id = task.processInstanceId;
        
              const response = await configureQuery(fastify, {
                graph: {
                  method: "query",
                  endpoint: process.env.GRAPHQL_API,
                  gqlQuery: `
                    query MyQuery($proc_inst_id: [String!]) {
                      manufacture_request(where: {proc_inst_id: {_in: $proc_inst_id}}) {
                        proc_inst_id
                        manufacture_request_to_picking(where: {is_flagged: {_eq: true}}) {
                          part_id
                        }
                      }
                    }
                  `,
                  variables: {
                    proc_inst_id
                  },
                },
                query: [],
              });
        
              console.log(
                "📊 response Hasura:",
                JSON.stringify(response.data, null, 2)
              );
        
              // Ambil array part_id dari response
              const partIds = response.data?.manufacture_request?.flatMap(mr =>
                mr.manufacture_request_to_picking.map(p => p.part_id)
              ) || [];
        
              console.log("📦 partIds yang dikirim ke Camunda:", partIds);
        
              await taskService.complete(task, {
                variables: {
                  components_pk: { value: partIds, type: "json" }, // pakai "json" agar array tetap terjaga
                },
              });
            } catch (error) {
              console.error(
                "❌ Terjadi kesalahan saat memproses task:",
                error.message
              );
              await taskService.handleFailure(task, {
                errorMessage: error.message,
                errorDetails: error.stack,
                retries: 0,
                retryTimeout: 1000,
              });
            }
          }
        );
        
            client.subscribe("Insert_SO", async function ({ task, taskService }) {
      console.log("🚀 Task Dijalankan:", task.id);
      const inventree = axios.create({
        baseURL: `${process.env.SERVER_INVENTREE}/api`,
        headers: {
          Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      });
      try {
        const proc_inst_id = task.processInstanceId;
        const location_id = task.variables.get("location_id");
        const type = task.variables.get("type");
        const ownership_scope = task.variables.get("ownership");
        const status = "unprocessed";
        const created_at = new Date().toLocaleString("sv-SE", {
          timeZone: "Asia/Jakarta",
        });
        const items = await inventree.get(`/stock/?location=${location_id}`);
        const item = items?.data?.results?.[0];
        const part_id = item.part;
        const location_name = item.location_name;
        const response = await configureQuery(fastify, {
          graph: {
            method: "mutate",
            endpoint: process.env.GRAPHQL_API,
            gqlQuery: `
                            mutation insertSO(
                                $proc_inst_id: String!,
                                $part_id: Int!,
                                $location_id: Int!,
                                $type: String!,
                                $ownership_scope: String!,
                                $status: String!,
                                $created_at: timestamp!
                            ) {
                                insert_stock_opname(
                                    objects: {
                                        proc_inst_id: $proc_inst_id,
                                        part_id: $part_id,
                                        location_id: $location_id,
                                        type: $type,
                                        ownership_scope: $ownership_scope,
                                        status: $status,
                                        created_at: $created_at
                                    }
                                ) {
                                    affected_rows
                                }
                            }
                        `,
            variables: {
              proc_inst_id,
              part_id,
              location_id,
              type,
              ownership_scope,
              status,
              created_at,
            },
          },
          query: [],
        });
        console.log(
          `${part_id} - ${location_id} - ${type} - ${ownership_scope} - ${status} - ${created_at}`
        );

        console.log(
          `🔄 proc_inst_id "${proc_inst_id}" berhasil disimpan ke tabel stock_opname`
        );
        console.log(
          "📊 response Hasura:",
          JSON.stringify(response.data, null, 2)
        );
        const variables = new Variables();
        variables.set("business_key", location_name);

        await taskService.complete(task, variables);
        console.log("✅ Task Selesai:", task.id);
      } catch (error) {
        console.error(
          "❌ Terjadi kesalahan saat memproses task:",
          error.message
        );
        await handleFailureDefault(task, {
          errorMessage: error.message,
          errorDetails: error.stack,
          retries: 0,
          retryTimeout: 1000,
        });
      }
    });
    
    client.subscribe("ConvertQuantityInbound", async ({ task, taskService }) => {
  console.log("🚀 TTask Inbound:", task.id);

  try {
    const inventree = axios.create({
      baseURL: `${process.env.SERVER_INVENTREE}/api`,
      headers: {
        Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
      },
      timeout: 10000,
    });

    const proc_inst_id = task.processInstanceId;
    const pack_gudang = task.variables.get("pack_gudang");
    const pack_supplier = task.variables.get("pack_supplier");
    const weight_per_unit = task.variables.get("weight_per_unit");
    const unit_konversi = task.variables.get("unit_konversi");
    const merge_decision_inbound = task.variables.get("merge_decision_inbound");

    const merge = merge_decision_inbound === "BISA" ? true : false;

    // ambil data mi_products
    const getInbound =
      (
        await configureQuery(fastify, {
          graph: {
            method: "query",
            endpoint: process.env.GRAPHQL_API,
            gqlQuery: `
              query($proc_inst_id: String!) {
                mi_products(where: { proc_inst_id: { _eq: $proc_inst_id } }) {
                  part_pk 
                  quantity_received 
                  quantity_konversi 
                  stock_item_id
                }
              }
            `,
            variables: { proc_inst_id },
          },
          query: [],
        })
      )?.data?.[0]?.graph?.mi_products || [];

    console.log("getInbound:", JSON.stringify(getInbound));

    // helper upsert parameter
    const upsertParameter = async (part_pk, template, value) => {
      try {
        const exist = await inventree.get(
          `/part/parameter/?part=${part_pk}&template=${template}`
        );
        console.log("Cek exist:", JSON.stringify(exist.data, null, 2));

        if (exist.data && exist.data.results && exist.data.results.length > 0) {
          const paramId = exist.data.results[0].pk;
          await inventree.patch(`/part/parameter/${paramId}/`, {
            data: value,
          });
          console.log(`♻️ Update parameter ${paramId} (template=${template}) OK`);
        } else {
          await inventree.post("/part/parameter/", {
            part: part_pk,
            template,
            data: value,
          });
          console.log(`✅ Insert parameter (template=${template}) OK`);
        }
      } catch (err) {
        console.error(`❌ Gagal upsert parameter (template=${template}):`, err.message);
        if (err.response?.data) {
          console.error("Response data:", err.response.data);
        }
        throw err;
      }
    };

    for (const row of getInbound) {
      const { part_pk, quantity_received, quantity_konversi, stock_item_id } = row;
      console.log(quantity_konversi, quantity_received, stock_item_id);

      if (quantity_konversi !== quantity_received) {
        const payload = {
          items: [
            {
              pk: stock_item_id,
              quantity: quantity_konversi,
            },
          ],
          notes: `Konversi quantity supplier ke gudang | Proc inst ID: ${proc_inst_id}`,
        };
        console.log("📦 Payload Inventree:", payload);
        await inventree.post("/stock/count/", payload);
      }

      await upsertParameter(part_pk, 2, JSON.stringify(weight_per_unit));
      await upsertParameter(part_pk, 3, String(pack_gudang));
      await upsertParameter(part_pk, 4, String(pack_supplier));
      await upsertParameter(part_pk, 5, String(merge));
    }

    await taskService.complete(task);
    console.log("✅ Task Selesai:", task.id);
    // throw new Error("🔥 Error testing ConvertQuantityInbound");
  } catch (err) {
    console.error("❌ Error ConvertQuantityInbound:", err.message);
    if (err.response?.data) {
      console.error("Response data:", err.response.data);
    }

    await taskService.handleFailure(task, {
      errorMessage: err.message,
      errorDetails: err.stack,
      retries: 0,
      retryTimeout: 1000,
    });
  }
});
        
        client.subscribe("Count_Stock", async function ({ task, taskService }) {
              console.log("🚀 Task Dijalankan:", task.id);
        
              const inventree = axios.create({
                baseURL: `${process.env.SERVER_INVENTREE}/api`,
                headers: {
                  Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                  "Content-Type": "application/json",
                },
                timeout: 10000,
              });
        
              try {
                const stock_item_id = task.variables.get("stock_item_id");
                const quantity_count = task.variables.get("quantity_count");
                const notes = task.variables.get("notes");
                const proc_inst_id = task.processInstanceId;
        
                const payload = {
                  items: [
                    {
                      pk: stock_item_id,
                      quantity: quantity_count,
                    },
                  ],
                  notes: `Adjustment Stock Opname | Proc ID: ${proc_inst_id} | ${notes}`,
                };
        
                const response = await inventree.post("stock/count/", payload);
                console.log("📊 Response InvenTree:", response.data);
        
                await taskService.complete(task);
                console.log("✅ Task Selesai:", task.id);
              } catch (error) {
                console.error("❌ Error:", error.message);
                await taskService.handleFailure(task, {
                  errorMessage: error.message,
                  errorDetails: error.stack || "No stack trace",
                  retries: 0,
                  retryTimeout: 1000,
                });
              }
            });
        
    client.subscribe("checkStockMutasi", async ({ task, taskService }) => {
          console.log("🚀 Task Check Stock Mutasi Dijalankan:", task.id);
    
          try {
            const inventree = axios.create({
              baseURL: `${process.env.SERVER_INVENTREE}/api`,
              headers: {
                Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
              },
              timeout: 10000,
            });
    
            const proc_inst_id = task.processInstanceId;
    
            // 🔹 Update mutasi_request ke completed
            await configureQuery(fastify, {
              graph: {
                method: "mutate",
                endpoint: process.env.GRAPHQL_API,
                gqlQuery: `
              mutation($proc_inst_id: String!, $status: String!) {
                update_mutasi_request(
                  where: { proc_inst_id: { _eq: $proc_inst_id } }
                  _set: { status: $status }
                ) { affected_rows }
              }`,
                variables: { proc_inst_id, status: "completed" },
              },
              query: [],
            });
    
            // 🔹 Ambil mutasi_request
            const mutasiReq =
              (
                await configureQuery(fastify, {
                  graph: {
                    method: "query",
                    endpoint: process.env.GRAPHQL_API,
                    gqlQuery: `
                query($proc_inst_id: String!) {
                  mutasi_request(where: { proc_inst_id: { _eq: $proc_inst_id } }) {
                    id part_id
                  }
                }`,
                    variables: { proc_inst_id },
                  },
                  query: [],
                })
              )?.data?.[0]?.graph?.mutasi_request || [];
    
            if (!mutasiReq.length)
              throw new Error("mutasi_request tidak ditemukan");
    
            // 🔹 Ambil mutasi_request_detail
            const details =
              (
                await configureQuery(fastify, {
                  graph: {
                    method: "query",
                    endpoint: process.env.GRAPHQL_API,
                    gqlQuery: `
                query($ids: Int!) {
                  mutasi_request_details(where: { request_id: { _eq: $ids } }) {
                    type location_id quantity_physical quantity_data quantity_movement
                  }
                }`,
                    variables: { ids: mutasiReq[0].id },
                  },
                  query: [],
                })
              )?.data?.[0]?.graph?.mutasi_request_details || [];
    
            if (!details.length) throw new Error("Mutasi detail kosong");
    
            const [src, dest] = [
              details.find((d) => d.type === "source"),
              details.find((d) => d.type === "destination"),
            ];
    
            // 🔹 Tentukan mismatch
            const mismatch =
              src && dest && src.quantity_movement !== dest.quantity_movement
                ? details
                : details.filter((d) => d.quantity_physical !== d.quantity_data);
    
            const isValid = mismatch.length === 0;
    
            // 🔹 Ambil data produk
            const product_name = (
              await inventree.get(`/part/${mutasiReq[0].part_id}/`)
            )?.data?.full_name;
    
            // 🔹 Ambil location PK dari Inventree
            const locationPks = await Promise.all(
              mismatch.map(async (item) => {
                try {
                  const res = await inventree.get(
                    `/stock/location/?name=${item.location_id}`
                  );
                  return res.data.results?.[0]?.pk || null;
                } catch {
                  return null;
                }
              })
            );
    
            // 🔹 Format date (YYYY-MM-DD HH:mm:ss)
            const pad = (n) => String(n).padStart(2, "0");
            const now = new Date();
            const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
              now.getDate()
            )} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(
              now.getSeconds()
            )}`;
    
            // 🔹 Kirim ke Camunda
            const variables = new Variables();
            variables.set("isValid", isValid);
            variables.setTyped("location_ids", {
              value: JSON.stringify(locationPks),
              type: "Object",
              valueInfo: {
                serializationDataFormat: "application/json",
                objectTypeName: "java.util.ArrayList",
              },
            });
            variables.set("part_id", mutasiReq[0].part_id);
            variables.set("type", "Mutasi");
            variables.set("ownership", "gudang");
            variables.set("date", date);
            variables.set("product_name", product_name);
    
            await taskService.complete(task, variables);
            console.log("✅ Task selesai:", task.id);
          } catch (err) {
            console.error("❌ Error Check Stock Mutasi:", err.message);
            if (err.response?.data)
              console.error("Response data:", err.response.data);
    
            await taskService.handleFailure(task, {
              errorMessage: err.message,
              errorDetails: err.stack,
              retries: 0,
              retryTimeout: 1000,
            });
          }
        });
    
        client.subscribe("transferStockMutasi", async ({ task, taskService }) => {
          console.log("🚀 Task Transfer Stock Mutasi Dijalankan:", task.id);
    
          try {
            const inventree = axios.create({
              baseURL: `${process.env.SERVER_INVENTREE}/api`,
              headers: {
                Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
              },
              timeout: 10000,
            });
    
            const proc_inst_id = task.processInstanceId;
    
            const mutasiReq =
              (
                await configureQuery(fastify, {
                  graph: {
                    method: "query",
                    endpoint: process.env.GRAPHQL_API,
                    gqlQuery: `
                query($proc_inst_id: String!) {
                  mutasi_request(where: { proc_inst_id: { _eq: $proc_inst_id } }) {
                    id
                  }
                }`,
                    variables: { proc_inst_id },
                  },
                  query: [],
                })
              )?.data?.[0]?.graph?.mutasi_request || [];
    
            if (!mutasiReq.length)
              throw new Error(
                "mutasi_request tidak ditemukan untuk proc_inst_id ini"
              );
    
            const details =
              (
                await configureQuery(fastify, {
                  graph: {
                    method: "query",
                    endpoint: process.env.GRAPHQL_API,
                    gqlQuery: `
                query($ids: Int!) {
                  mutasi_request_details(where: { request_id: { _eq: $ids } }) {
                    type location_id sku_id quantity_movement
                  }
                }`,
                    variables: { ids: mutasiReq[0].id },
                  },
                  query: [],
                })
              )?.data?.[0]?.graph?.mutasi_request_details || [];
    
            if (!details.length) throw new Error("Mutasi detail kosong");
    
            const source = details.find((d) => d.type === "source");
            const destination = details.find((d) => d.type === "destination");
    
            if (!source || !destination) {
              throw new Error("Source atau Destination tidak ditemukan");
            }
    
            let destLocationPk = null;
            try {
              const res = await inventree.get(
                `/stock/location/?name=${destination.location_id}`
              );
              destLocationPk = res.data.results?.[0]?.pk || null;
            } catch {
              destLocationPk = null;
            }
    
            if (!destLocationPk) {
              throw new Error(
                `Lokasi tujuan ${destination.location_id} tidak ditemukan di Inventree`
              );
            }
    
            const transferPayload = {
              items: [
                {
                  pk: source.sku_id, // pk stock asal
                  quantity: destination.quantity_movement, // jumlah yang dipindahkan
                },
              ],
              notes: `Mutasi Stock | Proc Inst ID: ${proc_inst_id}`,
              location: destLocationPk, // pk lokasi tujuan
            };
    
            console.log("📦 Transfer Payload:", transferPayload);
    
            const res = await inventree.post(`/stock/transfer/`, transferPayload);
            console.log("✅ Transfer response:", res.data);
    
            await taskService.complete(task);
            console.log("✅ Task selesai:", task.id);
          } catch (err) {
            console.error("❌ Error Transfer Stock Mutasi:", err.message);
            if (err.response?.data)
              console.error("Response data:", err.response.data);
    
            await taskService.handleFailure(task, {
              errorMessage: err.message,
              errorDetails: err.stack,
              retries: 0,
              retryTimeout: 1000,
            });
          }
        });
        
         client.subscribe("Trigger_Bulanan", async function ({ task, taskService }) {
            try {
                console.log(">> Menerima task Trigger_Load");

                const marketplaces = ["Tokopedia", "Shopee", "Lazada"];
                const utc = new Date();
                const wib = new Date(utc.getTime() + 7 * 60 * 60 * 1000); // UTC +7
                const hhmmss = wib.toISOString().substring(11, 19); // ambil HH:MM:SS dari format ISO

                for (const mp of marketplaces) {

                    const businessKey = `${mp}:Bulanan:${hhmmss}`;
                    console.log(`>> Memulai proses Load_Data untuk ${mp}`);

                    // Jalankan process Mirorim_Operasional.Load_Data
                    const response = await axios.post(
                        `${CAMUNDA_API}engine-rest/process-definition/key/Mirorim_Operasional.Load_Data/start`,
                        {
                            variables: {
                                load: { value: "bulanan", type: "String" },
                            },
                            businessKey: businessKey,
                        }
                    );

                    const newProcInstId = response.data.id;
                    console.log(`>> ${mp} - Proses Load_Data berhasil dijalankan:`, newProcInstId);

                    // Insert ke GraphQL
                    const created_at = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString();
                    const dataInsert = {
                        graph: {
                            method: "mutate",
                            endpoint: process.env.GRAPHQL_API,
                            gqlQuery: `
                        mutation InsertLoadData(
                            $proc_inst_id: String!,
                            $date: timestamp!,
                            $load: String!
                        ) {
                            insert_mo_load_data(objects: {
                                proc_inst_id: $proc_inst_id,
                                created_at: $date,
                                jenis_load: $load
                            }) {
                                affected_rows
                            }
                        }
                    `,
                            variables: {
                                proc_inst_id: newProcInstId,
                                date: created_at,
                                load: "bulanan",
                            },
                        },
                        query: [],
                    };

                    const responseInsert = await configureQuery(fastify, dataInsert);
                    console.log(`>> ${mp} - Insert result:`, JSON.stringify(responseInsert, null, 2));
                }

                // Selesaikan task setelah semua marketplace selesai
                await taskService.complete(task);
                console.log(">> Semua proses Load_Data selesai dijalankan");

            } catch (err) {
                console.error(">> Gagal men-trigger Load_Data:", err.message);
                await taskService.handleFailure(task, {
                    errorMessage: "Gagal trigger Mirorim_Operasional.Load_Data",
                    errorDetails: err.toString(),
                    retries: 1,
                    retryTimeout: 5000,
                });
            }
        });
        
        client.subscribe("getInstanceGenericStaging", async function ({ task, taskService }) {
                console.log("🚀 Task Dijalankan:", task.id);
        
                try {
                  const proc_inst_id = task.processInstanceId;
                  const request_detail_id = task.variables.get("id");
                  const type = task.variables.get("destination_type");
                  const location_id = task.variables.get("WIPLocation");
                  const table_reference = task.variables.get("table_reference");
                  const status = "unprocessed";
                  const now = new Date();
                  const created_at = new Date(now.getTime() + 7 * 60 * 60 * 1000)
                    .toISOString()
                    .replace("T", " ")
                    .replace("Z", "");
                  const checkQuery = {
                    graph: {
                      method: "query",
                      endpoint: process.env.GRAPHQL_API,
                      gqlQuery: `
                            query CheckDeliveryStaging($proc_inst_id: String!) {
                                delivery_staging(where: {proc_inst_id: {_eq: $proc_inst_id}}) {
                                    id
                                    proc_inst_id
                                }
                            }
                        `,
                      variables: { proc_inst_id },
                    },
                  };
                  const checkResult = await configureQuery(fastify, checkQuery);
                  console.log(
                    "🔎 Hasil checkQuery:",
                    JSON.stringify(checkResult, null, 2)
                  );
                  const existing =
                    checkResult?.data?.[0]?.graph?.delivery_staging ?? [];
                  if (existing.length > 0) {
                    console.log(
                      `ℹ️ Data untuk proc_inst_id ${proc_inst_id} sudah ada (${existing.length} row), skip insert.`
                    );
                  } else {
                    const insertQuery = {
                      graph: {
                        method: "mutate",
                        endpoint: process.env.GRAPHQL_API,
                        gqlQuery: `
                                mutation InsertDeliveryStaging(
                                    $request_detail_id: Int,
                                    $proc_inst_id: String,
                                    $type: String,
                                    $location_id: Int,
                                    $created_at: timestamp,
                                    $status: String,
                                    $table_reference: String
                                ) {
                                    insert_delivery_staging(objects: {
                                        request_id: $request_detail_id,
                                        proc_inst_id: $proc_inst_id,
                                        type: $type,
                                        location_id: $location_id,
                                        created_at: $created_at,
                                        status: $status
                                        table_reference: $table_reference
                                    }) {
                                        affected_rows
                                        returning {
                                            id
                                            request_id
                                            proc_inst_id
                                            type
                                            location_id
                                            transfered_at
                                            created_at
                                            status
                                            table_reference
                                        }
                                    }
                                }
                            `,
                        variables: {
                          request_detail_id,
                          proc_inst_id,
                          type,
                          location_id,
                          created_at,
                          status,
                          table_reference
                        },
                      },
                      query: [],
                    };
        
                    console.log(
                      "📦 Data siap dikirim ke delivery_staging:",
                      insertQuery
                    );
                    const insertResult = await configureQuery(fastify, insertQuery);
                    console.log("✅ Insert berhasil:", insertResult);
                  }
        
                  // 3️⃣ Selesaikan task Camunda
                  await taskService.complete(task);
                  console.log(`✅ Task ${task.id} berhasil diselesaikan.`);
                } catch (error) {
                  if (error.response) {
                    console.error(
                      "❌ Gagal memproses task:",
                      error.response.status,
                      error.response.data
                    );
                  } else {
                    console.error("❌ Gagal memproses task:", error.message);
                  }
                }
              }
            );
        
            client.subscribe("getToleransiPartStaging", async function ({ task, taskService }) {
                console.log("🚀 Task Dijalankan:", task.id);
                try {
                  const source_stock = task.variables.get("source_stock");
                  const inventree = axios.create({
                    baseURL: `${process.env.SERVER_INVENTREE}/api`,
                    headers: {
                      Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                      "Content-Type": "application/json",
                    },
                    timeout: 10000,
                  });
                  const stockResponse = await inventree.get(`/stock/${source_stock}/`);
                  const stockData = stockResponse.data;
                  const locationId = stockData.location;
                  if (!locationId) {
                    throw new Error("Stock tidak memiliki lokasi (locationId kosong)");
                  }
                  const locationResponse = await inventree.get(
                    `/stock/location/${locationId}/`
                  );
                  const locationData = locationResponse.data;
                  const description =
                    locationData.description || "Deskripsi tidak tersedia";
                  console.log("📦 Location Description:", description);
                  await taskService.complete(task, {
                    description: description,
                  });
                  console.log(
                    `✅ Task ${task.id} berhasil diselesaikan dengan description = ${description}`
                  );
                } catch (error) {
                  if (error.response) {
                    console.error(
                      "❌ Gagal memproses task:",
                      error.response.status,
                      error.response.data
                    );
                  } else {
                    console.error("❌ Gagal memproses task:", error.message);
                  }
                }
              }
            );
        
            client.subscribe("transferStockStagingArea", async function ({ task, taskService }) {
                        console.log("🚀 Task Dijalankan:", task.id);
                        try {
                            const proc_inst_id = task.processInstanceId;
                            const source_stock = task.variables.get("source_stock");
                            const part_id = task.variables.get("part_id");
                            const WIPLocation = task.variables.get("WIPLocation");
                            const quantity_input = task.variables.get("quantity_input");
                            const quantity_staging = task.variables.get("quantity_staging");
                            const now = new Date();
                            const created_at = new Date(now.getTime() + 7 * 60 * 60 * 1000)
                                .toISOString()
                                .replace("T", " ")
                                .replace("Z", "");
                            const selisih = quantity_input - quantity_staging;
                            console.log("📦 Selisih:", selisih);
                            const inventree = axios.create({
                                baseURL: `${process.env.SERVER_INVENTREE}/api`,
                                headers: {
                                    Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                                    "Content-Type": "application/json",
                                },
                                timeout: 10000,
                            });
                            const checkHistory = async (itemPk, notes) => {
                                try {
                                    const res = await inventree.get("/stock/track/", {
                                        params: { item: itemPk, search: notes },
                                    });
                                    return res?.data?.count > 0;
                                } catch (err) {
                                    console.error("⚠️ Error checkHistory:", err.message);
                                    return false;
                                }
                            };
                            if (selisih !== 0) {
                                const notesAdj = `Adjustment Packaging Supplier | Proc Inst ID : ${proc_inst_id}`;
                                const alreadyAdjusted = await checkHistory(source_stock, notesAdj);
                                if (!alreadyAdjusted) {
                                    console.log("📦 Melakukan adjustment stock:", notesAdj);
                                    await inventree.post(`/stock/${selisih > 0 ? "add" : "remove"}/`, {
                                        items: [{ pk: source_stock, quantity: Math.abs(selisih) }],
                                        notes: notesAdj,
                                    });
                                } else {
                                    console.log("⏩ Adjustment sudah pernah dilakukan, skip.");
                                }
                            }
                            const notesTransfer = `Mutasi Ke Lokasi WIP | Proc Inst ID: ${proc_inst_id}`;
                            const alreadyTransferred = await checkHistory(source_stock, notesTransfer);
                            if (!alreadyTransferred) {
                                console.log("🚚 Melakukan transfer ke WIP:", notesTransfer);
                                const transferPayload = {
                                    items: [
                                        {
                                            pk: Number(source_stock),
                                            quantity: quantity_input,
                                        },
                                    ],
                                    notes: notesTransfer,
                                    location: WIPLocation,
                                };
                                await inventree.post("/stock/transfer/", transferPayload);
                                const { data: getData } = await inventree.get(
                                    `/stock/?location=${WIPLocation}&part=${part_id}&ordering=-updated&limit=1`
                                );
                                let newStockItemId = null;
                                if (getData?.results?.length > 0) {
                                    newStockItemId = getData.results[0].pk;
                                }
                                console.log("new stock_item_id", newStockItemId);
                                const response = await configureQuery(fastify, {
                                    graph: {
                                        method: "mutate",
                                        endpoint: process.env.GRAPHQL_API,
                                        gqlQuery: `mutation MyMutation($proc_inst_id: String!, $status: String!, $source_id: Int!, $date: timestamp!) {
                                        update_delivery_staging(where: {proc_inst_id: {_eq: $proc_inst_id}}, _set: {status: $status, source_id_wip: $source_id, transfered_at: $date}) {
                                            affected_rows
                                        }
                                        }`,
                                        variables: {
                                            proc_inst_id,
                                            status: "completed",
                                            source_id: newStockItemId,
                                            date: created_at,
                                        },
                                    },
                                    query: [],
                                });
                                console.log("📊 response Hasura:", JSON.stringify(response.data, null, 2));
                            } else {
                                console.log("⏩ Transfer ke WIP sudah pernah dilakukan, skip.");
                            }
                            await taskService.complete(task);
                            console.log("✅ Task selesai:", task.id);
                        } catch (error) {
                            if (error.response) {
                                console.error("❌ Gagal memproses task:", error.response.status, error.response.data);
                            } else {
                                console.error("❌ Gagal memproses task:", error.message);
                            }
                        }
                    });
            
                    client.subscribe("Check_Stock", async function ({ task, taskService }) {
                      try {
                        console.log(`🕒 Task "${task.topicName}" diterima (${task.id}) — menunggu 10 detik sebelum eksekusi...`);
                        await new Promise((resolve) => setTimeout(resolve, 10000)); // ⏳ delay 10 detik
                    
                        const inventree = axios.create({
                          baseURL: `${process.env.SERVER_INVENTREE}/api`,
                          headers: {
                            Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                          },
                          timeout: 10000,
                        });
                    
                        const proc_inst_id = task.processInstanceId;
                    
                        const checkQuery = {
                          graph: {
                            method: "query",
                            endpoint: process.env.GRAPHQL_API,
                            gqlQuery: `
                              query MyQuery($proc_inst_id: String!) {
                                mutasi_request(where: {proc_inst_id: {_eq: $proc_inst_id}}) {
                                  part_id
                                  mutasi_request_to_mutasi_details {
                                    quantity_data
                                    quantity_physical
                                    type
                                    location_id
                                  }
                                  mutasi_request_to_delivery_staging {
                                    source_id_wip
                                    type
                                    location_id
                                    status
                                  }
                                }
                              }
                            `,
                            variables: { proc_inst_id },
                          },
                        };
                    
                        const checkResult = await configureQuery(fastify, checkQuery);
                    
                        const mutasiReq = checkResult?.data?.[0]?.graph?.mutasi_request ?? [];
                        if (mutasiReq.length === 0)
                          throw new Error("Mutasi request tidak ditemukan.");
                    
                        const details = mutasiReq[0].mutasi_request_to_mutasi_details ?? [];
                        const part_id = mutasiReq[0].part_id;
                    
                        const product_name = (await inventree.get(`/part/${part_id}/`))?.data?.full_name;
                    
                        let SO_Mutasi = true;
                        const location_idt = [];
                        const location_idg = [];
                    
                        for (const d of details) {
                          // 🚫 Skip lokasi WIP
                          if (d.location_id && d.location_id.toLowerCase().includes("wip")) {
                            console.log(`⏭️ Melewati lokasi WIP: ${d.location_id}`);
                            continue;
                          }
                    
                          // 🔍 Cek selisih
                          if (d.quantity_data !== d.quantity_physical) {
                            SO_Mutasi = false;
                            console.log(`⚠️ Selisih ditemukan di lokasi ${d.location_id}`);
                    
                            const res = await inventree.get(`/stock/location/?name=${d.location_id}`);
                    
                            if (res.data && res.data.results && res.data.results.length > 0) {
                              const firstLocation = res.data.results[0];
                              const location_description = firstLocation.description?.toLowerCase() || "";
                    
                              if (location_description.includes("toko")) {
                                location_idt.push(firstLocation.pk);
                              } else if (location_description.includes("gudang")) {
                                location_idg.push(firstLocation.pk);
                              } else {
                                console.log(`⚠️ Lokasi ${d.location_id} tidak dikenali (bukan toko/gudang)`);
                              }
                            }
                          }
                        }
                    
                        if (location_idt.length === 0 && location_idg.length === 0) {
                          console.log("✅ Tidak ada lokasi toko/gudang terdeteksi — set SO_Mutasi = true");
                          SO_Mutasi = true;
                        }
                    
                        // Buat variabel Camunda
                        const date = new Date().toLocaleString("sv-SE").replace("T", " ");
                        const variables = new Variables();
                        variables.set("SO_Mutasi", SO_Mutasi);
                        variables.set("so_toko", location_idt.length > 0);
                        variables.set("so_gudang", location_idg.length > 0);
                        variables.set("part_id", part_id);
                        variables.set("product_name", product_name);
                        variables.set("type", "Mutasi");
                        variables.set("date", date);
                    
                        variables.setTyped("location_idt", {
                          value: JSON.stringify(location_idt),
                          type: "Object",
                          valueInfo: {
                            serializationDataFormat: "application/json",
                            objectTypeName: "java.util.ArrayList",
                          },
                        });
                    
                        variables.setTyped("location_idg", {
                          value: JSON.stringify(location_idg),
                          type: "Object",
                          valueInfo: {
                            serializationDataFormat: "application/json",
                            objectTypeName: "java.util.ArrayList",
                          },
                        });
                    
                        console.log(JSON.stringify(variables.getAll(), null, 2));
                    
                        // ✅ Jalankan jika sudah siap kirim hasil ke Camunda
                        await taskService.complete(task, variables);
                    
                      } catch (error) {
                        if (error.response) {
                          console.error("❌ Gagal memproses task:", error.response.status, error.response.data);
                        } else {
                          console.error("❌ Gagal memproses task:", error.message);
                        }
                      }
                    }); 
        
                    client.subscribe("Check_Stock_Mutasi_Prepare", async function ({ task, taskService }) {
          try {
            console.log(`🕒 Task "${task.topicName}" diterima (${task.id}) — menunggu 10 detik sebelum eksekusi...`);
            await new Promise((resolve) => setTimeout(resolve, 10000)); // ⏳ delay 10 detik
        
            const inventree = axios.create({
              baseURL: `${process.env.SERVER_INVENTREE}/api`,
              headers: {
                Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
              },
              timeout: 10000,
            });
        
            const proc_inst_id = task.processInstanceId;
        
            // 🔍 Query data dari Hasura GraphQL
            const checkQuery = {
              graph: {
                method: "query",
                endpoint: process.env.GRAPHQL_API,
                gqlQuery: `
                  query MyQuery($proc_inst_id: String!) {
                    internal_consolidation_process(where: {proc_inst_id: {_eq: $proc_inst_id}}) {
                      destination
                      part_id
                      quantity_data
                      quantity_physical
                    }
                  }
                `,
                variables: { proc_inst_id },
              },
            };
        
            const checkResult = await configureQuery(fastify, checkQuery);
            const mutasiReq = checkResult?.data?.[0]?.graph?.internal_consolidation_process ?? [];
        
            if (mutasiReq.length === 0) throw new Error("❌ Mutasi request tidak ditemukan.");
        
            const {
              part_id,
              destination,
              quantity_data,
              quantity_physical
            } = mutasiReq[0];
        
            // Ambil nama produk dari Inventree
            const productRes = await inventree.get(`/part/${part_id}/`);
            const product_name = productRes?.data?.full_name || "Unknown Product";
        
            let SO_Mutasi = true;
            const location_idt = [];
            const location_idg = [];
        
            // 🚫 Skip lokasi WIP
            if (destination && destination.toLowerCase().includes("wip")) {
              console.log(`⏭️ Melewati lokasi WIP: ${destination}`);
            } else {
              // 🔍 Cek selisih
              if (quantity_data !== quantity_physical) {
                SO_Mutasi = false;
                console.log(`⚠️ Selisih ditemukan di lokasi ${destination}`);
        
                const res = await inventree.get(`/stock/location/?name=${destination}`);
                const results = res?.data?.results || [];
        
                if (results.length > 0) {
                  const firstLocation = results[0];
                  const desc = (firstLocation.description || "").toLowerCase();
        
                  if (desc.includes("toko")) {
                    location_idt.push(firstLocation.pk);
                  } else if (desc.includes("gudang")) {
                    location_idg.push(firstLocation.pk);
                  } else {
                    console.log(`⚠️ Lokasi ${destination} tidak dikenali (bukan toko/gudang)`);
                  }
                } else {
                  console.log(`⚠️ Lokasi ${destination} tidak ditemukan di Inventree.`);
                }
              }
            }
        
            // ✅ Jika tidak ada lokasi toko/gudang, maka anggap aman
            if (location_idt.length === 0 && location_idg.length === 0) {
              console.log("✅ Tidak ada lokasi toko/gudang terdeteksi — set SO_Mutasi = true");
              SO_Mutasi = true;
            }
        
            // 🧩 Buat variabel Camunda
            const date = new Date().toLocaleString("sv-SE").replace("T", " ");
            const variables = new Variables();
        
            variables.set("SO_Mutasi", SO_Mutasi);
            variables.set("so_toko", location_idt.length > 0);
            variables.set("so_gudang", location_idg.length > 0);
            variables.set("part_id", part_id);
            variables.set("product_name", product_name);
            variables.set("type", "Mutasi Prepare");
            variables.set("date", date);
        
            variables.setTyped("location_idt", {
              value: JSON.stringify(location_idt),
              type: "Object",
              valueInfo: {
                serializationDataFormat: "application/json",
                objectTypeName: "java.util.ArrayList",
              },
            });
        
            variables.setTyped("location_idg", {
              value: JSON.stringify(location_idg),
              type: "Object",
              valueInfo: {
                serializationDataFormat: "application/json",
                objectTypeName: "java.util.ArrayList",
              },
            });
        
            console.log("📦 Camunda Variables:");
            console.log(JSON.stringify(variables.getAll(), null, 2));
        
            // ✅ Kirim hasil ke Camunda (aktifkan setelah tes)
            await taskService.complete(task, variables);
            console.log(`✅ Task "${task.topicName}" selesai.`);
        
          } catch (error) {
            if (error.response) {
              console.error("❌ Gagal memproses task:", error.response.status, error.response.data);
            } else {
              console.error("❌ Gagal memproses task:", error.message);
            }
          }
        });
        
            
                    client.subscribe("Check_Stock_Prepare", async function ({ task, taskService }) {
                        try {
                            const inventree = axios.create({
                                baseURL: `${process.env.SERVER_INVENTREE}/api`,
                                headers: {
                                    Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                                },
                                timeout: 10000,
                            });
                            const proc_inst_id = task.processInstanceId;
                            const checkQuery = {
                                graph: {
                                    method: "query",
                                    endpoint: process.env.GRAPHQL_API,
                                    gqlQuery: `
                                        query MyQuery($proc_inst_id: String!) {
                                            mutasi_request(where: {proc_inst_id: {_eq: $proc_inst_id}}) {
                                                part_id
                                                mutasi_request_to_mutasi_details {
                                                    quantity_data
                                                    quantity_physical
                                                    type
                                                    location_id
                                                }
                                                mutasi_request_to_delivery_staging {
                                                    source_id_wip
                                                    type
                                                    location_id
                                                    status
                                                }
                                            }
                                        }
                                    `,
                                    variables: { proc_inst_id },
                                },
                            };
            
                            const checkResult = await configureQuery(fastify, checkQuery);
                            console.log("🔎 Hasil checkQuery:", JSON.stringify(checkResult, null, 2));
            
                            const mutasiReq = checkResult?.data?.[0]?.graph?.mutasi_request ?? [];
                            if (mutasiReq.length === 0) throw new Error("Mutasi request tidak ditemukan.");
            
                            const details = mutasiReq[0].mutasi_request_to_mutasi_details ?? [];
                            const part_id = mutasiReq[0].part_id;
            
                            const product_name = (
                                await inventree.get(`/part/${part_id}/`)
                            )?.data?.full_name;
            
                            let SO_Mutasi = true;
                            const invalid_locations = [];
            
                            for (const d of details) {
                                if (d.quantity_data !== d.quantity_physical) {
                                    SO_Mutasi = false;
                                    console.log(`⚠️ Selisih ditemukan di lokasi ${d.location_id}`);
                                    const res = await inventree.get(`/stock/location/?name=${d.location_id}`);
                                    if (res.data && res.data.length > 0) {
                                        invalid_locations.push({
                                            location_id: d.location_id,
                                            location_name: res.data[0].name,
                                            location_pk: res.data[0].pk,
                                        });
                                    }
                                }
                            }
                            const variables = new Variables();
                            variables.set("SO_Mutasi", SO_Mutasi);
                            variables.set("part_id", part_id);
                            variables.set("product_name", product_name);
                            variables.set("type", "Mutasi");
                            variables.set("ownership", "gudang");
                            variables.set("date", new Date().toISOString());
                            variables.setTyped("invalid_locations", {
                                value: JSON.stringify(invalid_locations),
                                type: "Object",
                                valueInfo: {
                                    serializationDataFormat: "application/json",
                                    objectTypeName: "java.util.ArrayList",
                                },
                            });
                            console.log(
                                SO_Mutasi
                                    ? "✅ Semua quantity sama"
                                    : `❌ Ada selisih di ${invalid_locations.length} lokasi`
                            );
                            await taskService.complete(task, variables);
                        } catch (error) {
                            if (error.response) {
                                console.error("❌ Gagal memproses task:", error.response.status, error.response.data);
                            } else {
                                console.error("❌ Gagal memproses task:", error.message);
                            }
                        }
                    });
            
                    client.subscribe("checkQuantityWIP", async function ({ task, taskService }) {
                console.log("🚀 Task Dijalankan:", task.id);
    
                const inventree = axios.create({
                    baseURL: `${process.env.SERVER_INVENTREE}/api`,
                    headers: {
                        Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                        "Content-Type": "application/json",
                    },
                    timeout: 10000,
                });
    
                try {
                    // 🧠 Ambil semua variabel task dengan fallback default
                    const proc_inst_id = task.processInstanceId;
                    const quantity = task.variables.get("quantity") ?? 0;
                    const part_id = task.variables.get("part_id") ?? null;
                    const destination = task.variables.get("destination_consolidation") ?? null;
                    const created_by = task.variables.get("created_by") ?? "-";
                    const type = task.variables.get("type") ?? null;
                    const status = "unprocessed";
                    const created_at = new Date().toLocaleString("sv-SE", {
                        timeZone: "Asia/Jakarta",
                    });
                    const unique_trx = task.variables.get("unique_trx");
                    const urgensi = task.variables.get("urgensi");
                    const part_name = task.variables.get("product_name");

                    const business_key = `${unique_trx}:${part_name}:${urgensi}`;

                    console.log("🔑 Business Key:", business_key);
    
                    // 🔎 Ambil data stok dari InvenTree
                    const { data } = await inventree.get(`/stock/?location=6009&part=${part_id}`);
                    const results = data?.results || [];
                    const totalQuantity = results.reduce((acc, item) => acc + (item.quantity || 0), 0);
                    console.log(`📦 Total stok ditemukan: ${totalQuantity} | Dibutuhkan: ${quantity}`);
    
                    const WIP_enough = quantity <= totalQuantity;
                    console.log(`🔍 WIP_enough: ${WIP_enough}`);
    
                    // 🧩 Buat insertQuery dengan format yang kamu mau
                    const insertQuery = {
                        graph: {
                            method: "mutate",
                            endpoint: process.env.GRAPHQL_API,
                            gqlQuery: `
                        mutation InsertInternalConsolidation(
                            $proc_inst_id: String!,
                            $part_id: Int!,
                            $quantity: Int!,
                            $destination: String!,
                            $type: String!,
                            $created_by: String!,
                            $status: String!,
                            $created_at: timestamp!,
                            $unique_trx: String!,
                            $urgensi: String!,
                        ) {
                            insert_internal_consolidation_process(objects: {
                                proc_inst_id: $proc_inst_id,
                                part_id: $part_id,
                                quantity: $quantity,
                                destination: $destination,
                                type: $type,
                                created_by: $created_by,
                                status: $status,
                                created_at: $created_at,
                                unique_trx: $unique_trx,
                                urgensi: $urgensi
                            }) {
                                affected_rows
                                returning {
                                    id
                                    part_id
                                    unique_trx
                                    status
                                    created_at
                                }
                            }
                        }
                    `,
                            variables: {
                                proc_inst_id,
                                part_id,
                                quantity,
                                destination,
                                type,
                                created_by,
                                status,
                                created_at,
                                unique_trx,
                                urgensi
                            },
                        },
                        query: [],
                    };
    
                    console.log("📦 Data siap dikirim ke internal_consolidation_process:", insertQuery);
    
                    // 🚀 Jalankan mutation
                    const insertResult = await configureQuery(fastify, insertQuery);
                    console.log("✅ Insert berhasil:", insertResult);
    
                    // ✅ Set variabel Camunda
                    const variables = new Variables();
                    variables.set("WIP_enough", WIP_enough);
                    variables.set("business_key", business_key);
                    if (WIP_enough) {
                        variables.set("WIPLocation", 1000006);
                        variables.set("picker", "PrepareWarehouseCoordinator");
                    }
                    await taskService.complete(task, variables)
                    console.log("✅ Task Selesai:", task.id);
                } catch (error) {
                    console.error("❌ Terjadi kesalahan saat memproses task:", error.message);
                    await handleFailureDefault(task, {
                        errorMessage: error.message,
                        errorDetails: error.stack,
                        retries: 0,
                        retryTimeout: 1000,
                    });
                }
            });
            
            
                    client.subscribe("checkStatusCustomDatabase", async ({ task, taskService }) => {
                        console.log("🚀 Task Dijalankan:", task.id);
                        try {
                            const part_id = task.variables.get("part_id") ?? null;
                            const res = await configureQuery(fastify, {
                                graph: {
                                    method: "query",
                                    endpoint: process.env.GRAPHQL_API,
                                    gqlQuery: `
                                query MyQuery($part_id: Int!) {
                                    mutasi_request(
                                        where: {part_id: {_eq: $part_id}, status: {_neq: "completed"}, is_prepare_needed: {_eq:true}}
                                    ) {
                                        id
                                    }
                                }
                            `,
                                    variables: { part_id },
                                },
                                query: [],
                            });
            
                            const data = res?.data?.graph?.mutasi_request || [];
                            const count = data.length;
                            console.log(`📊 Ditemukan ${count} mutasi_request`);
                            const quantity_enough = count > 0;
                            const variables = new Variables();
                            variables.set("quantity_enough", quantity_enough);
                            await taskService.complete(task, variables);
                            console.log("✅ Task Selesai:", task.id);
                        } catch (error) {
                            console.error("❌ Error saat memproses task:", error.message);
                            await handleFailureDefault(task, {
                                errorMessage: error.message,
                                errorDetails: error.stack,
                                retries: 0,
                                retryTimeout: 1000,
                            });
                        }
                    });
            
                    client.subscribe("getInstanceMutasiPrepare", async function ({ task, taskService }) {
    console.log("🚀 Task Dijalankan:", task.id);

    try {
        const proc_inst_id = task.processInstanceId;
        const part_id = task.variables.get("part_id") ?? null;
        const urgensi = task.variables.get("urgensi");
        const quantity = 0;
        const created_by = task.variables.get("created_by") ?? null;
        const status = "Processed";
        const now = new Date();

        const formattedDate = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
        const created_at = now.toLocaleString("sv-SE", { timeZone: "Asia/Jakarta" });

        const uniquePrefix = `IMP|${formattedDate}|${part_id}|`;

        // 🔹 Cek apakah sudah ada trx dengan prefix ini
        const checkQuery = `
            query CheckExistingTrx($like_pattern: String!) {
                mutasi_request(
                    where: { unique_trx: { _like: $like_pattern } }
                    order_by: { unique_trx: desc }
                    limit: 1
                ) {
                    unique_trx
                }
            }
        `;

        const checkResponse = await configureQuery(fastify, {
            graph: {
                method: "query",
                endpoint: process.env.GRAPHQL_API,
                gqlQuery: checkQuery,
                variables: { like_pattern: `${uniquePrefix}%` },
            },
            query: [],
        });

        let unique_trx = uniquePrefix;

        console.log("🔍 Hasil pengecekan trx terakhir:", JSON.stringify(checkResponse, null, 2));
        if (checkResponse?.data?.[0].graph?.mutasi_request?.length > 0) {
            const lastTrx = checkResponse.data[0].graph.mutasi_request[0].unique_trx;
            const parts = lastTrx.split("|");
            const lastNumber = parseInt(parts[3]) || 0;
            const nextNumber = lastNumber + 1;
            unique_trx = `${uniquePrefix}${nextNumber}`;
        }

        // 🔹 Mutation GraphQL
        const gqlMutation = `
            mutation InsertMutasiRequest(
                $proc_inst_id: String!,
                $part_id: Int!,
                $quantity: Int!,
                $created_at: timestamp!,
                $created_by: String!,
                $status: String!,
                $unique_trx: String!,
                $urgensi: String!,
                $is_prepare_needed: Boolean!
            ) {
                insert_mutasi_request(
                    objects: {
                        proc_inst_id: $proc_inst_id,
                        part_id: $part_id,
                        quantity: $quantity,
                        created_at: $created_at,
                        created_by: $created_by,
                        status: $status,
                        urgensi: $urgensi,
                        unique_trx: $unique_trx,
                        is_prepare_needed: $is_prepare_needed
                    }
                ) {
                    affected_rows
                    returning {
                        id
                        unique_trx
                        created_by
                        created_at
                    }
                }
            }
        `;

        // 🧠 Lihat semua variabel yang dikirim ke Hasura
        const mutationVariables = {
            proc_inst_id,
            part_id,
            quantity,
            created_at,
            created_by,
            status,
            unique_trx,
            urgensi,
            is_prepare_needed: true,
        };

        console.log("🧾 Variabel yang dikirim ke Hasura:");
        console.log(JSON.stringify(mutationVariables, null, 2));

        console.log("🧩 GraphQL Mutation yang dikirim:");
        console.log(gqlMutation);

        const response = await configureQuery(fastify, {
            graph: {
                method: "mutate",
                endpoint: process.env.GRAPHQL_API,
                gqlQuery: gqlMutation,
                variables: mutationVariables,
            },
            query: [],
        });

        console.log("📊 Response Hasura:");
        console.log(JSON.stringify(response, null, 2));

        console.log("🔢 unique_trx dibuat:", unique_trx);

        const variables = new Variables();
        variables.set("unique_trx", unique_trx);
        await taskService.complete(task, variables);

        console.log("✅ Task Selesai:", task.id);

    } catch (error) {
        console.error("❌ Error saat memproses task:", error.message);
        console.error(error);

        await handleFailureDefault(task, {
            errorMessage: error.message,
            errorDetails: error.stack,
            retries: 0,
            retryTimeout: 1000,
        });
    }
});
            
            
                    client.subscribe("getInstanceInternalPrepare", async function ({ task, taskService }) {
                        console.log("🚀 Task Dijalankan:", task.id);
                        try {
                            const proc_inst_id = task.processInstanceId;
                            const consolidation_id = task.variables.get("id") ?? null;
                            const gqlMutation = `
                                mutation InsertPrepareInternal(
                                    $proc_inst_id: String!,
                                    $consolidation_id: Int
                                ) {
                                    insert_prepare_internal(
                                        objects: {
                                            proc_inst_id: $proc_inst_id,
                                            consolidation_id: $consolidation_id
                                        }
                                    ) {
                                        affected_rows
                                        returning {
                                            id
                                            consolidation_id
                                            proc_inst_id
                                        }
                                    }
                                }
                            `;
                            const response = await configureQuery(fastify, {
                                graph: {
                                    method: "mutate",
                                    endpoint: process.env.GRAPHQL_API,
                                    gqlQuery: gqlMutation,
                                    variables: {
                                        proc_inst_id,
                                        consolidation_id
                                    },
                                },
                                query: [],
                            });
            
                            const hasil = response?.data?.graph?.insert_prepare_internal;
                            if (!hasil || hasil.affected_rows === 0) {
                                console.warn("⚠️ Tidak ada baris yang dimasukkan ke prepare_internal");
                            } else {
                                console.log("✅ Baris dimasukkan:", hasil.returning);
                            }
                            // ✅ Selesaikan task Camunda
                            await taskService.complete(task);
                            console.log("✅ Task Selesai:", task.id);
                        } catch (error) {
                            console.error("❌ Error saat memproses task:", error.message);
            
                            await handleFailureDefault(task, {
                                errorMessage: error.message,
                                errorDetails: error.stack,
                                retries: 0,
                                retryTimeout: 1000,
                            });
                        }
                    });
            
                    client.subscribe("getWipPrepare", async function ({ task, taskService }) {
                        console.log("🚀 Task Dijalankan:", task.id);
                        try {
                            const inventree = axios.create({
                                baseURL: `${process.env.SERVER_INVENTREE}/api`,
                                headers: {
                                    Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                                    "Content-Type": "application/json",
                                },
                                timeout: 10000,
                            });
            
                            const proc_inst_id = task.processInstanceId;
                            const id = task.variables.get("id");
                            const part_id = task.variables.get("part_id");
                            const WIPLocation = task.variables.get("WIPLocation");
                            const { data: getData } = await inventree.get(
                                `/stock/?location=${WIPLocation}&part=${part_id}&ordering=-updated&limit=1`
                            );
                            let newStockItemId = null;
                            if (getData?.results?.length > 0) {
                                newStockItemId = getData.results[0].pk;
                            }
                            console.log("📦 new stock_item_id:", newStockItemId);
                            const gqlMutation = `
                        mutation UpdateInternalConsolidation(
                            $proc_inst_id: String!,
                            $request_id: Int,
                            $stock_item_wip: Int!
                                        ) {
                            update_internal_consolidation_process(
                                where: { proc_inst_id: { _eq: $proc_inst_id } },
                                _set: {
                                    stock_item_wip: $stock_item_wip,
                                    request_id: $request_id
                                }
                            ) {
                                affected_rows
                                returning {
                                    id
                                    stock_item_wip
                                    request_id
                                }
                            }
                        }
                    `;
            
                            const updateQuery = {
                                graph: {
                                    method: "mutate",
                                    endpoint: process.env.GRAPHQL_API,
                                    gqlQuery: gqlMutation,
                                    variables: {
                                        proc_inst_id,
                                        request_id: id || null,
                                        stock_item_wip: newStockItemId,
                                    },
                                },
                                query: [],
                            };
            
                            console.log("📤 Data siap dikirim ke internal_consolidation_process:", updateQuery);
                            const response = await configureQuery(fastify, updateQuery);
                            console.log("📊 Response Hasura:", JSON.stringify(response, null, 2));
                            // ✅ Selesaikan task
                            await taskService.complete(task);
                            console.log("✅ Task Selesai:", task.id);
                        } catch (error) {
                            console.error("❌ Error saat memproses task:", error.message);
            
                            await handleFailureDefault(task, {
                                errorMessage: error.message,
                                errorDetails: error.stack,
                                retries: 0,
                                retryTimeout: 1000,
                            });
                        }
                    });

                    client.subscribe(
                          "getInstanceInbound",
                          async function ({ task, taskService }) {
                            console.log("🚀 Task Dijalankan:", task.id);
                            try {
                              const proc_inst_id = task.processInstanceId;
                              const parent_inst_id = task.variables.get("parent_inst_id") ?? null;
                              const gqlMutation = `
                                        mutation UpdateMiOrder($proc_inst_id: String!, $parent_inst_id: String) {
                                            update_mi_order(
                                                where: { parent_inst_id: { _eq: $parent_inst_id } },
                                                _set: { proc_inst_id: $proc_inst_id }
                                            ) {
                                                affected_rows
                                            }
                                        }
                                    `;
                              const response = await configureQuery(fastify, {
                                graph: {
                                  method: "mutate",
                                  endpoint: process.env.GRAPHQL_API,
                                  gqlQuery: gqlMutation,
                                  variables: {
                                    proc_inst_id,
                                    parent_inst_id,
                                  },
                                },
                                query: [],
                              });
                              const hasil = response?.data?.[0].graph?.update_mi_order;
                              console.log("hasilll", JSON.stringify(hasil, null, 2))
                              if (!hasil || hasil.affected_rows === 0) {
                                console.warn("⚠️ Tidak ada baris yang diperbarui di mi_order");
                              } else {
                                console.log(`✅ ${hasil.affected_rows} baris berhasil diperbarui`);
                              }
                              // ✅ Selesaikan task Camunda
                              await taskService.complete(task);
                            } catch (error) {
                              console.error("❌ Error saat memproses task:", error.message);
                    
                              await handleFailureDefault(task, {
                                errorMessage: error.message,
                                errorDetails: error.stack,
                                retries: 0,
                                retryTimeout: 1000,
                              });
                            }
                          }
                        );

    }
);

