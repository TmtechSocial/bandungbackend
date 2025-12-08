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

        client.subscribe("Mutasi_Inventory", async function ({ task, taskService }) {
            console.log("Task Dijalankan:", task.id);

            try {
                const proc_inst_id = task.processInstanceId;

                // 1. Ambil data refill dari GraphQL
                const dataQuery = {
                    graph: {
                        method: "query",
                        endpoint: GRAPHQL_API,
                        gqlQuery: `query MyQuery($proc_inst_id: [String!]) {
          mo_refill(where: {proc_inst_id: {_in: $proc_inst_id}}, order_by: {created_at: asc}) {
            quantity_approve
            stock_pk_resource
            quantity_approval
            destination_location_id
            sku
            part_id
          }
        }`,
                        variables: {
                            proc_inst_id: [proc_inst_id],
                        },
                    },
                    query: [],
                };

                const responseQuery = await configureQuery(fastify, dataQuery);
                console.log("🔍 responseQuery:", JSON.stringify(responseQuery, null, 2));

                const refills = responseQuery?.data?.[0]?.graph?.mo_refill;
                const refill = refills?.[refills.length - 1]; // Ambil data paling baru
                if (!refill) {
                    throw new Error("❌ Data refill tidak ditemukan dari GraphQL");
                }
                const {
                    stock_pk_resource,
                    destination_location_id,
                    sku,
                    quantity_approval,
                    quantity_approve,
                    part_id,
                } = refill;

                // 2. Transfer stok
                const dataTransfer = {
                    items: [
                        {
                            pk: Number(stock_pk_resource),
                            quantity: quantity_approve.toString(),
                        },
                    ],
                    notes: `Mutasi ke lokasi ${sku} | Proc ID: ${proc_inst_id}`,
                    location: Number(destination_location_id),
                };

                console.log("Payload dataTransfer:", JSON.stringify(dataTransfer, null, 2));
                console.log("Mengirim request ke endpoint stock_transfer_create...");

                const response = await axios.post(
                    `${process.env.SERVER_INVENTREE}/api/stock/transfer/`,
                    dataTransfer,
                    {
                        headers: {
                            Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                        },
                    }
                );

                console.log("✅ Transfer Response:", response.data);

                // 3. Koreksi stok jika quantity_approve ≠ quantity_approval
                if (quantity_approve !== quantity_approval) {
                    const selisih = quantity_approve - quantity_approval;
                    console.log("⚖️ Perlu Adjustment Packaging:", selisih);

                    // Ambil stock ID terbaru dari lokasi tujuan
                    const stockResponse = await axios.get(
                        `${process.env.SERVER_INVENTREE}/api/stock/?location=${destination_location_id}&part=${part_id}&ordering=updated`,
                        {
                            headers: {
                                Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                            },
                        }
                    );

                    const stockList = stockResponse?.data?.results || [];
                    const validStocks = stockList
                        .filter((item) => item.updated !== null)
                        .sort((a, b) => new Date(b.updated) - new Date(a.updated));
                    const latestStock = validStocks[0];
                    if (!latestStock) {
                        throw new Error(
                            "❌ Tidak menemukan stock valid untuk koreksi di lokasi tujuan"
                        );
                    }

                    const adjustPayload = {
                        items: [
                            {
                                pk: latestStock.pk,
                                quantity: Math.abs(selisih),
                            },
                        ],
                        notes: `Adjustment Packaging | Proc ID: ${proc_inst_id}`,
                    };

                    if (selisih > 0) {
                        const removeRes = await axios.post(
                            `${process.env.SERVER_INVENTREE}/api/stock/remove/`,
                            adjustPayload,
                            {
                                headers: {
                                    Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                                    "Content-Type": "application/json",
                                },
                            }
                        );
                        console.log("🔻 Koreksi stok dikurangi:", removeRes.data);
                    } else {
                        const addRes = await axios.post(
                            `${process.env.SERVER_INVENTREE}/api/stock/add/`,
                            adjustPayload,
                            {
                                headers: {
                                    Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                                    "Content-Type": "application/json",
                                },
                            }
                        );
                        console.log("🔺 Koreksi stok ditambahkan:", addRes.data);
                    }
                } else {
                    console.log("ℹ️ Tidak ada selisih, stok sudah sesuai.");
                }

                // 4. Merge stock yang ada di lokasi tujuan
                const stockMergeRes = await axios.get(
                    `${process.env.SERVER_INVENTREE}/api/stock/?location=${destination_location_id}&part=${part_id}`,
                    {
                        headers: {
                            Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                        },
                    }
                );

                const stockToMerge = (stockMergeRes.data?.results || [])
                    .filter((s) => s.status === 10 && !s.serial)
                    .map((s) => ({ item: s.pk }));

                if (stockToMerge.length > 1) {
                    const mergePayload = {
                        items: stockToMerge,
                        location: destination_location_id,
                        notes: `Merge refill otomatis | Proc ID: ${proc_inst_id}`,
                        allow_mismatched_suppliers: false,
                        allow_mismatched_status: false,
                    };

                    const mergeRes = await axios.post(
                        `${process.env.SERVER_INVENTREE}/api/stock/merge/`,
                        mergePayload,
                        {
                            headers: {
                                Authorization: `Token ${process.env.INVENTREE_API_TOKEN}`,
                                "Content-Type": "application/json",
                            },
                        }
                    );

                    console.log("✅ Merge stock berhasil:", mergeRes.data);
                } else {
                    console.log("ℹ️ Tidak ada stok duplikat yang perlu di-merge.");
                }

                // ✅ Selesaikan task
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
              $part_pk: Int!
            ) {
              insert_mo_order_shop(objects: {
                proc_inst_id: $proc_inst_id,
                product_name: $product_name,
                invoice: $invoice,
                resi: $resi,
                sku_toko: $sku,
                quantity_order: $quantity,
                part_pk: $part_pk,
                quantity_convert: $quantity
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
                            },
                        },
                        query: [],
                    };

                    const shopResult = await configureQuery(fastify, insertShopQuery);
                    console.log("✅ Insert mo_order_shop result:", shopResult.data);
                }

                // Insert ke mo_order dilakukan hanya sekali setelah loop
                const firstOrder = orders[0]; // ambil 1 data sebagai perwakilan (resi, invoice, dll)
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
        console.log(">> Business Key:", businessKey);

        // Kirim request ke proses Load_Data
        const response = await axios.post(`${CAMUNDA_API}engine-rest/process-definition/key/Mirorim_Operasional.Load_Data/start`, {
          variables: {},
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
    
     client.subscribe(
      "getInstanceRetur",
      async function ({ task, taskService }) {
        console.log("🚀 Task Dijalankan:", task.id);

        try {
          const proc_inst_id = task.processInstanceId;
          const invoice = task.variables.get("invoice");

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
        
    }
);
