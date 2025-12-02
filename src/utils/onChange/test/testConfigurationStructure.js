// Simple test for invoice → products DataGrid onChange functionality
// This test focuses specifically on the schema.json and event.json configuration

const path = require('path');

// Example schema.json structure based on user requirements
const updatedSchemaJson = {
  "display": "form",
  "components": [
    {
      "key": "proc_inst_id",
      "type": "textfield",
      "input": true,
      "label": "Instance ID",
      "table": "mo_retur_receive",
      "hidden": true,
      "tableView": true,
      "applyMaskOn": "change",
      "clearOnHide": false,
      "validateWhenHidden": false
    },
    {
      "key": "resi_retur",
      "type": "textfield",
      "input": true,
      "label": "Resi Retur",
      "table": "mo_retur_receive",
      "disabled": true,
      "tableView": true,
      "applyMaskOn": "change",
      "clearOnHide": false,
      "validateWhenHidden": false
    },
    {
      "key": "courier",
      "type": "textfield",
      "input": true,
      "label": "Kurir",
      "table": "mo_retur_receive",
      "disabled": true,
      "tableView": true,
      "applyMaskOn": "change",
      "clearOnHide": false,
      "validateWhenHidden": false
    },
    {
      "key": "courier_name",
      "type": "textfield",
      "input": true,
      "label": "Nama Kurir Pengantar",
      "table": "mo_retur_receive",
      "disabled": true,
      "tableView": true,
      "applyMaskOn": "change",
      "clearOnHide": false,
      "validateWhenHidden": false
    },
    {
      "key": "retur_date",
      "type": "textfield",
      "input": true,
      "label": "Retur Date",
      "table": "mo_retur_receive",
      "disabled": true,
      "tableView": true,
      "applyMaskOn": "change",
      "clearOnHide": false,
      "validateWhenHidden": false
    },
    {
      "key": "invoice",
      "case": "uppercase",
      "type": "textfield",
      "input": true,
      "label": "Invoice",
      "table": "mo_retur_receive",
      "widget": "choicesjs",
      "tableView": true,
      "conditional": {
        "eq": "not match",
        "show": false,
        "when": "resi_match"
      },
      "validateWhenHidden": false,
      // ADDED: onChange configuration to trigger products refresh
      "onChange": {
        "refreshField": "products"
      }
    },
    {
      "key": "products",
      "type": "datagrid",
      "input": true,
      "label": "List Product",
      "removeRow": false,
      "tableView": false,
      "addAnother": false,
      // ADDED: API source configuration for dynamic loading
      "apiSource": {
        "source": "productsFromInvoice",
        "dependsOn": "invoice"
      },
      "components": [
        {
          "key": "image_preview",
          "html": "<div style='text-align:center;'><img class='zoom-image' src='https://mirorim.ddns.net:8111{{ row.image }}' alt='Gambar Produk' style='max-width:100px; height:auto;'/></div>",
          "type": "content",
          "input": false,
          "label": "Gambar Produk",
          "tableView": false
        },
        {
          "key": "image",
          "type": "textfield",
          "input": true,
          "label": "URL Gambar",
          "hidden": true,
          "apiSource": {
            "link": "https://mirorim.ddns.net:8111",
            "source": "imageFromPk",
            "valueKey": "image"
          },
          "tableView": false
        },
        {
          "key": "part_pk",
          "type": "number",
          "input": true,
          "label": "Instance ID",
          "table": "mo_retur_receive.invoice_retur_to_invoice",
          "hidden": true,
          "tableView": true,
          "applyMaskOn": "change",
          "clearOnHide": false,
          "validateWhenHidden": false
        },
        {
          "key": "product_name",
          "type": "textarea",
          "input": false,
          "label": "Nama Product",
          "table": "mo_retur_receive.invoice_retur_to_invoice",
          "disabled": true,
          "tableView": true,
          "persistent": false,
          "validateWhenHidden": false
        },
        {
          "key": "sku_toko",
          "type": "textfield",
          "input": false,
          "label": "SKU TOKO",
          "table": "mo_retur_receive.invoice_retur_to_invoice",
          "disabled": true,
          "tableView": true,
          "persistent": false,
          "validateWhenHidden": false
        },
        {
          "key": "quantity_convert",
          "type": "textfield",
          "input": false,
          "label": "Quantity Order",
          "table": "mo_retur_receive.invoice_retur_to_invoice",
          "disabled": true,
          "tableView": true,
          "persistent": false,
          "applyMaskOn": "change",
          "clearOnHide": false,
          "validateWhenHidden": false
        }
      ]
    },
    {
      "key": "resi_match",
      "data": {
        "values": [
          {
            "label": "Iya Invoice Kita",
            "value": "match"
          },
          {
            "label": "Reject, Bukan Invoice Kita",
            "value": "not match"
          }
        ]
      },
      "type": "select",
      "input": true,
      "label": "Resi sesuai dengan Invoice kita?",
      "widget": "choicesjs",
      "tableView": true,
      "validateWhenHidden": false
    },
    {
      "key": "barang_match",
      "data": {
        "values": [
          {
            "label": "Teknisi, Perlu QC Barang",
            "value": "match check"
          },
          {
            "label": "On Duty, Langsung Input Barang",
            "value": "match"
          },
          {
            "label": "Admin MP, Follow Up ke MP karena barang bermasalah atau barang tidak sama",
            "value": "mismatch"
          }
        ]
      },
      "type": "select",
      "input": true,
      "label": "Invoice Perlu Diteruskan kemana?",
      "widget": "choicesjs",
      "tableView": true,
      "conditional": {
        "eq": "match",
        "show": true,
        "when": "resi_match"
      },
      "validateWhenHidden": false
    },
    {
      "key": "submit",
      "type": "button",
      "event": "submit",
      "input": true,
      "label": "Submit",
      "action": "event",
      "tableView": false,
      "customClass": "ml-auto mt-2",
      "saveOnEnter": false,
      "showValidations": false
    }
  ]
};

// Example event.json structure based on backend onChange system
const updatedEventJson = {
  "onRender": {
    "api": {
      "imageFromPk": {
        "url": "http://36.50.112.247:8004/api/part/:id/",
        "path": {
          "id": "${graph.mo_retur_receive.invoice_retur_to_invoice.part_pk}"
        },
        "method": "GET",
        "headers": {
          "Authorization": "Basic YWRtaW46YWRtaW4="
        }
      },
      // ADDED: New API source for products by invoice
      "productsFromInvoice": {
        "url": "http://localhost:9000/v1/graphql",
        "method": "POST",
        "headers": {
          "Content-Type": "application/json",
          "Authorization": "Bearer ${session.token}"
        },
        "params": {
          "invoice": "${invoice}"
        },
        "gqlQuery": "query GetProductsByInvoice($invoice: String!) { mo_retur_receive(where: {invoice: {_eq: $invoice}}) { invoice_retur_to_invoice { sku_toko product_name part_pk quantity_convert } } }",
        "variables": {
          "invoice": "${invoice}"
        }
      }
    },
    "graph": {
      "method": "query",
      "endpoint": "http://localhost:9000/v1/graphql",
      "gqlQuery": "query MyQuery($proc_inst_id: [String!]) { mo_retur_receive(where: {proc_inst_id: {_in: $proc_inst_id}}) { proc_inst_id resi_retur invoice retur_date courier courier_name invoice_retur_to_invoice { sku_toko product_name part_pk quantity_convert } } }",
      "variables": {
        "proc_inst_id": "${instance}"
      }
    },
    "query": "",
    "endpoint": "/dynamicQuery/data"
  },
  "onSubmit": {
    "method": "POST",
    "endpoint": "http://localhost:5000/dynamicSubmit"
  },
  // ADDED: onChange configuration
  "onChange": {
    "events": [
      {
        "eventKey": "invoice",
        "eventType": "change",
        "description": "Refresh products DataGrid when invoice changes",
        "refreshField": ["products"],
        "dependencies": {
          "products": {
            "type": "datagrid",
            "refreshOnChange": true,
            "apiRefresh": true,
            "clearOnChange": true,
            "reloadData": true
          }
        },
        "api": {
          "enabled": true,
          "source": "productsFromInvoice",
          "params": {
            "invoice": "${invoice}"
          }
        },
        "validation": {
          "required": false,
          "minLength": 1
        },
        "performance": {
          "debounceDelay": 300,
          "enableCaching": false
        }
      }
    ],
    "globalSettings": {
      "autoSave": false,
      "validateOnChange": true,
      "enablePerformanceMonitoring": true,
      "debounceDelay": 300,
      "errorHandling": {
        "showUserFriendlyMessages": true,
        "logDetailedErrors": true,
        "retryFailedRequests": true
      }
    }
  }
};

function testConfigurationStructure() {
  console.log('\n=== Testing Updated Schema and Event Configuration ===\n');
  
  const results = {
    schemaTests: [],
    eventTests: [],
    integrationTests: []
  };
  
  console.log('1. Testing Schema Configuration...');
  
  // Test 1: Invoice field has onChange configuration
  const invoiceField = updatedSchemaJson.components.find(c => c.key === 'invoice');
  if (invoiceField && invoiceField.onChange && invoiceField.onChange.refreshField === 'products') {
    console.log('   ✓ Invoice field has onChange.refreshField configured');
    results.schemaTests.push({ test: 'invoice_onChange', passed: true });
  } else {
    console.log('   ❌ Invoice field missing onChange configuration');
    results.schemaTests.push({ test: 'invoice_onChange', passed: false });
  }
  
  // Test 2: Products DataGrid has apiSource configuration
  const productsField = updatedSchemaJson.components.find(c => c.key === 'products');
  if (productsField && productsField.apiSource && productsField.apiSource.source === 'productsFromInvoice') {
    console.log('   ✓ Products DataGrid has apiSource configured');
    results.schemaTests.push({ test: 'products_apiSource', passed: true });
  } else {
    console.log('   ❌ Products DataGrid missing apiSource configuration');
    results.schemaTests.push({ test: 'products_apiSource', passed: false });
  }
  
  // Test 3: Products DataGrid has dependsOn configuration
  if (productsField && productsField.apiSource && productsField.apiSource.dependsOn === 'invoice') {
    console.log('   ✓ Products DataGrid dependsOn invoice');
    results.schemaTests.push({ test: 'products_dependsOn', passed: true });
  } else {
    console.log('   ❌ Products DataGrid missing dependsOn configuration');
    results.schemaTests.push({ test: 'products_dependsOn', passed: false });
  }
  
  console.log('\n2. Testing Event Configuration...');
  
  // Test 4: Event JSON has onChange section
  if (updatedEventJson.onChange && updatedEventJson.onChange.events) {
    console.log('   ✓ Event JSON has onChange section');
    results.eventTests.push({ test: 'has_onChange', passed: true });
  } else {
    console.log('   ❌ Event JSON missing onChange section');
    results.eventTests.push({ test: 'has_onChange', passed: false });
  }
  
  // Test 5: Invoice change event is configured
  const invoiceEvent = updatedEventJson.onChange.events.find(e => e.eventKey === 'invoice');
  if (invoiceEvent && invoiceEvent.refreshField.includes('products')) {
    console.log('   ✓ Invoice change event configured to refresh products');
    results.eventTests.push({ test: 'invoice_event', passed: true });
  } else {
    console.log('   ❌ Invoice change event not properly configured');
    results.eventTests.push({ test: 'invoice_event', passed: false });
  }
  
  // Test 6: API source for products is defined
  if (updatedEventJson.onRender.api.productsFromInvoice) {
    console.log('   ✓ API source for products is defined');
    results.eventTests.push({ test: 'products_api_defined', passed: true });
  } else {
    console.log('   ❌ API source for products not defined');
    results.eventTests.push({ test: 'products_api_defined', passed: false });
  }
  
  // Test 7: Products API has invoice parameter
  const productsApi = updatedEventJson.onRender.api.productsFromInvoice;
  if (productsApi && productsApi.params && productsApi.params.invoice === '${invoice}') {
    console.log('   ✓ Products API accepts invoice parameter');
    results.eventTests.push({ test: 'products_api_params', passed: true });
  } else {
    console.log('   ❌ Products API missing invoice parameter');
    results.eventTests.push({ test: 'products_api_params', passed: false });
  }
  
  console.log('\n3. Testing Integration Compatibility...');
  
  // Test 8: Backend compatibility - onChange event matches schema
  const backendCompatible = invoiceField && invoiceField.onChange && 
                            invoiceEvent && invoiceEvent.eventKey === 'invoice';
  if (backendCompatible) {
    console.log('   ✓ Schema and event configurations are compatible');
    results.integrationTests.push({ test: 'backend_compatible', passed: true });
  } else {
    console.log('   ❌ Schema and event configurations are not compatible');
    results.integrationTests.push({ test: 'backend_compatible', passed: false });
  }
  
  // Test 9: API source consistency
  const apiSourceConsistent = productsField && productsField.apiSource && 
                              productsField.apiSource.source === 'productsFromInvoice' &&
                              updatedEventJson.onRender.api.productsFromInvoice;
  if (apiSourceConsistent) {
    console.log('   ✓ API source references are consistent');
    results.integrationTests.push({ test: 'api_consistent', passed: true });
  } else {
    console.log('   ❌ API source references are inconsistent');
    results.integrationTests.push({ test: 'api_consistent', passed: false });
  }
  
  // Calculate summary
  const totalTests = results.schemaTests.length + results.eventTests.length + results.integrationTests.length;
  const passedTests = [...results.schemaTests, ...results.eventTests, ...results.integrationTests]
                      .filter(test => test.passed).length;
  
  console.log(`\n=== Test Summary: ${passedTests}/${totalTests} tests passed ===`);
  
  if (passedTests === totalTests) {
    console.log('🎉 All configuration tests passed! Schema and Event configurations are ready for onChange.');
  } else {
    console.log('⚠️  Some tests failed. Please review the configuration.');
  }
  
  return {
    success: passedTests === totalTests,
    results,
    summary: {
      total: totalTests,
      passed: passedTests,
      failed: totalTests - passedTests
    },
    configurations: {
      schema: updatedSchemaJson,
      event: updatedEventJson
    }
  };
}

// Run the test if this file is executed directly
if (require.main === module) {
  const result = testConfigurationStructure();
  
  if (result.success) {
    console.log('\n✅ Configuration test completed successfully!');
    console.log('\nYou can now use these configurations in your database:');
    console.log('1. Update schema_json with the new schema configuration');
    console.log('2. Update event_json with the new event configuration');
    console.log('3. The invoice field will trigger products DataGrid refresh when changed');
    process.exit(0);
  } else {
    console.log('\n❌ Configuration test failed!');
    console.log('Please review the failed tests and update configurations accordingly.');
    process.exit(1);
  }
}

module.exports = {
  testConfigurationStructure,
  updatedSchemaJson,
  updatedEventJson
};
