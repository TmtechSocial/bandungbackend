# onChange - Enhanced Dynamic Form Change Handler

## 📁 Structure Overview

```
src/utils/onChange/
├── index.js                       # Main entry point & exports
├── handleChange.js                # Enhanced main handler (refactored)
├── createChangeFormState.js       # Form state management
├── api/
│   └── loadChangeApiData.js       # API data loading for changes
├── event/
│   └── setupChangeHandlers.js    # Event handling & dependencies
├── process/
│   ├── processComponents.js       # Main component processor (onChange-optimized)
│   ├── processSelectComponent.js  # Select component processor
│   ├── processDataGridComponent.js # DataGrid component processor  
│   ├── processEditGridComponent.js # EditGrid component processor
│   ├── processSelectBoxesComponent.js # SelectBoxes component processor
│   ├── processContentComponent.js # Content component processor
│   └── processDefaultComponent.js # Default component processor
└── utils/
    ├── changeValidator.js         # Validation utilities
    └── changeQueryProcessor.js    # Query processing utilities
```

## 🚀 Key Features

### ✅ **Modular Component Processing**
- **Separated by Component Type**: Each component type has its own processor
- **onChange-Optimized**: Focused on partial updates and change events
- **Performance Monitoring**: Enhanced logging and timing for each processor
- **Error Handling**: Component-specific error handling and recovery

### ✅ **Full onRender Compatibility** 
- All onRender capabilities now available in onChange
- Parallel processing and performance monitoring
- Comprehensive error handling
- Complete component type support

### 🔧 **Enhanced Functionality**
- **API Management**: Dedicated API loading for changed components
- **Event Handling**: Sophisticated change event processing  
- **Component Processing**: Modular, type-specific component processors
- **Validation**: Comprehensive validation at every step
- **Form State**: Advanced form state management

### 📊 **Performance Optimizations**
- Component categorization (sync, parallel, sequential)
- Parallel processing for independent components
- Smart caching and state management  
- Detailed performance monitoring and logging
- Component-specific optimizations

## 📖 Usage

### Basic Usage
```javascript
const dynamicChange = require('../utils/onChange');

// Enhanced onChange with modular component processing
const result = await dynamicChange(fastify, process, event, instance, session);
```

### Advanced Usage
```javascript
const onChange = require('../utils/onChange');

// Use specific utilities
const { validator, queryProcessor, formState } = onChange.utils;

// Validate event data
const validation = validator.validateEvent(eventData);

// Process query data with change context
const processedData = queryProcessor.processChangeQueryData(queryData, eventData);

// Create optimized form state
const formState = formState.createChangeFormState(schema, session, eventData);
```

## 🔄 Migration Guide

### From Old handleChange.js
```javascript
// OLD
const dynamicChange = require("../utils/onChange/handleChange");

// NEW 
const dynamicChange = require("../utils/onChange");
// or
const dynamicChange = require("../utils/onChange/index");
```

### Backward Compatibility
The old API is still supported:
```javascript
// Legacy mode (automatically detected)
const result = await dynamicChange(fastify, process, event);

// Enhanced mode (full parameters)
const result = await dynamicChange(fastify, process, event, instance, session);
```

## 📋 API Reference

### Main Function
```javascript
dynamicChange(fastify, process, event, instance?, session?)
```

**Parameters:**
- `fastify`: Fastify instance
- `process`: Process name
- `event`: Change event data `{ fieldName: newValue }`
- `instance`: Process instance (optional)
- `session`: User session (optional)

**Returns:**
```javascript
{
  data: Array<ProcessedComponent>,
  stats: {
    totalTime: Number,
    processedCount: Number,
    apiCalls: Number,
    eventKey: String,
    eventValue: Any,
    refreshComponentKeys: Array<String>
  }
}
```

### Utility Modules

#### API Module
- `loadChangeApiData(apiConfigs, refreshComponents, eventData, formState, session)`
- `makeChangeApiCall(apiDetails, eventData, formState, session, sourceName)`

#### Event Module  
- `setupChangeHandlers(schema, formState, apiConfigs, eventData)`
- `getRefreshComponents(schema, eventData)`
- `validateChangeEvent(eventData)`

#### Process Module
- `processChangeComponents(components, queryData, formState, session, apiConfigs, memberResult, eventData)`
- `categorizeChangeComponents(components, eventData)`
- `updateChangeComponent(component, newData)`

#### Validation Module
- `validateEvent(eventData)`
- `validateChangeSchema(schema)`  
- `validateApiConfigs(apiConfigs)`

#### Query Processor Module
- `processChangeQueryData(data, eventData)`
- `updateQueryVariables(queryData, eventData)`
- `validateQueryDataForChange(queryData, eventData)`

#### Form State Module
- `createChangeFormState(schema, session, eventData)`
- `updateFormStateValues(formState, newValues)`
- `setComponentLoading(formState, componentKey, isLoading)`

## 🔧 Component Processors

### Available Processors

#### **processSelectComponent.js**
- Handles `select` type components
- Processes SQL/Graph/API data sources
- Supports nested data paths
- Optimized for dropdown options

#### **processDataGridComponent.js** 
- Handles `datagrid` type components
- Manages tabular data display
- Supports pagination and filtering
- Optimized for large datasets

#### **processEditGridComponent.js**
- Handles `editgrid` type components  
- Manages editable grid structures
- Supports inline editing
- Optimized for form arrays

#### **processSelectBoxesComponent.js**
- Handles `selectboxes` type components
- Manages checkbox/radio groups
- Supports member-based filtering
- Optimized for multi-selection

#### **processContentComponent.js**
- Handles `content` type components
- Processes HTML content with templates
- Supports dynamic content injection
- Optimized for display content

#### **processDefaultComponent.js**
- Handles all other component types
- Supports textfield, textarea, checkbox, radio, button, etc.
- Basic validation and state management
- Fallback for unknown types

### Processing Strategy

Components are categorized into three groups for optimal performance:

1. **Fast Sync Components** (0ms async overhead)
   - textfield, email, password, number, textarea
   - checkbox, radio, button, hidden, htmlelement

2. **Parallel Components** (can run simultaneously)  
   - content (HTML processing)

3. **Sequential Components** (API/data dependencies)
   - select, datagrid, editgrid, selectboxes

## 🔍 Debugging

### Enable Debug Logging
All modules use consistent logging with `[onChange/module]` prefixes:

```javascript
// Look for these log patterns:
[onChange] === Enhanced dynamicChange started ===
[onChange/api] Loading API data for 3 components
[onChange/event] Found 2 components to refresh for product_name
[onChange/process] Processing 2 changed components
[onChange/utils] Added change context to 1 query items
```

### Performance Monitoring
```javascript
// Automatic performance tracking
[onChange] Slow call: 5234ms { process: 'order_management', eventKey: 'product_name' }
[onChange] === Enhanced dynamicChange completed in 1234ms ===
```

## 🆕 What's New

### v2.0.0 Features
1. **Modular Architecture**: Clean separation of concerns
2. **Enhanced API Handling**: Dedicated API management
3. **Better Error Handling**: Comprehensive error tracking
4. **Performance Optimization**: Smart component categorization
5. **Validation Layer**: Multi-level validation
6. **Form State Management**: Advanced state tracking
7. **Legacy Support**: Backward compatibility maintained

### Breaking Changes
- None! Old API still works
- New structure provides better maintainability
- Enhanced functionality available through new parameters

## 🧪 Testing

### Test Event Data
```javascript
// Valid event data
const validEvent = { product_name: "Product A" };

// Test API response
const result = await dynamicChange(fastify, "test_process", validEvent);
console.log(`Updated ${result.data.length} components in ${result.stats.totalTime}ms`);
```

## 📞 Support

For issues or questions:
1. Check the debug logs with `[onChange]` prefix
2. Validate your event data structure
3. Ensure API configurations are correct
4. Review component onChange configurations

## 🔮 Future Enhancements

- [ ] Real-time WebSocket updates
- [ ] Advanced caching strategies  
- [ ] Component dependency graph visualization
- [ ] Performance analytics dashboard
- [ ] Auto-generated API documentation
