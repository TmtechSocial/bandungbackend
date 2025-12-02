// process/processSelectComponent.js

/**
 * Helper function to get nested data using dot notation
 * @param {Object} obj - The object to traverse
 * @param {String} path - Dot notation path (e.g., "mo_retur_receive.invoice_retur_to_invoice")
 * @returns {*} The value at the specified path or null if not found
 */
function getNestedData(obj, path) {
    if (!path || !obj) return null;
    
    const keys = path.split('.');
    let current = obj;
    
    for (const key of keys) {
        if (current && typeof current === 'object' && key in current) {
            current = current[key];
        } else {
            return null;
        }
    }
    
    return current;
}

/**
 * Process Select Component for onChange
 * Optimized for dropdown components with API integration
 * @param {Object} component - The select component to process
 * @param {Array} queryData - SQL/Graph query results
 * @param {Object} formState - Current form state
 * @param {Object} apiConfigs - API configurations
 */
function processSelectComponent(component, queryData, formState, apiConfigs) {
    try {
        console.log(`[onChange] Processing Select component: ${component.key}`);
        
        const { table, key, defaultValue } = component;
        
        // Initialize data structure if needed
        if (!component.data) {
            component.data = { values: [] };
        } else if (table || component.apiSource) {
            // Only clear if will be refilled from SQL/Graph/API
            component.data.values = [];
        }

        // Process data from SQL/Graph sources (supporting nested paths)
        if (table && queryData) {
            queryData.forEach((queryItem) => {
                // Handle SQL data (direct table match)
                if (queryItem.sqlQuery?.table === table) {
                    console.log(`[onChange] Found SQL data for table: ${table}`);
                    
                    queryItem.sqlQuery.data.forEach((result) => {
                        component.data.values.push({
                            label: result[component.labelProperty || 'name'] || result.label || 'No Label',
                            value: result[component.valueProperty || 'id'] || result.value
                        });
                    });
                }

                // Handle Graph data (nested object access)
                if (queryItem.graphQuery?.variables && table.includes('.')) {
                    console.log(`[onChange] Processing nested Graph data for: ${table}`);
                    
                    const nestedData = getNestedData(queryItem.graphQuery.variables, table);
                    
                    if (nestedData && Array.isArray(nestedData)) {
                        nestedData.forEach((result) => {
                            component.data.values.push({
                                label: result[component.labelProperty || 'name'] || result.label || 'No Label',
                                value: result[component.valueProperty || 'id'] || result.value
                            });
                        });
                    }
                }
            });
        }

        // Process API data if available in formState
        if (component.apiSource && formState && formState.apiResults) {
            const apiSourceName = component.apiSource.source;
            const apiData = formState.apiResults[apiSourceName];
            
            if (apiData && Array.isArray(apiData)) {
                console.log(`[onChange] Processing API data for Select: ${component.key}`);
                
                apiData.forEach((result) => {
                    component.data.values.push({
                        label: result[component.labelProperty || 'name'] || result.label || 'No Label',
                        value: result[component.valueProperty || 'id'] || result.value
                    });
                });
            }
        }

        // Set default value if specified and no data exists
        if (defaultValue !== undefined && (!component.data.values || component.data.values.length === 0)) {
            console.log(`[onChange] Setting default value for Select: ${defaultValue}`);
            
            if (typeof defaultValue === 'object' && defaultValue.label && defaultValue.value) {
                component.data.values.push(defaultValue);
            } else {
                component.data.values.push({
                    label: defaultValue.toString(),
                    value: defaultValue
                });
            }
        }

        // Remove duplicates based on value
        if (component.data.values && component.data.values.length > 1) {
            const uniqueValues = [];
            const seenValues = new Set();
            
            component.data.values.forEach(item => {
                if (!seenValues.has(item.value)) {
                    seenValues.add(item.value);
                    uniqueValues.push(item);
                }
            });
            
            component.data.values = uniqueValues;
        }

        // Sort values if needed
        if (component.sort && component.data.values.length > 1) {
            component.data.values.sort((a, b) => {
                const aLabel = (a.label || '').toString();
                const bLabel = (b.label || '').toString();
                return aLabel.localeCompare(bLabel);
            });
        }

        console.log(`[onChange] Select component processed successfully: ${component.key} (${component.data.values.length} options)`);
        
    } catch (error) {
        console.error(`[onChange] Error processing Select component ${component.key}:`, error);
        
        // Fallback: ensure component has basic structure
        if (!component.data) {
            component.data = { values: [] };
        }
        
        throw new Error(`Failed to process Select component ${component.key}: ${error.message}`);
    }
}

module.exports = processSelectComponent;
