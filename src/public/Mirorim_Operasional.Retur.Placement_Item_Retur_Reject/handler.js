const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify")();
const dotenv = require("dotenv");
const axios = require("axios");

dotenv.config();

const GRAPHQL_API = process.env.GRAPHQL_API;
const SERVER_INVENTREE = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;

// Create a single Inventree axios instance to reuse
const inventree = axios.create({
  baseURL: SERVER_INVENTREE ? `${SERVER_INVENTREE}/api` : undefined,
  headers: {
    Authorization: `Token ${INVENTREE_API_TOKEN}`,
    "Content-Type": "application/json",
  },
  timeout: 10000,
});

// Helpers: build GraphQL query payload per product
function buildGraphQuery(product, item) {
  // Tentukan lokasi tergantung dari status_available
  let locationTarget = null;

  if (product.status_available === "sudah ada") {
    locationTarget = Number(product.id_location);
  } else if (product.status_available === "belum ada") {
    locationTarget = Number(product.location_id_available);
  }

  return {
    graph: {
      method: "mutate",
      endpoint: GRAPHQL_API,
      gqlQuery: `
        mutation UpdateQuantity($id: Int!, $quantity: Int!, $location_id: Int!, $evidence: String!) {
          update_mo_retur_placement(
            where: { id: { _eq: $id } },
            _set: { 
              quantity_placement: $quantity, 
              location_id: $location_id,
              evidence: $evidence 
            }
          ) {
            affected_rows
          }
        }
      `,
      variables: {
        id: Number(product.id),
        quantity: Number(product.quantity_placement),
        location_id: locationTarget,
        evidence: item.evidence[0] || "",
      },
    },
    query: [],
  };
}

// Helpers: build transfer payload or return null if nothing to transfer
function buildTransferPayload(product, item) {
  const payloads = [];

  if (
    product.status_available === "belum ada" &&
    product.perluMembuatBatchCodeBaru
  ) {
    for (const dist of product.distributionProducts || []) {
      payloads.push({
        items: [
          {
            pk: Number(product.stock_item_wip) || 0,
            quantity: Number(dist.quantity),
            batch: dist.batchCode,
            status: 65,
          },
        ],
        notes: `Transfer Retur Reject | Invoice: ${item.invoice} | Proc ID: ${item.proc_inst_id}`,
        location: Number(product.location_id_available),
      });
    }
  } else if (
    product.status_available === "sudah ada" &&
    product.perluMembuatBatchCodeBaru
  ) {
    for (const dist of product.distributionProducts || []) {
      payloads.push({
        items: [
          {
            pk: Number(product.stock_item_wip) || 0,
            quantity: Number(dist.quantity),
            batch: dist.batchCode,
            status: 65,
          },
        ],
        notes: `Transfer Retur Reject | Invoice: ${item.invoice} | Proc ID: ${item.proc_inst_id}`,
        location: Number(product.id_location),
      });
    }
  } else if (!product.perluMembuatBatchCodeBaru) {
    payloads.push({
      items: [
        {
          pk: Number(product.stock_item_wip) || 0,
          quantity: Number(product.quantity_placement),
          batch: product.batch_exist,
          status: 65,
        },
      ],
      notes: `Transfer Retur Reject | Invoice: ${item.invoice} | Proc ID: ${item.proc_inst_id}`,
      location: Number(product.id_location),
    });
  }

  return payloads; // return array of payloads
}

async function performTransfer(transferPayload) {
  if (!inventree || !inventree.post) {
    return { success: false, error: "Inventree client not configured" };
  }
  try {
    const { data } = await inventree.post("/stock/transfer/", transferPayload);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

const eventHandlers = {
  async onSubmit(data, process, eventKey) {
    const results = [];

    for (const item of data) {
      try {
        const instanceId = item.proc_inst_id ?? null;

        // --- Kirim ke Camunda ---
        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: instanceId,
          variables: {
            variables: {
              adjustmentReject: {
                value: Boolean(item.adjustmentRetail),
                type: "Boolean",
              },
            },
          },
        };

        const responseCamunda = await camundaConfig(
          dataCamunda,
          instanceId,
          process
        );

        if (!item) {
          results.push({
            message: "Camunda returned non-success status",
            status: responseCamunda.status,
            body: responseCamunda.data,
          });
          continue;
        }

        const dataQuery = [];
        const transferPayloads = []; // ⬅️ Kumpulkan semua transfer payload di sini

        for (const product of item.products || []) {
          try {
            // GraphQL query
            dataQuery.push(buildGraphQuery(product, item));

            // Jika bukan adjustmentRetail → buat payload transfer
            if (!item.adjustmentRetail) {
              const payloads = buildTransferPayload(product, item); // ini array
              if (Array.isArray(payloads) && payloads.length) {
                transferPayloads.push(...payloads); // <--- spread array di sini!
              }
            }
          } catch (prodErr) {
            console.error(
              `❌ Error processing product ${product.product_name}:`,
              prodErr.message || prodErr
            );
          }
        }

        // 2️⃣ Jalankan semua transferPayload satu per satu (SEQUENTIAL)
        for (const [index, payload] of transferPayloads.entries()) {
          console.log(
            `🚚 [${index + 1}/${transferPayloads.length}] Transfer dimulai...`
          );
          const transferResult = await performTransfer(payload);

          if (transferResult.success) {
            console.log(
              `✅ Transfer sukses (${index + 1}/${transferPayloads.length})`
            );
          } else {
            console.warn(
              `⚠️ Transfer gagal (${index + 1}/${transferPayloads.length}): ${
                transferResult.error
              }`
            );
          }

          // Tambahkan delay kecil antar transfer (opsional)
          await new Promise((r) => setTimeout(r, 500));
        }

        // Execute all GraphQL/db queries concurrently
        const responseQuery = await Promise.all(
          dataQuery.map((q) => configureQuery(fastify, q))
        );

        results.push({
          message: "✅ Event processed successfully",
          camunda: responseCamunda.data,
          database: responseQuery.map((r) => r.data),
        });
      } catch (error) {
        console.error(
          `❌ Error executing handler for event: ${eventKey}`,
          error.message || error
        );
        results.push({ error: error.message || String(error) });
      }
    }

    return results;
  },

  async onChange(data) {
    console.log("⚙️ Handling onChange with data:", data);
    return { message: "onChange executed", data };
  },
};

// --- Main handler ---
const handle = async (eventData) => {
  const { eventKey, data, process } = eventData;
  console.log("📦 Received eventData:", eventData);

  if (!eventHandlers[eventKey]) {
    throw new Error(`No handler found for event: ${eventKey}`);
  }

  try {
    return await eventHandlers[eventKey](data, process, eventKey);
  } catch (error) {
    console.error(
      `❌ Error executing handler for event: ${eventKey}`,
      error.message || error
    );
    throw error;
  }
};

module.exports = { handle };
