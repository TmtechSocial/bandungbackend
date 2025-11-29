require("dotenv").config();
const { configureQuery } = require("../../controller/controllerConfig");
const camundaConfig = require("../../utils/camunda/camundaConfig");
const fastify = require("fastify");
const axios = require("axios");
const GRAPHQL_API = process.env.GRAPHQL_API;
const BIGCAPITAL_API = process.env.BIGCAPITAL_API;
const BIGCAPITAL_ORGANIZATION_ID = process.env.BIGCAPITAL_ORGANIZATION_ID;
const BIGCAPITAL_TOKEN = process.env.BIGCAPITAL_TOKEN;

async function getInvoice(invoice) {
  try {
    const response = await axios.get(
      `${BIGCAPITAL_API}/sales/invoices?search_keyword=${invoice}`,
      {
        headers: {
          "Content-Type": "application/json",
          "x-access-token": `${BIGCAPITAL_TOKEN}`,
          "organization-id": `${BIGCAPITAL_ORGANIZATION_ID}`,
        },
      }
    );
    const invoicedata = response.data.sales_invoices.find(
      (i) => i.invoice_no === invoice
    );
    return invoicedata;
  } catch (error) {
    console.error("gagal get invoice: ", error);

    throw error;
  }
}

const eventHandlers = {
  async onSubmit(data, process) {
    const results = [];
    for (const item of data) {
      try {
        let taskId;
        let instanceId = item.proc_inst_id || null;

        const dataCamunda = {
          type: "complete",
          endpoint: `/engine-rest/task/{taskId}/complete`,
          instance: item.proc_inst_id,
          variables: {
            variables: {
              toko: { value: item.toko || false, type: "boolean" },
              gudang: { value: item.gudang || false, type: "boolean" },
            },
          },
        };

        const responseCamunda = await camundaConfig(
          dataCamunda,
          instanceId,
          process
        );
        console.log("responseCamunda", responseCamunda);
        if (responseCamunda.status === 200 || responseCamunda.status === 204) {
          const filteredProducts = item.products.filter(
            (p) => p.quantity_retur !== 0
          );

          const dataQuery = filteredProducts.map((product) => ({
            graph: {
              method: "mutate",
              endpoint: GRAPHQL_API,
              gqlQuery: `mutation InsertRetur($proc_inst_id: String!, $resi_retur: String!, $product_retur_date: timestamp!, $invoice: String!, $part_pk: Int!, $quantity_retur: Int!, $output: String!, $task: String!) { insert_mo_retur_one(object: {proc_inst_id: $proc_inst_id, resi_retur: $resi_retur, product_retur_date: $product_retur_date, invoice: $invoice, part_pk: $part_pk, quantity_retur: $quantity_retur, output: $output}) { id } update_mo_retur_receive(where: {proc_inst_id: {_eq: $proc_inst_id}}, _set: {task_def_key: $task}) { affected_rows } }`,
              variables: {
                proc_inst_id: item.proc_inst_id,
                resi_retur: item.resi_retur,
                product_retur_date: item.product_retur_date,
                invoice: item.invoice,
                part_pk: product.part_pk,
                quantity_retur: product.quantity_retur,
                output: product.output || "",
                task: (() => {
                  if (item.toko && item.gudang) {
                    return "Mirorim_Operasional.Retur.Reverse_Both";
                  }
                  if (item.toko) {
                    return "Mirorim_Operasional.Retur.Reverse_Retur_Toko";
                  }
                  if (item.gudang) {
                    return "Mirorim_Operasional.Retur.Reverse_Retur_Gudang";
                  }
                  return "Mirorim_Operasional.Retur.Invalid";
                })(),
              },
            },
            query: [],
          }));

          const responseQuery = await Promise.all(
            dataQuery.map((query) => configureQuery(fastify, query))
          );

          const invoiceData = await getInvoice(item.invoice);

          const entries = filteredProducts.map((product, idx) => {
            const matchedEntry = invoiceData.entries.find(
              (e) => e.item_id === product.part_pk
            );
            return {
              index: idx + 1,
              item_id: product.part_pk,
              quantity: product.quantity_retur,
              rate: matchedEntry?.rate || 0,
            };
          });

          const bigcapitalPayload = {
            customer_id: item.marketplace,
            credit_note_date: item.product_retur_date,
            reference_no: item.invoice,
            open: true,
            entries,
          };

          let bigcapitalResult = null;
          try {
            const bigcapitalResponse = await axios.post(
              `${BIGCAPITAL_API}/sales/credit_notes`,
              bigcapitalPayload,
              {
                headers: {
                  "Content-Type": "application/json",
                  "x-access-token": `${BIGCAPITAL_TOKEN}`,
                  "organization-id": `${BIGCAPITAL_ORGANIZATION_ID}`,
                },
              }
            );
            bigcapitalResult = bigcapitalResponse.data;
          } catch (err) {
            console.error("Bigcapital API error:", err);
            bigcapitalResult = { error: err.message };
          }

          results.push({
            message: "Create event processed successfully",
            camunda: responseCamunda.data,
            database: responseQuery.data,
            bigcapital: bigcapitalResult,
          });
        }
      } catch (error) {
        console.error(`Error executing handler for event: ${eventKey}`, error);
        console.log(`graphql error: ${error.dataQuery}`);

        throw error;
      }
    }

    return results;
  },

  async onChange(data) {
    console.log("Handling onChange with data:", data);
    // Implementasi onChange
    return { message: "onChange executed", data };
  },
};

const handle = async (eventData) => {
  const { eventKey, data, process } = eventData;
  console.log("eventData", eventData);

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

