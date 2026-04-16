const axios = require("axios");

const INVENTREE_API = process.env.SERVER_INVENTREE;
const INVENTREE_API_TOKEN = process.env.INVENTREE_API_TOKEN;
const GRAPHQL_REST = process.env.GRAPHQL_REST;
const inventree = axios.create({
  baseURL: `${INVENTREE_API}/api`,
  headers: {
    Authorization: `Token ${INVENTREE_API_TOKEN}`,
    "Content-Type": "application/json",
  },
});

/**
 * ADD STOCK — menambah stok
 */
async function addStock(stockpk, quantity, notes = "") {
  try {
    const payload = {
      items: [
        {
          pk: Number(stockpk),
          quantity: Math.abs(quantity),
        },
      ],
      notes,
    };

    console.log("📦 add Stock payload:", JSON.stringify(payload, null, 2));

    const res = await inventree.post("/stock/add/", payload);
    console.log("✅ add Stock response:", res.data);
    return res.data;
  } catch (err) {
    const status = err.response?.status;
    const items = err.response?.data?.items;
    console.error(`❌ addStock Error: status=${status}, items=`, items);
    throw { status, items }; // lempar error sederhana
  }
}

/**
 * REMOVE STOCK — mengurangi stok
 */
async function removeStock(stockpk, quantity, notes = "") {
  try {
    const payload = {
      items: [
        {
          pk: Number(stockpk),
          quantity: Math.abs(quantity),
        },
      ],
      notes,
    };

    console.log("📦 removeStock payload:", JSON.stringify(payload, null, 2));

    const res = await inventree.post("/stock/remove/", payload);
    console.log("✅ remove Stock response:", res.data);
    return res.data;
  } catch (err) {
    const status = err.response?.status;
    const items = err.response?.data?.items;
    console.error(`❌ removeStock Error: status=${status}, items=`, items);
    throw { status, items }; // lempar error sederhana
  }
}

/*
 * COUNT STOCK — menghitung ulang stok
 */
async function countStock(stockpk, quantity, notes = "") {
  try {
    const payload = {
      items: [
        {
          pk: Number(stockpk),
          quantity: Math.abs(quantity),
        },
      ],
      notes,
    };

    console.log("📦 countStock payload:", JSON.stringify(payload, null, 2));

    const res = await inventree.post("/stock/count/", payload);
    console.log("✅ count Stock response:", res.data);
    return res.data;
  } catch (err) {
    const status = err.response?.status;
    const items = err.response?.data?.items;
    console.error(`❌ countStock Error: status=${status}, items=`, items);
    throw { status, items }; // lempar error sederhana
  }
}

/**
 * TRANSFER STOCK — memindahkan stok ke lokasi lain
 */
async function transferStock(stockpk, quantity, destination, notes = "") {
  try {
    const payload = {
      items: [
        {
          pk: Number(stockpk),
          quantity,
        },
      ],
      notes,
      location: destination, // Lokasi tujuan
    };

    console.log("📦 transfer Stock payload:", JSON.stringify(payload, null, 2));

    const res = await inventree.post("/stock/transfer/", payload);
    console.log("✅ transfer Stock response:", res.data);
    return res.data;
  } catch (err) {
    const status = err.response?.status;
    const items = err.response?.data?.items;
    console.error(`❌ transferStock Error: status=${status}, items=`, items);
    throw { status, items }; // lempar error sederhana
  }
}

/**
 * MERGE STOCK — cari stok berdasarkan lokasi & part, lalu merge
 */
async function mergeStock(partId, destLocationPk, notes = "") {
  try {
    // 1️⃣ Cari stok di lokasi + part
    const { data: stockItems } = await inventree.get(
      `/stock/?location=${destLocationPk}&part=${partId}`
    );

    const stockPKs = stockItems?.results
      ?.map((stock) => stock.pk)
      .filter(Boolean);

    const stockCount = stockPKs?.length || 0;

    // ✅ LOGIC BARU:
    if (stockCount <= 1) {
      console.log(
        `ℹ️ Skip merge: jumlah stok hanya ${stockCount} (lokasi ${destLocationPk}, part ${partId})`
      );
      return null;
    }

    // 3️⃣ Buat payload (pakai 'item' di dalam items[])
    const mergePayload = {
      items: stockPKs.map((pk) => ({ item: pk })),
      location: destLocationPk,
      notes,
    };

    console.log(
      "📦 merge Stock payload:",
      JSON.stringify(mergePayload, null, 2)
    );

    // 4️⃣ Eksekusi merge
    const res = await inventree.post("/stock/merge/", mergePayload);
    console.log("✅ merge Stock response:", res.data);
    return res.data;
  } catch (err) {
    const status = err.response?.status;
    const items = err.response?.data?.items;
    console.error(`❌ mergeStock Error: status=${status}, items=`, items);
    throw { status, items }; // lempar error sederhana
  }
}

/**
 * STOCK TRACK — melihat riwayat pergerakan stok
 */
async function trackStock(stockPk, search = "") {
  try {
    const payload = {
      item: Number(stockPk),
      search: search || undefined,
    };

    console.log("📦 stockTrack payload:", JSON.stringify(payload, null, 2));

    const res = await inventree.get("/stock/track/", { params: payload });

    console.log("✅ stockTrack response:", JSON.stringify(res.data, null, 2));

    return res.data;
  } catch (err) {
    const status = err.response?.status;
    const items = err.response?.data?.items;
    console.error(`❌ stockTrack Error: status=${status}, items=`, items);
    throw { status, items }; // lempar error sederhana
  }
}

async function getDescStock(partId, destLocationPk) {
  try {
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const { data } = await axios.get(
      `${GRAPHQL_REST}/stock_stockitemdesc?location_id=${destLocationPk}&part_id=${partId}`
    );

    const stockPKs = data?.stock_stockitem?.[0]?.id || null;

    return stockPKs;
  } catch (err) {
    const status = err.response?.status;
    const items = err.response?.data?.items;
    console.error(`❌ mergeStock Error: status=${status}, items=`, items);
    throw { status, items };
  }
}

async function getAllStock(partId, destLocationPk) {
  try {
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const { data: stockItems } = await inventree.get(
      `/stock/?location=${destLocationPk}&part=${partId}&status=10&limit=1000`
    );

    const result = stockItems || null;
    // console.log(`result: ${JSON.stringify(result)}`);
    
    return result;
  } catch (err) {
    const status = err.response?.status;
    const items = err.response?.data?.items;
    console.error(`❌ mergeStock Error: status=${status}, items=`, items);
    throw { status, items };
  }
}

async function createStockTransferEqual(partId, quantity, sourceId) {
  try {
    const { data: srcStock } = await inventree.get(`/stock/${sourceId}/`);
    const locationId = srcStock.location;
    const payload = {
      part: partId,
      quantity,
      location: locationId,
    };
    console.log(
      "📦 createStockTransferEqual Payload:",
      JSON.stringify(payload, null, 2)
    );
    await inventree.post("/stock/", payload);
    const { data: stockItems } = await inventree.get(
      `/stock/?location=${locationId}&part=${partId}&ordering=-updated&limit=1`
    );
    const stockPK = stockItems?.results?.[0]?.pk || null;
    console.log("📌 New Primary Stock PK:", stockPK);
    return stockPK;
  } catch (err) {
    const status = err.response?.status;
    const items = err.response?.data?.items;

    console.error(
      `❌ createStockTransferEqual Error: status=${status}, items=`,
      items
    );
    throw { status, items };
  }
}

module.exports = {
  addStock,
  removeStock,
  countStock,
  transferStock,
  mergeStock,
  trackStock,
  getDescStock,
  createStockTransferEqual,
  getAllStock
};

