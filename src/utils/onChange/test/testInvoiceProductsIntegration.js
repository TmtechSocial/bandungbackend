// Integration test for invoice → products DataGrid onChange functionality
// This test verifies that the modular onChange system works end-to-end

const path = require('path');

// Mock database response
const mockDBResponse = [
  {
    schema_json: {
      "title": "Order Form",
      "components": [
        {
          "label": "Invoice Number",
          "key": "invoice",
          "type": "textfield",
          "validate": {"required": true}
        },
        {
          "label": "Products",
          "key": "products", 
          "type": "datagrid",
          "api": {
            "enabled": true,
            "endpoint": "/api/products",
            "params": {"invoice": "{{invoice}}"},
            "refreshTriggers": ["invoice"]
          },
          "components": [
            {"label": "Product Name", "key": "product_name", "type": "textfield"},
            {"label": "Quantity", "key": "quantity", "type": "number"},
            {"label": "Price", "key": "price", "type": "currency"}
          ]
        }
      ]
    },
    event_json: {
      "events": [
        {
          "eventKey": "invoice",
          "eventType": "change",
          "refreshField": ["products"],
          "dependencies": {
            "products": {
              "type": "datagrid",
              "refreshOnChange": true,
              "apiRefresh": true,
              "reloadData": true
            }
          },
          "api": {
            "enabled": true,
            "endpoint": "/api/products",
            "method": "GET",
            "params": {"invoice": "{{invoice}}"}
          }
        }
      ]
    }
  }
];

// Mock API response for products
const mockProductsAPIResponse = {
  success: true,
  data: [
    {
      product_name: "Widget A",
      quantity: 2,
      price: 15.99
    },
    {
      product_name: "Widget B", 
      quantity: 1,
      price: 25.50
    }
  ]
};

// Mock session
const mockSession = {
  token: "test-token",
  user: "test-user"
};

// Test function
async function testInvoiceProductsOnChange() {
  console.log('\n=== Testing Invoice → Products DataGrid onChange ===\n');
  
  try {
    // Import the main onChange handler
    const dynamicChange = require('../index');
    
    // Test parameters
    const testParams = {
      process: 'test_invoice_products',
      instance: [],
      session: mockSession,
      eventKey: 'invoice',
      value: 'INV-2024-001',
      refreshData: true
    };
    
    console.log('1. Starting onChange test with params:');
    console.log('   - Process:', testParams.process);
    console.log('   - Event Key:', testParams.eventKey);
    console.log('   - Value:', testParams.value);
    console.log('   - Expected refresh:', 'products DataGrid');
    
    // Mock the database call
    const originalConfigureProcess = require('../../../controller/controllerConfig').configureProcess;
    require('../../../controller/controllerConfig').configureProcess = async () => mockDBResponse;
    
    // Mock the API call
    const originalConfigureQuery = require('../../../controller/controllerConfig').configureQuery;
    require('../../../controller/controllerConfig').configureQuery = async () => mockProductsAPIResponse;
    
    console.log('\n2. Executing onChange handler...');
    
    // Execute the onChange handler
    const result = await dynamicChange(null, testParams.process, { [testParams.eventKey]: testParams.value }, testParams.instance, testParams.session);
    
    console.log('\n3. Checking results...');
    
    // Verify result structure
    if (!result) {
      throw new Error('No result returned from handleChange');
    }
    
    if (!result.success) {
      throw new Error(`onChange failed: ${result.error || 'Unknown error'}`);
    }
    
    console.log('   ✓ onChange executed successfully');
    
    // Verify that products component was processed
    if (!result.components || !result.components.products) {
      throw new Error('Products component not found in result');
    }
    
    console.log('   ✓ Products component found in result');
    
    // Verify DataGrid content
    const productsComponent = result.components.products;
    
    if (productsComponent.type !== 'datagrid') {
      throw new Error(`Expected datagrid, got ${productsComponent.type}`);
    }
    
    console.log('   ✓ Products component is of type datagrid');
    
    // Verify API data was loaded
    if (!productsComponent.defaultValue || !Array.isArray(productsComponent.defaultValue)) {
      throw new Error('Products DataGrid defaultValue not set or not an array');
    }
    
    if (productsComponent.defaultValue.length !== 2) {
      throw new Error(`Expected 2 products, got ${productsComponent.defaultValue.length}`);
    }
    
    console.log('   ✓ Products DataGrid contains expected number of items (2)');
    
    // Verify product data
    const firstProduct = productsComponent.defaultValue[0];
    if (firstProduct.product_name !== 'Widget A' || firstProduct.quantity !== 2) {
      throw new Error('Product data does not match expected values');
    }
    
    console.log('   ✓ Product data matches expected values');
    
    // Verify event was processed
    if (!result.events || !result.events.invoice) {
      throw new Error('Invoice event not found in result events');
    }
    
    console.log('   ✓ Invoice event was properly processed');
    
    // Verify performance metrics
    if (!result.performance) {
      console.log('   ⚠ Performance metrics not available');
    } else {
      console.log(`   ✓ Performance: ${result.performance.duration}ms total`);
      if (result.performance.apiCalls > 0) {
        console.log(`   ✓ API calls made: ${result.performance.apiCalls}`);
      }
    }
    
    console.log('\n4. Testing edge cases...');
    
    // Test with empty invoice value
    const emptyResult = await dynamicChange(null, testParams.process, { [testParams.eventKey]: '' }, testParams.instance, testParams.session);
    
    if (emptyResult.success) {
      console.log('   ✓ Empty value handled gracefully');
    }
    
    // Test with null value
    const nullResult = await dynamicChange(null, testParams.process, { [testParams.eventKey]: null }, testParams.instance, testParams.session);
    
    if (nullResult.success) {
      console.log('   ✓ Null value handled gracefully');
    }
    
    console.log('\n=== Invoice → Products DataGrid onChange Test PASSED ===\n');
    
    return {
      success: true,
      message: 'All tests passed successfully',
      details: {
        productsCount: productsComponent.defaultValue.length,
        eventProcessed: !!result.events.invoice,
        performanceOk: !!result.performance
      }
    };
    
  } catch (error) {
    console.error('\n❌ Test FAILED:', error.message);
    console.error('Stack trace:', error.stack);
    
    return {
      success: false,
      error: error.message,
      stack: error.stack
    };
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testInvoiceProductsOnChange()
    .then(result => {
      if (result.success) {
        console.log('🎉 Integration test completed successfully!');
        process.exit(0);
      } else {
        console.error('💥 Integration test failed!');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('💥 Unexpected test error:', error);
      process.exit(1);
    });
}

module.exports = {
  testInvoiceProductsOnChange
};
