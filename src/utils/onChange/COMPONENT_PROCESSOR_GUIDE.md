# onChange Component Processor Guide

## 🎯 Quick Start Guide

### How to Use onChange Processors

```javascript
// Import onChange handler
const dynamicChange = require('../utils/onChange');

// Handle form change event
const result = await dynamicChange(fastify, processName, changeEvent, instance, session);

// Example change event
const changeEvent = {
  product_category: 5  // Field changed to new value
};

// Result contains updated components
console.log(result.data);        // Updated components
console.log(result.stats);       // Performance statistics
```

## 🔧 Component Type Support

### 1. Select Components
```javascript
{
  type: "select",
  key: "product_category",
  table: "categories",           // SQL source
  labelProperty: "name",
  valueProperty: "id",
  onChange: {
    refreshField: ["products", "subcategories"]
  }
}
```

### 2. DataGrid Components
```javascript
{
  type: "datagrid",
  key: "order_items", 
  table: "order_details",
  columns: [
    { key: "product_name", label: "Product" },
    { key: "quantity", label: "Qty" },
    { key: "price", label: "Price" }
  ],
  pagination: {
    enabled: true,
    pageSize: 10
  }
}
```

### 3. SelectBoxes Components
```javascript
{
  type: "selectboxes",
  key: "permissions",
  apiSource: { source: "permissionsAPI" },
  memberFilter: true,           // Apply user role filtering
  values: [],                   // Will be populated by processor
  onChange: {
    refreshField: "user_access_level"
  }
}
```

### 4. Content Components
```javascript
{
  type: "content",
  key: "dynamic_info",
  htmlTemplate: "<div class='info'>{{product_name}} - {{price}}</div>",
  table: "products",           // Data source for templating
  onChange: {
    refreshField: "product_details"
  }
}
```

## 📊 Performance Features

### Three-Tier Processing Strategy

#### 1. **Fast Sync Components** (0ms overhead)
- textfield, email, password, number
- textarea, checkbox, radio, button
- hidden, htmlelement

#### 2. **Parallel Components** (concurrent processing)
- content (HTML template processing)

#### 3. **Sequential Components** (data-dependent)
- select, datagrid, editgrid, selectboxes

## 🔍 Debugging & Monitoring

### Enable Debug Logging
```javascript
// Set environment variable for detailed logging
process.env.ONCHANGE_DEBUG = 'true';

// Or check console output for:
// [onChange] Processing <ComponentType> component: <key>
// [onChange] Component processed successfully: <key> (<data_count> items)
```

### Performance Monitoring
```javascript
const result = await dynamicChange(fastify, process, event, instance, session);

console.log('Performance Stats:', {
  totalTime: result.stats.duration,
  componentsUpdated: result.stats.componentCount,
  success: result.stats.eventProcessed
});
```

## 🛠️ Custom Component Processing

### Adding New Component Types

1. **Create Processor File**
```javascript
// process/processCustomComponent.js
function processCustomComponent(component, queryData, formState, apiConfigs, session) {
  // Your custom processing logic
  console.log(`[onChange] Processing Custom component: ${component.key}`);
  
  // Process component data
  // ...
  
  console.log(`[onChange] Custom component processed successfully: ${component.key}`);
}

module.exports = processCustomComponent;
```

2. **Register in Main Processor**
```javascript
// process/processComponents.js
const processCustomComponent = require("./processCustomComponent");

const componentProcessors = {
  // ...existing processors...
  custom: processCustomComponent,
};
```

## ⚡ Performance Tips

### 1. **Optimize Component Design**
```javascript
// ✅ Good: Specific refresh targets
{
  onChange: {
    refreshField: ["specific_field1", "specific_field2"]
  }
}

// ❌ Avoid: Too many refresh targets
{
  onChange: {
    refreshField: ["field1", "field2", "field3", "field4", "field5"]
  }
}
```

### 2. **Use Appropriate Data Sources**
```javascript
// ✅ For simple dropdowns: SQL table
{
  table: "categories",
  labelProperty: "name",
  valueProperty: "id"
}

// ✅ For complex data: API source
{
  apiSource: { source: "complexDataAPI" }
}
```

### 3. **Minimize API Calls**
```javascript
// ✅ Cache API results when possible
{
  apiSource: { 
    source: "productsAPI",
    cacheTimeout: 300000  // 5 minutes
  }
}
```

## 🔧 Troubleshooting

### Common Issues

#### Issue: Component not updating
```javascript
// Check if onChange is properly configured
{
  key: "trigger_field",
  onChange: {
    refreshField: "target_field"  // ✅ Correct
  }
}
```

#### Issue: API data not loading
```javascript
// Verify API source configuration
{
  apiSource: { 
    source: "validAPISourceName"  // Must match event.json api config
  }
}
```

#### Issue: Performance problems
```javascript
// Check component categorization in logs:
// [onChange] Component distribution - Fast: X, Parallel: Y, Sequential: Z

// Optimize by reducing sequential components
```

## 📋 Testing Your Components

### Use Built-in Test
```bash
# Run processor test
cd src/utils/onChange
node test/testChangeProcessors.js
```

### Create Custom Tests
```javascript
const processComponents = require('./process/processComponents');

// Test your component
const testComponent = {
  key: 'my_component',
  type: 'select',
  table: 'my_table'
};

const result = await processComponents([testComponent], queryData, formState, session, apiConfigs, memberResult);
console.log('Test result:', result);
```

---

**🎉 Now you're ready to build amazing dynamic forms with onChange!**
