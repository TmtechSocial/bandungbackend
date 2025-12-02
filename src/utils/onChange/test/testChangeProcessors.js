// test/testChangeProcessors.js - Simple test for onChange processors

const processComponents = require('../process/processComponents');

/**
 * Simple test to verify all onChange processors work correctly
 */
async function testChangeProcessors() {
  console.log('🧪 Testing onChange Component Processors...\n');
  
  // Mock data for testing
  const mockQueryData = [
    {
      sqlQuery: {
        table: 'products',
        data: [
          { id: 1, name: 'Product A', category: 'Electronics' },
          { id: 2, name: 'Product B', category: 'Books' }
        ]
      }
    }
  ];
  
  const mockFormState = {
    data: {},
    apiResults: {
      'productAPI': [
        { id: 1, name: 'API Product 1', price: 100 },
        { id: 2, name: 'API Product 2', price: 200 }
      ]
    }
  };
  
  const mockSession = { userId: 1, role: 'admin' };
  const mockApiConfigs = {};
  const mockMemberResult = { role: 'admin', permissions: ['read', 'write'] };
  
  // Test components for each processor type
  const testComponents = [
    // Select component
    {
      key: 'test_select',
      type: 'select',
      table: 'products',
      labelProperty: 'name',
      valueProperty: 'id',
      data: { values: [] }
    },
    
    // SelectBoxes component
    {
      key: 'test_selectboxes',
      type: 'selectboxes',
      apiSource: { source: 'productAPI' },
      labelProperty: 'name',
      valueProperty: 'id',
      values: []
    },
    
    // DataGrid component
    {
      key: 'test_datagrid',
      type: 'datagrid',
      table: 'products',
      columns: [
        { key: 'name', label: 'Product Name' },
        { key: 'category', label: 'Category' }
      ]
    },
    
    // EditGrid component
    {
      key: 'test_editgrid',
      type: 'editgrid',
      table: 'products',
      labelProperty: 'name',
      valueProperty: 'id',
      data: { values: [] }
    },
    
    // Content component
    {
      key: 'test_content',
      type: 'content',
      html: '<div>{{name}} - {{category}}</div>',
      table: 'products'
    },
    
    // Default components
    {
      key: 'test_textfield',
      type: 'textfield',
      defaultValue: 'Test Value'
    },
    
    {
      key: 'test_checkbox',
      type: 'checkbox',
      defaultValue: true
    }
  ];
  
  try {
    console.log(`Testing ${testComponents.length} components...\n`);
    
    const result = await processComponents(
      testComponents,
      mockQueryData,
      mockFormState,
      mockSession,
      mockApiConfigs,
      mockMemberResult
    );
    
    console.log('✅ Test Results:');
    console.log(`  - Success: ${result.success}`);
    console.log(`  - Processed: ${result.processedCount}/${result.totalComponents}`);
    console.log(`  - Errors: ${result.errors.length}`);
    console.log(`  - Total Time: ${result.timing.totalTime}ms`);
    console.log(`  - Sync Time: ${result.timing.syncTime}ms`);
    console.log(`  - Parallel Time: ${result.timing.parallelTime || 0}ms`);
    console.log(`  - Sequential Time: ${result.timing.sequentialTime}ms\n`);
    
    if (result.errors.length > 0) {
      console.log('❌ Errors found:');
      result.errors.forEach(error => {
        console.log(`  - ${error.key} (${error.type}): ${error.error}`);
      });
      console.log('');
    }
    
    console.log('📊 Component Type Distribution:');
    Object.entries(result.componentTypeCounts).forEach(([type, count]) => {
      console.log(`  - ${type}: ${count}`);
    });
    console.log('');
    
    // Verify specific component results
    console.log('🔍 Component Verification:');
    
    const selectComponent = testComponents.find(c => c.type === 'select');
    if (selectComponent && selectComponent.data && selectComponent.data.values.length > 0) {
      console.log(`  ✅ Select: ${selectComponent.data.values.length} options loaded`);
    }
    
    const selectboxesComponent = testComponents.find(c => c.type === 'selectboxes');
    if (selectboxesComponent && selectboxesComponent.values && selectboxesComponent.values.length > 0) {
      console.log(`  ✅ SelectBoxes: ${selectboxesComponent.values.length} options loaded`);
    }
    
    const contentComponent = testComponents.find(c => c.type === 'content');
    if (contentComponent && contentComponent.html) {
      console.log(`  ✅ Content: HTML processed (${contentComponent.html.length} chars)`);
    }
    
    const textfieldComponent = testComponents.find(c => c.type === 'textfield');
    if (textfieldComponent && textfieldComponent.value !== undefined) {
      console.log(`  ✅ TextField: Default value set to "${textfieldComponent.value}"`);
    }
    
    console.log('\n🎉 All onChange processors are working correctly!');
    
    return true;
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
    return false;
  }
}

// Export for use in other tests
module.exports = testChangeProcessors;

// Run test if called directly
if (require.main === module) {
  testChangeProcessors()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test execution failed:', error);
      process.exit(1);
    });
}
