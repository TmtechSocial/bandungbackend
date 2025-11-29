// Contoh mapping group ke task definition key yang diizinkan
// Format: { groupName: ["TaskDefKey1", "TaskDefKey2", ...] }
module.exports = {
  "SalesOrderCoordinator": ["Mirorim_Operasional.Order.Scan_Invoice","Mirorim_Operasional.Order.Confirmation_Customer","Mirorim_Operasional.Order.Update_Order"],
  "SalesOrderStaff": ["Mirorim_Operasional.Order.Scan_Invoice","Mirorim_Operasional.Order.Confirmation_Customer","Mirorim_Operasional.Order.Update_Order"],
  "SalesScanningStaff": ["Mirorim_Operasional.Order.Scan_Invoice"],
  "SalesLeader": ["Mirorim_Operasional.Order.Wasit"],  
  "InventoryRetailStaff": ["Mirorim_Operasional.Order.Picking","Mirorim_Operasional.Order.Adjustment_Order","Mirorim_Warehouse.Internal_Mutasi.Picking_Internal_Mutasi", "Mirorim_Warehouse.Internal_Mutasi.Placement_Internal_Mutasi", "Mirorim_Warehouse.Internal_Mutasi_Prepare.Picking_Mutasi_Prepare", "Mirorim_Warehouse.Generic_Staging.Placement_Staging_Area", "Mirorim_Warehouse.Generic_Mutasi_Prepare.Placement_Mutasi_Prepare", "Mirorim_Operasional.Retur.Placement_Item_Retur_Retail"],
  "InventoryRetailCoordinator": ["Mirorim_Operasional.Order.Picking","Mirorim_Operasional.Order.Adjustment_Order","Mirorim_Operasional.Order.Adjustment_Pick","Mirorim_Warehouse.Generic_Staging.Input_Quantity_Staging", "Mirorim_Operasional.Retur.Placing_Staging_Retur_Retail"],
  "SalesPackingStaff": ["Mirorim_Operasional.Order.Box","Mirorim_Operasional.Order.Packing","Mirorim_Operasional.Order.Scan_Kurir","Mirorim_Operasional.Order.Pickup_Instant"],
  "SalesPackingCoordinator": ["Mirorim_Operasional.Order.Box","Mirorim_Operasional.Order.Packing","Mirorim_Operasional.Order.Scan_Kurir","Mirorim_Operasional.Order.Pickup_Instant"],
  "SalesQCCoordinator": ["Mirorim_Operasional.Order.Checking"],
  "SalesQCStaff": ["Mirorim_Operasional.Order.Checking"],
  "InventoryLeader": ["Mirorim_Operasional.Retur.Adjustment_Item_Retur_Wholesale", "Mirorim_Operasional.Retur.Adjustment_Item_Retur_Retail","Mirorim_Operasional.Retur.Adjustment_Item_Retur_Reject"],
  "InventoryCoLeader": ["Mirorim_Operasional.Retur.Adjustment_Item_Retur_Wholesale", "Mirorim_Operasional.Retur.Adjustment_Item_Retur_Retail","Mirorim_Operasional.Retur.Adjustment_Item_Retur_Reject"],
  "InventoryWholesaleStaff": ["Mirorim_Warehouse.Internal_Mutasi.Picking_Internal_Mutasi", "Mirorim_Warehouse.Internal_Mutasi.Placement_Internal_Mutasi", "Mirorim_Warehouse.Internal_Mutasi_Prepare.Picking_Mutasi_Prepare", "Mirorim_Warehouse.Generic_Staging.Placement_Staging_Area", "Mirorim_Warehouse.Generic_Mutasi_Prepare.Placement_Mutasi_Prepare"],
  "InventoryWholesaleCoordinator": ["Mirorim_Warehouse.Generic_Staging.Input_Quantity_Staging", "Mirorim_Operasional.Retur.Placing_Staging_Retur_Wholesale"],
  "InventoryPrepareStaff": ["Mirorim_Warehouse.Internal_Prepare.Processing_Product_Prepare"],
  "InventoryPrepareCoordinator": ["Mirorim_Warehouse.Internal_Prepare.QC_Product_Prepare","Mirorim_Warehouse.Generic_Staging.Input_Quantity_Staging"],
  "InventoryRejectStaff": ["Mirorim_Operasional.Retur.Placing_Staging_Retur_Reject", "Mirorim_Operasional.Retur.Placement_Item_Retur_Reject"],
};
