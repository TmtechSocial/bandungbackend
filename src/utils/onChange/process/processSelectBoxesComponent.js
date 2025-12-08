// process/processSelectBoxesComponent.js

/**
 * Process SelectBoxes Component for onChange
 * Handles checkbox/radio group components with API integration
 * @param {Object} component - The selectboxes component to process
 * @param {Object} formState - Current form state
 * @param {Object} apiConfigs - API configurations
 * @param {Object} memberResult - Member/session result data
 * @param {Array} queryData - SQL/Graph query results
 */
function processSelectBoxesComponent(component, formState, apiConfigs, memberResult, queryData) {
    try {
        console.log(`[onChange] Processing SelectBoxes component: ${component.key}`);
        
        // Initialize values structure if needed
        if (!component.values) {
            component.values = [];
        }

        // Process API data if available
        if (component.apiSource && formState && formState.apiResults) {
            const apiSourceName = component.apiSource.source;
            const apiData = formState.apiResults[apiSourceName];
            
            if (apiData && Array.isArray(apiData)) {
                console.log(`[onChange] Processing API data for SelectBoxes: ${component.key}`);
                
                // Clear existing values before adding new ones
                component.values = [];
                
                apiData.forEach((item, index) => {
                    const value = {
                        label: item[component.labelProperty || 'name'] || item.label || `Option ${index + 1}`,
                        value: item[component.valueProperty || 'id'] || item.value || `option_${index}`,
                        shortcut: item.shortcut || ''
                    };
                    
                    // Add additional properties if they exist
                    if (item.description) value.description = item.description;
                    if (item.disabled !== undefined) value.disabled = item.disabled;
                    if (item.checked !== undefined) value.checked = item.checked;
                    
                    component.values.push(value);
                });
            }
        }

        // Process SQL/Graph data if table is specified
        if (component.table && queryData) {
            console.log(`[onChange] Processing query data for SelectBoxes table: ${component.table}`);
            
            queryData.forEach((queryItem) => {
                if (queryItem.sqlQuery?.table === component.table) {
                    console.log(`[onChange] Found SQL data for SelectBoxes table: ${component.table}`);
                    
                    // Clear existing values before adding new ones
                    component.values = [];
                    
                    queryItem.sqlQuery.data.forEach((result, index) => {
                        const value = {
                            label: result[component.labelProperty || 'name'] || result.label || `Option ${index + 1}`,
                            value: result[component.valueProperty || 'id'] || result.value || `option_${index}`,
                            shortcut: result.shortcut || ''
                        };
                        
                        // Add additional properties if they exist
                        if (result.description) value.description = result.description;
                        if (result.disabled !== undefined) value.disabled = result.disabled;
                        if (result.checked !== undefined) value.checked = result.checked;
                        
                        component.values.push(value);
                    });
                }
            });
        }

        // Apply member-specific filtering if memberResult is available
        if (memberResult && component.memberFilter) {
            console.log(`[onChange] Applying member filter for SelectBoxes: ${component.key}`);
            
            const userRole = memberResult.role || 'default';
            const userPermissions = memberResult.permissions || [];
            
            // Filter values based on member permissions
            component.values = component.values.filter(value => {
                if (value.requiredRole && !userPermissions.includes(value.requiredRole)) {
                    return false;
                }
                
                if (value.minRole && userRole !== 'admin' && value.minRole === 'admin') {
                    return false;
                }
                
                return true;
            });
        }

        // Set default selections if specified
        if (component.defaultValue && Array.isArray(component.defaultValue)) {
            console.log(`[onChange] Setting default selections for SelectBoxes: ${component.key}`);
            
            component.values.forEach(value => {
                if (component.defaultValue.includes(value.value)) {
                    value.checked = true;
                }
            });
        }

        // Apply sorting if specified
        if (component.sort && component.values.length > 1) {
            console.log(`[onChange] Sorting SelectBoxes values: ${component.key}`);
            
            component.values.sort((a, b) => {
                const aLabel = (a.label || '').toString();
                const bLabel = (b.label || '').toString();
                return aLabel.localeCompare(bLabel);
            });
        }

        // Validate component state
        if (!Array.isArray(component.values)) {
            console.warn(`[onChange] Invalid values structure for SelectBoxes: ${component.key}`);
            component.values = [];
        }

        console.log(`[onChange] SelectBoxes component processed successfully: ${component.key} (${component.values.length} options)`);
        
    } catch (error) {
        console.error(`[onChange] Error processing SelectBoxes component ${component.key}:`, error);
        
        // Fallback: ensure component has basic structure
        if (!component.values) {
            component.values = [];
        }
        
        throw new Error(`Failed to process SelectBoxes component ${component.key}: ${error.message}`);
    }
}

module.exports = processSelectBoxesComponent;
