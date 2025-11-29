// utils/queryProcessor.js

function processQueryData(data) {
    // Tidak ada flattening, kembalikan data sesuai struktur aslinya
    if (Array.isArray(data)) {
      return data;
    }
    return [data];
  }
  
  module.exports = { processQueryData };