const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")();
const dotenv = require("dotenv");
const axios = require("axios");

dotenv.config();
const GRAPHQL_API = process.env.GRAPHQL_API;

const createNewPartId = async (partName, unit) => {
  try {
    const baseURL = process.env.SERVER_INVENTREE;
    const token = process.env.INVENTREE_API_TOKEN;

    const axiosInstance = axios.create({
      baseURL,
      headers: {
        Authorization: `Token ${token}`,
      },
    });

    const payload = {
      name: partName,
      units: unit || "pcs",
      minimum_stock : 0,
      active: true,
      assembly: false,
    };

    const response = await axiosInstance.post(`/api/part/`, payload);

    return response.data;
  } catch (err) {
    console.error(`❌ Error saat create part baru "${partName}":`, err);
    return null;
  }
};

const eventHandlers = {
  async onSubmit(data, eventKey) {
    const results = [];

    for (const item of data) {
      try {
        const instanceId = item.proc_inst_id || null;
        const checkQuery = {
          graph: {
            method: "query",
            endpoint: GRAPHQL_API,
            gqlQuery: `
              query CheckInvoice($invoice: String!) {
                mi_order(where: {invoice: {_eq: $invoice}}) {
                  id
                }
              }
            `,
            variables: { invoice: item.invoice },
          },
          query: [],
        };

        const checkResponse = await configureQuery(fastify, checkQuery);

        // Debug logging
        console.log("response", JSON.stringify(checkResponse, null, 2));

        // Ambil data hasil query dengan struktur response yg benar
        const miOrder =
          checkResponse?.data?.[0]?.graph?.mi_order ??
          checkResponse?.data?.mi_order ??
          [];

        console.log("hasil query", miOrder);
        if (miOrder.length > 0) {
          throw new Error(`❌ DUPLICATE! Invoice ${item.invoice} sudah pernah dibuat. Silahkan cek history purchase.`);
        }


        const productsData = [];
        for (const product of item.products) {
          let part = null;

          if (product.part_pk) {
            // kalau pilih existing part
            part = product.part_pk;
          } else if (!product.part_pk && product.part_name) {
            const inventreeData = await createNewPartId(
              product.part_name,
              product.unit
            );
            part = inventreeData ? inventreeData.pk : null;
          }

          productsData.push({
            part: part,
            quantity: product.quantity,
            new_product: product.new_product,
            part_name: product.part_name || null,
            unit: product.unit || null,
          });
        }

        if (productsData.length === 0) {
          console.error("❌ Tidak ada product valid untuk diproses");
          continue;
        }

        const type_supplier = item.date == "PT10080M" ? "Local" : "Import";

        const dataCamunda = {
          type: "start",
          endpoint: `/engine-rest/process-definition/key/Mirorim_Stock.Inbound_Purchase/start`,
          variables: {
            variables: {
              invoice_supplier: { value: item.invoice, type: "String" },
              supplier: { value: item.supplier, type: "String" },
              type_supplier: { value: type_supplier, type: "String" },
              date: { value: item.date, type: "String" },
              business_key: { value: item.forwarder, type: "String" },
            },
            businessKey: `${type_supplier}:${item.invoice}:${item.supplier}`,
          },
        };

        const responseCamunda = await camundaConfig(dataCamunda, instanceId);
        console.log(
          "✅ Camunda response",
          responseCamunda?.data || responseCamunda
        );

        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          const instanceId = responseCamunda.data.processInstanceId;

          const dataQueryOrder = {
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `
                mutation InsertOrder(
                  $box_number: String!,
                  $created_at: timestamp!,
                  $created_by: String!,
                  $forwarder: String!,
                  $invoice: String!,
                  $supplier: String,
                  $parent_inst_id: String!,
                  $resi: String!,
                  $notes: String!,
                  $status: String!
                ) {
                  insert_mi_order(objects: {
                    box_number: $box_number,
                    created_at: $created_at,
                    created_by: $created_by,
                    forwarder: $forwarder,
                    invoice: $invoice,
                    supplier: $supplier,
                    parent_inst_id: $parent_inst_id,
                    resi: $resi,
                    notes: $notes,
                    status: $status
                  }) {
                    affected_rows
                  }
                }
              `,
              variables: {
                parent_inst_id: instanceId,
                box_number: item.box_number,
                created_at: item.created_at,
                created_by: item.created_by,
                forwarder: item.forwarder,
                invoice: item.invoice,
                supplier: item.supplier,
                resi: item.resi,
                notes: item.notes,
                status: "Order",
              },
            },
            query: [],
          };

          const responseQuery = [];

          try {
            const resOrder = await configureQuery(fastify, dataQueryOrder);
            responseQuery.push(resOrder);
          } catch (err) {
            console.error("❌ Error saat insert mi_order:", err);
            throw err;
          }

          for (const p of productsData) {
            console.log("👉 part:", p.part, "new_product:", p.new_product); // p.new_product
            const dataQueryProduct = {
              graph: {
                method: "mutate",
                endpoint: GRAPHQL_API,
                gqlQuery: `
                  mutation MyMutation($created_at: timestamp!, $created_by: String!, $invoice: String!, $part: Int, $quantity: Int!, $task_def_key: String!, $part_name: String, $unit: String!, $new_product: Boolean!) {
  insert_mi_logs(objects: {created_at: $created_at, created_by: $created_by, invoice: $invoice, part_pk: $part, quantity: $quantity, task_def_key: $task_def_key}) {
    affected_rows
  }
  insert_mi_products(objects: {created_at: $created_at, created_by: $created_by, invoice: $invoice, part_pk: $part, part_name: $part_name, quantity_order: $quantity, unit: $unit, new_product: $new_product}) {
    affected_rows
  }
}
                `,
                variables: {
                  created_at: item.created_at,
                  created_by: item.created_by,
                  task_def_key: "Mirorim_Stock.Inbound_Purchase",
                  invoice: item.invoice,
                  part: p.part || null,
                  part_name: p.part_name || null,
                  quantity: p.quantity,
                  unit: p.unit,
                  new_product: p.new_product,
                },
              },
              query: [],
            };

            try {
              console.log(JSON.stringify(dataQueryProduct, null, 2));
              const resProduct = await configureQuery(
                fastify,
                dataQueryProduct
              );
              responseQuery.push(resProduct);
            } catch (err) {
              console.error(
                `❌ Error saat insert mi_products (SKU: ${p.part}):`,
                err
              );
              throw err;
            }
          }

          results.push({
            message: "✅ Create event processed successfully",
            camunda: responseCamunda.data,
            database: responseQuery,
          });
        }
      } catch (error) {
        console.error(
          `❌ Error executing handler for event: ${eventKey}`,
          error
        );
        throw error;
      }
    }

    return results;
  },

  async onChange(data) {
    console.log("⚙️ Handling onChange with data:", data);
    return { message: "onChange executed", data };
  },
};

/**
 * ⛓️ Handler utama
 */
const handle = async (eventData) => {
  const { eventKey, data } = eventData;
  console.log("📥 Received eventData", eventData);

  if (!eventHandlers[eventKey]) {
    throw new Error(`❌ No handler found for event: ${eventKey}`);
  }

  try {
    return await eventHandlers[eventKey](data, eventKey);
  } catch (error) {
    console.error(`❌ Error executing handler for event: ${eventKey}`, error);
    throw error;
  }
};

module.exports = { handle };
