# Schema and Event Configuration Guide

This guide explains how to configure `schema.json` and `event.json` files to enable onChange functionality, specifically for triggering DataGrid re-renders when field values change.

## Overview

The onChange system uses two main configuration files:
- **schema.json**: Defines the form structure, components, and their properties
- **event.json**: Defines the change events, dependencies, and API configurations

## Schema Configuration (schema.json)

### Basic Structure

```json
{
  "title": "Form Title",
  "display": "form",
  "type": "form",
  "name": "formName",
  "path": "formPath",
  "components": [
    // Component definitions
  ]
}
```

### DataGrid Component Configuration

For a DataGrid that should refresh when another field changes:

```json
{
  "label": "Products",
  "key": "products",
  "type": "datagrid",
  "input": true,
  "api": {
    "enabled": true,
    "endpoint": "/api/products",
    "method": "GET",
    "params": {
      "invoice": "{{invoice}}"
    },
    "refreshTriggers": ["invoice"]
  },
  "components": [
    // Sub-components for each row
  ]
}
```

### Key Properties for onChange Integration

| Property | Description | Example |
|----------|-------------|---------|
| `key` | Unique identifier for the component | `"invoice"`, `"products"` |
| `type` | Component type | `"textfield"`, `"datagrid"`, `"select"` |
| `api.enabled` | Enable API integration | `true` |
| `api.endpoint` | API endpoint for data | `"/api/products"` |
| `api.params` | Parameters to send with API call | `{"invoice": "{{invoice}}"}` |
| `api.refreshTriggers` | Fields that trigger refresh | `["invoice"]` |

## Event Configuration (event.json)

### Basic Structure

```json
{
  "events": [
    // Event definitions
  ],
  "globalSettings": {
    // Global configuration
  },
  "apiConfig": {
    // API configuration
  }
}
```

### Change Event Configuration

To configure an event that triggers when the "invoice" field changes and refreshes the "products" DataGrid:

```json
{
  "eventKey": "invoice",
  "eventType": "change",
  "description": "Triggers when invoice field value changes",
  "refreshField": ["products"],
  "dependencies": {
    "products": {
      "type": "datagrid",
      "refreshOnChange": true,
      "apiRefresh": true,
      "clearOnChange": false,
      "reloadData": true
    }
  },
  "api": {
    "enabled": true,
    "endpoint": "/api/products",
    "method": "GET",
    "params": {
      "invoice": "{{invoice}}"
    }
  }
}
```

### Event Properties

| Property | Description | Required | Example |
|----------|-------------|----------|---------|
| `eventKey` | Field that triggers the event | Yes | `"invoice"` |
| `eventType` | Type of event | Yes | `"change"` |
| `refreshField` | Fields to refresh when event occurs | Yes | `["products"]` |
| `dependencies` | Configuration for dependent fields | No | See dependency config |
| `api` | API configuration for data fetching | No | See API config |

### Dependency Configuration

```json
"dependencies": {
  "products": {
    "type": "datagrid",
    "refreshOnChange": true,
    "apiRefresh": true,
    "clearOnChange": false,
    "reloadData": true
  }
}
```

| Property | Description | Default | Options |
|----------|-------------|---------|---------|
| `type` | Component type | - | `"datagrid"`, `"select"`, `"textfield"` |
| `refreshOnChange` | Whether to refresh when triggered | `false` | `true`, `false` |
| `apiRefresh` | Whether to make API call on refresh | `false` | `true`, `false` |
| `clearOnChange` | Whether to clear existing data | `false` | `true`, `false` |
| `reloadData` | Whether to reload all data | `false` | `true`, `false` |

## Complete Example: Invoice → Products DataGrid

### schema.json
```json
{
  "title": "Order Form",
  "components": [
    {
      "label": "Invoice Number",
      "key": "invoice",
      "type": "textfield",
      "validate": {
        "required": true
      }
    },
    {
      "label": "Products",
      "key": "products",
      "type": "datagrid",
      "api": {
        "enabled": true,
        "endpoint": "/api/products",
        "params": {
          "invoice": "{{invoice}}"
        },
        "refreshTriggers": ["invoice"]
      },
      "components": [
        {
          "label": "Product Name",
          "key": "product_name",
          "type": "textfield"
        },
        {
          "label": "Quantity",
          "key": "quantity",
          "type": "number"
        }
      ]
    }
  ]
}
```

### event.json
```json
{
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
        "params": {
          "invoice": "{{invoice}}"
        }
      }
    }
  ]
}
```

## Database Integration

In your system, these configurations are stored in the database table `db_conf_task_form`:

```sql
INSERT INTO db_conf_task_form (
  task_def_key,
  schema_json,
  event_json
) VALUES (
  'your_process_key',
  '{"title": "Order Form", "components": [...]}',
  '{"events": [{"eventKey": "invoice", ...}]}'
);
```

## API Endpoint Requirements

When configuring API endpoints for DataGrid refresh, ensure your endpoints:

1. Accept the triggering field as a parameter
2. Return data in the expected format
3. Handle authentication if required
4. Return appropriate error responses

Example API response for products:
```json
{
  "success": true,
  "data": [
    {
      "product_id": "PROD001",
      "product_name": "Widget A",
      "quantity": 2,
      "price": 10.00
    }
  ]
}
```

## Troubleshooting

### Common Issues

1. **DataGrid not refreshing**: Check that `eventKey` matches the triggering field's `key`
2. **API not called**: Ensure `api.enabled` is `true` and endpoint is correct
3. **Data not displayed**: Verify API response format matches DataGrid component structure
4. **Performance issues**: Consider adding `debounceDelay` in global settings

### Debug Tips

1. Check browser console for onChange logs
2. Verify API calls in Network tab
3. Ensure database contains correct JSON configurations
4. Test with simple configurations first

## Advanced Features

### Multiple Refresh Triggers
```json
"refreshField": ["products", "summary", "totals"]
```

### Conditional Refresh
```json
"dependencies": {
  "products": {
    "type": "datagrid",
    "refreshOnChange": true,
    "condition": "{{invoice}} && {{invoice}}.length > 3"
  }
}
```

### Custom API Headers
```json
"api": {
  "headers": {
    "Authorization": "Bearer {{session.token}}",
    "X-Custom-Header": "{{custom_value}}"
  }
}
```

This configuration system provides flexible, maintainable onChange functionality that matches the feature parity and modularity of the onRender system.
