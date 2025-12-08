// Contoh mapping group ke task definition key yang diizinkan
// Format: { groupName: ["TaskDefKey1", "TaskDefKey2", ...] }
module.exports = {
  "OnDuty": ["Mirorim_Operasional.Order.Scan_Invoice","Mirorim_Operasional.Order.Confirmation_Customer","Mirorim_Operasional.Order.Wasit","Mirorim_Operasional.Order.Update_Order"],
  "Picker": ["Mirorim_Operasional.Order.Picking","Mirorim_Operasional.Order.Adjustment_Order","Mirorim_Operasional.Order.Adjustment_Pick"],
  "Boxer": ["Mirorim_Operasional.Order.Box"],
  "Checker": ["Mirorim_Operasional.Order.Checking"],
  "Packer": ["Mirorim_Operasional.Order.Packing"],
  "Categorizer": ["Mirorim_Operasional.Order.Scan_Kurir","Mirorim_Operasional.Order.Pickup_Instant"],
  "StafToko": ["Mirorim_Operasional.Order.Scan_Invoice"],
  "StafGudang": ["Mirorim_Operasional.Refill.Picker_Refill"],
  "QcGudang": ["Mirorim_Operasional.Refill.Compare_Refill"],
  "ManagerGudang": ["Mirorim_Operasional.Refill.Adjustment_Pack", "Mirorim_Operasional.Refill.Adjusment_Refill"],
  "ManagerPrepare": ["Mirorim_Operasional.Refill.QC_Refill"],
  "WarehouseOperator": ["Mirorim_Stock.Mutasi_Gudang.picking_sku", "Mirorim_Stock.Mutasi_Gudang.placing_sku"],
  "InboundOutboundCoordinator": ["Mirorim_Stock.Mutasi_Gudang.Quantity_Kepenuhan", "Mirorim_Stock.Mutasi_Gudang.Print_Mutasi_Gudang"]
  // Tambahkan group dan task def key lain sesuai kebutuhan
};