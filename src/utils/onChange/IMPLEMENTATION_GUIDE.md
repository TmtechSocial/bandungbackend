# Implementation Guide: Invoice → Products DataGrid onChange

This guide shows you exactly how to implement the onChange functionality so that when the "invoice" field changes, the "products" DataGrid automatically refreshes with new data.

## Changes Required

### 1. Schema.json Changes (FINAL_SCHEMA.json)

**Key Changes Made:**

1. **Added onChange to Invoice Field:**
```json
{
  "key": "invoice",
  // ... existing properties ...
  "onChange": {
    "refreshField": "products"
  }
}
```

2. **Added apiSource to Products DataGrid:**
```json
{
  "key": "products",
  "type": "datagrid",
  // ... existing properties ...
  "apiSource": {
    "source": "productsFromInvoice",
    "dependsOn": "invoice"
  }
}
```

### 2. Event.json Changes (FINAL_EVENT.json)

**Key Changes Made:**

1. **Added new API source for products:**
```json
{
  "onRender": {
    "api": {
      // ... existing API sources ...
      "productsFromInvoice": {
        "url": "http://localhost:9000/v1/graphql",
        "method": "POST",
        "headers": {
          "Content-Type": "application/json"
        },
        "params": {
          "invoice": "${invoice}"
        },
        "gqlQuery": "query GetProductsByInvoice($invoice: String!) { mo_retur_receive(where: {invoice: {_eq: $invoice}}) { invoice_retur_to_invoice { sku_toko product_name part_pk quantity_convert } } }",
        "variables": {
          "invoice": "${invoice}"
        }
      }
    }
  }
}
```

## Database Implementation

### Option 1: Update Existing Record
```sql
UPDATE db_conf_task_form 
SET 
  schema_json = '{
    "display": "form",
    "components": [
      -- Use the complete schema from FINAL_SCHEMA.json
    ]
  }',
  event_json = '{
    "onRender": {
      -- Use the complete event config from FINAL_EVENT.json
    }
  }'
WHERE task_def_key = 'your_task_key_here';
```

### Option 2: Insert New Record
```sql
INSERT INTO db_conf_task_form (
  task_def_key,
  schema_json,
  event_json
) VALUES (
  'mo_retur_receive_task',
  -- Complete schema JSON from FINAL_SCHEMA.json
  '{"display":"form","components":[...]}',
  -- Complete event JSON from FINAL_EVENT.json  
  '{"onRender":{"api":{...}}}'
);
```

## How It Works

### 1. User Types in Invoice Field
- User enters or changes value in the "invoice" textfield
- onChange system detects the change due to `onChange.refreshField` configuration

### 2. Backend Processing
- `handleChange.js` processes the change event
- Finds the "products" component that needs refreshing
- Locates the "productsFromInvoice" API source in event.json

### 3. API Call Made
- System makes GraphQL call to: `http://localhost:9000/v1/graphql`
- Uses query: `query GetProductsByInvoice($invoice: String!) { mo_retur_receive(where: {invoice: {_eq: $invoice}}) { invoice_retur_to_invoice { sku_toko product_name part_pk quantity_convert } } }`
- Passes the invoice value as a parameter

### 4. DataGrid Updated
- API response is processed by `processDataGridComponent.js`
- Products DataGrid is updated with new data
- User sees the refreshed product list

## Testing the Implementation

### 1. Backend Test
Run the configuration test to verify setup:
```bash
cd "c:\mirorim\bandung\bandungbackend"
node "src\utils\onChange\test\testConfigurationStructure.js"
```

### 2. Frontend Integration
- Deploy the updated schema.json and event.json to your database
- Load the form in your frontend application
- Type an invoice number and verify the products DataGrid refreshes

### 3. Debug Tips

**If products don't refresh:**
1. Check browser console for onChange logs
2. Verify the invoice field has `onChange.refreshField = "products"`
3. Check that API source "productsFromInvoice" exists in event.json
4. Ensure the GraphQL endpoint is accessible

**Common Issues:**
- **API 404**: Check the GraphQL endpoint URL
- **No data returned**: Verify the invoice value exists in database
- **DataGrid empty**: Check the GraphQL query structure
- **Network errors**: Verify CORS and authentication

## Performance Optimization

### 1. Add Debouncing (Optional)
Add to invoice field in schema.json:
```json
{
  "key": "invoice",
  "onChange": {
    "refreshField": "products",
    "debounceDelay": 500
  }
}
```

### 2. Add Caching (Optional)
Add to API source in event.json:
```json
{
  "productsFromInvoice": {
    // ... existing config ...
    "cache": {
      "enabled": true,
      "ttl": 300000
    }
  }
}
```

### 3. Loading States (Optional)
Add to products DataGrid in schema.json:
```json
{
  "key": "products",
  "type": "datagrid",
  "loadingMessage": "Loading products...",
  "showLoadingIndicator": true
}
```

## Advanced Customization

### 1. Multiple Refresh Fields
To refresh multiple components when invoice changes:
```json
{
  "key": "invoice",
  "onChange": {
    "refreshField": ["products", "summary", "totals"]
  }
}
```

### 2. Conditional Refresh
To only refresh when invoice has minimum length:
```json
{
  "productsFromInvoice": {
    // ... existing config ...
    "condition": "${invoice} && ${invoice}.length >= 3"
  }
}
```

### 3. Error Handling
Add error handling to API source:
```json
{
  "productsFromInvoice": {
    // ... existing config ...
    "errorHandling": {
      "retryCount": 3,
      "fallbackMessage": "Unable to load products for this invoice",
      "logErrors": true
    }
  }
}
```

## Summary

With these changes:
1. ✅ Invoice field will trigger products DataGrid refresh
2. ✅ Backend onChange system will handle the event
3. ✅ API call will fetch products for the specific invoice
4. ✅ DataGrid will update with new product data
5. ✅ System maintains full feature parity with onRender

The implementation leverages the modular onChange system you've built, ensuring maintainability and performance while providing the exact functionality requested.
