// process/processDataGridComponent.js

/**
 * Helper function to get nested data using dot notation
 * @param {Object} obj - The object to traverse
 * @param {String} path - Dot notation path (e.g., "mo_retur_receive.invoice_retur_to_invoice")
 * @returns {*} The value at the specified path or null if not found
 */
function getNestedData(obj, path) {
    if (!path || !obj) return null;
    
    console.log(`[onChange/datagrid] Searching for path: ${path} in:`, Object.keys(obj));
    
    const keys = path.split('.');
    let current = obj;
    
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        console.log(`[onChange/datagrid] Step ${i}: Looking for key "${key}" in:`, typeof current, Array.isArray(current) ? `Array(${current.length})` : Object.keys(current || {}));
        
        if (current && typeof current === 'object') {
            if (key in current) {
                current = current[key];
                console.log(`[onChange/datagrid] Step ${i}: Found "${key}", type:`, typeof current, Array.isArray(current) ? `Array(${current.length})` : '');
                
                // If we found an array and there are more keys, we need to navigate into the first element
                if (Array.isArray(current) && i < keys.length - 1) {
                    if (current.length > 0) {
                        console.log(`[onChange/datagrid] Step ${i}: Entering first element of array for further navigation`);
                        current = current[0];
                    } else {
                        console.log(`[onChange/datagrid] Step ${i}: Array is empty, cannot navigate further`);
                        return null;
                    }
                }
            } else {
                console.log(`[onChange/datagrid] Step ${i}: Key "${key}" not found`);
                return null;
            }
        } else {
            console.log(`[onChange/datagrid] Step ${i}: Current is not an object:`, current);
            return null;
        }
    }
    
    console.log(`[onChange/datagrid] Final result for path ${path}:`, typeof current, Array.isArray(current) ? `Array(${current.length})` : 'Object');
    return current;
}

/**
 * Process DataGrid Component for onChange - FULL FEATURED
 * Handles tabular data with complete sub-component processing like onRender
 * @param {Object} component - The datagrid component to process
 * @param {Array} queryData - SQL/Graph query results
 * @param {Object} formState - Current form state with API results
 */
function processDataGridComponent(component, queryData, formState) {
    try {
        console.log(`[onChange] Processing DataGrid component: ${component.key}`);
        
        const { components } = component;
        const newDefaultValue = [];

        // Validation: Ensure components array exists
        if (!components || !Array.isArray(components)) {
            console.warn(`[onChange/datagrid] Component ${component.key} has no sub-components, treating as simple table`);
            
            // Simple table processing without sub-components
            const { table, columns } = component;
            
            if (table && queryData) {
                queryData.forEach((queryItem) => {
                    if (queryItem.sqlQuery?.table === table) {
                        console.log(`[onChange/datagrid] Found SQL data for simple table: ${table}`);
                        
                        queryItem.sqlQuery.data.forEach((result) => {
                            const row = {};
                            
                            // Map data to columns if defined
                            if (columns && Array.isArray(columns)) {
                                columns.forEach(col => {
                                    if (col.key && result[col.key] !== undefined) {
                                        row[col.key] = result[col.key];
                                    }
                                });
                            } else {
                                // Use all available data
                                Object.assign(row, result);
                            }
                            
                            newDefaultValue.push(row);
                        });
                    }
                });
            }
            
            // Set processed data
            component.defaultValue = newDefaultValue;
            if (!component.data) {
                component.data = {};
            }
            component.data.rows = newDefaultValue;
            
            console.log(`[onChange] DataGrid component processed successfully: ${component.key} (${newDefaultValue.length} rows, simple mode)`);
            return;
        }

        // Validasi data API/GraphQL
        if (formState && formState.apiResults) {
            console.log("[onChange/datagrid] API Results available keys:", Object.keys(formState.apiResults));
        } else {
            console.warn("[onChange/datagrid] API Results belum tersedia!");
        }

        // Step 1: Process content components first, save HTML results by key
        const contentHTMLMap = {};
        components.forEach((subComponent) => {
            if (subComponent.type === 'content') {
                console.log(`[onChange/datagrid] Processing content component: ${subComponent.key}`);
                
                // Process content component (simplified version)
                if (subComponent.html || subComponent.htmlTemplate) {
                    let html = subComponent.html || subComponent.htmlTemplate || '';
                    
                    // Simple template processing for onChange
                    if (queryData && subComponent.table) {
                        queryData.forEach((queryItem) => {
                            if (queryItem.sqlQuery?.table === subComponent.table && queryItem.sqlQuery.data.length > 0) {
                                const firstRow = queryItem.sqlQuery.data[0];
                                // Replace template variables
                                Object.keys(firstRow).forEach(key => {
                                    const value = firstRow[key];
                                    html = html.replace(new RegExp(`{{${key}}}`, 'g'), value || '');
                                });
                            }
                        });
                    }
                    
                    contentHTMLMap[subComponent.key] = html;
                }
            }
        });

        // Step 2: Create table component mapping (supporting nested paths)
        const tableComponentMap = {};
        components.forEach((subComponent) => {
            if (subComponent.type === 'content') return; // Already processed
            const table = subComponent.table;
            if (!table) return;
            if (!tableComponentMap[table]) {
                tableComponentMap[table] = [];
            }
            tableComponentMap[table].push(subComponent);
        });

        console.log('[onChange/datagrid] Table component mapping:', Object.keys(tableComponentMap));

        // Step 3: Process data from query (SQL/Graph) - FULL NESTED SUPPORT
        if (queryData) {
            console.log("[onChange/datagrid] Query data structure:", queryData.map(item => ({
                type: item.sqlQuery ? 'SQL' : 'Graph',
                table: item.sqlQuery?.table || Object.keys(item.graph || {}),
                hasGraph: !!item.graph,
                graphKeys: item.graph ? Object.keys(item.graph) : []
            })));

            queryData.forEach((queryItem) => {
                Object.entries(tableComponentMap).forEach(([tablePath, tableComponents]) => {
                    console.log(`[onChange/datagrid] Processing table path: ${tablePath}`);

                    // Handle SQL data (direct table match only for SQL)
                    if (queryItem.sqlQuery?.table === tablePath) {
                        console.log(`[onChange/datagrid] Processing SQL data for table: ${tablePath}, rows: ${queryItem.sqlQuery.data.length}`);
                        queryItem.sqlQuery.data.forEach((item, index) => {
                            const row = {};
                            
                            // STEP 1: Save ALL fields from query data (dynamic)
                            Object.keys(item).forEach(key => {
                                row[key] = item[key];
                            });
                            
                            // STEP 2: Override with component-specific logic
                            components.forEach((sc) => {
                                if (sc.key === "image") {
                                    row[sc.key] = "unknown";
                                } else if (row[sc.key] === undefined) {
                                    row[sc.key] = undefined;
                                }
                            });
                            
                            // STEP 3: Add processed content HTML
                            Object.entries(contentHTMLMap).forEach(([key, html]) => {
                                row[key] = html;
                            });
                            
                            console.log(`[onChange/datagrid] SQL Row ${index}: ${item.product_name?.substring(0, 40)}..., fields saved:`, Object.keys(row).filter(k => k !== 'image_preview'));
                            newDefaultValue.push(row);
                        });
                    }

                    // Handle Graph data - ENHANCED nested path support
                    if (queryItem.graph) {
                        let processedData = false;
                        
                        // PRIORITIZE: Try nested path first (e.g., "mo_retur_receive.invoice_retur_to_invoice")
                        if (tablePath.includes('.')) {
                            const nestedData = getNestedData(queryItem.graph, tablePath);
                            if (nestedData && Array.isArray(nestedData)) {
                                console.log(`[onChange/datagrid] ✅ FOUND nested graph data for path: ${tablePath}, rows: ${nestedData.length}`);
                                processedData = true;
                                
                                nestedData.forEach((item, index) => {
                                    const row = {};
                                    
                                    // STEP 1: Save ALL fields from query data (dynamic)
                                    Object.keys(item).forEach(key => {
                                        row[key] = item[key];
                                    });
                                    
                                    // STEP 2: Override with component-specific logic
                                    components.forEach((sc) => {
                                        if (sc.key === "image") {
                                            row[sc.key] = "unknown";
                                        } else if (row[sc.key] === undefined) {
                                            row[sc.key] = undefined;
                                        }
                                    });
                                    
                                    // STEP 3: Add processed content HTML
                                    Object.entries(contentHTMLMap).forEach(([key, html]) => {
                                        row[key] = html;
                                    });
                                    
                                    console.log(`[onChange/datagrid] Nested Graph Row ${index}: ${item.product_name?.substring(0, 40)}..., fields saved:`, Object.keys(row).filter(k => k !== 'image_preview'));
                                    newDefaultValue.push(row);
                                });
                            } else if (nestedData && typeof nestedData === 'object') {
                                console.log(`[onChange/datagrid] ✅ FOUND nested graph object for path: ${tablePath}`);
                                processedData = true;
                                
                                const row = {};
                                
                                // STEP 1: Save ALL fields from query data (dynamic)
                                Object.keys(nestedData).forEach(key => {
                                    row[key] = nestedData[key];
                                });
                                
                                // STEP 2: Override with component-specific logic
                                components.forEach((sc) => {
                                    if (sc.key === "image") {
                                        row[sc.key] = "unknown";
                                    } else if (row[sc.key] === undefined) {
                                        row[sc.key] = undefined;
                                    }
                                });
                                
                                // STEP 3: Add processed content HTML
                                Object.entries(contentHTMLMap).forEach(([key, html]) => {
                                    row[key] = html;
                                });
                                
                                console.log(`[onChange/datagrid] Nested Graph Object: fields saved:`, Object.keys(row).filter(k => k !== 'image_preview'));
                                newDefaultValue.push(row);
                            }
                        }
                        
                        // FALLBACK: Try direct table match only if nested path didn't work
                        if (!processedData && queryItem.graph[tablePath]) {
                            console.log(`[onChange/datagrid] 📌 Using direct graph data for table: ${tablePath}, rows: ${queryItem.graph[tablePath].length}`);
                            queryItem.graph[tablePath].forEach((item, index) => {
                                const row = {};
                                
                                // STEP 1: Save ALL fields from query data (dynamic)
                                Object.keys(item).forEach(key => {
                                    row[key] = item[key];
                                });
                                
                                // STEP 2: Override with component-specific logic
                                components.forEach((sc) => {
                                    if (sc.key === "image") {
                                        row[sc.key] = "unknown";
                                    } else if (row[sc.key] === undefined) {
                                        row[sc.key] = undefined;
                                    }
                                });
                                
                                // STEP 3: Add processed content HTML
                                Object.entries(contentHTMLMap).forEach(([key, html]) => {
                                    row[key] = html;
                                });
                                
                                console.log(`[onChange/datagrid] Direct Graph Row ${index}: ${item.product_name?.substring(0, 40)}..., fields saved:`, Object.keys(row).filter(k => k !== 'image_preview'));
                                newDefaultValue.push(row);
                            });
                        }
                        
                        // Log if no data found
                        if (!processedData && !queryItem.graph[tablePath]) {
                            console.log(`[onChange/datagrid] ❌ No data found for path: ${tablePath}`);
                            console.log(`[onChange/datagrid] Available graph keys:`, Object.keys(queryItem.graph));
                        }
                    }
                });
            });
        }

        // Step 4: Process API data for sub-components (FULL API INTEGRATION)
        const apiComponentMap = {};
        components.forEach((sc) => {
            if (sc.type === 'content' || !sc.apiSource) return;
            const source = sc.apiSource.source;
            if (!apiComponentMap[source]) {
                apiComponentMap[source] = [];
            }
            apiComponentMap[source].push(sc);
        });

        // Process API data to update specific fields (like image)
        if (Object.keys(apiComponentMap).length > 0 && newDefaultValue.length > 0) {
            console.log(`[onChange/datagrid] Query rows: ${newDefaultValue.length}, API data available: ${Object.keys(formState.apiResults || {}).length}`);
            
            Object.entries(apiComponentMap).forEach(([source, apiComponents]) => {
                const apiItems = formState.apiResults?.[source];
                const dataPath = apiComponents[0]?.apiSource?.dataPath || [];
                let items = apiItems;

                // Traverse dataPath to get correct data array
                for (const path of dataPath) {
                    items = items?.[path] ?? null;
                }

                // Validate if API data is valid (array with elements)
                const isValidApiData = items && Array.isArray(items) && items.length > 0;
                console.log(`[onChange/datagrid] API source [${source}]: ${isValidApiData ? `Array(${items.length})` : 'Invalid/Empty'}`);
                
                if (isValidApiData) {
                    // Dynamic field mapping detection
                    let mappingField = null;
                    const firstRow = newDefaultValue[0];
                    const firstApiItem = items[0];
                    
                    if (firstRow && firstApiItem) {
                        // Try to find common ID field for mapping
                        const commonIdFields = Object.keys(firstRow).filter(field => 
                            firstApiItem.pk !== undefined && (
                                field.includes('pk') || field.includes('id') || 
                                field.includes('key') || field.includes('code')
                            )
                        );
                        
                        for (const field of commonIdFields) {
                            if (firstRow[field] !== undefined) {
                                mappingField = field;
                                console.log(`[onChange/datagrid] 🔄 Using mapping: ${field} -> API.pk`);
                                break;
                            }
                        }
                    }
                    
                    console.log(`[onChange/datagrid] Using dynamic mapping field: ${mappingField} -> API.pk`);
                    
                    // Create mapping based on dynamically detected field
                    const apiItemsByValue = {};
                    const apiItemsByRowIndex = {};
                    
                    items.forEach((apiItem, apiIndex) => {
                        // Primary mapping by detected field value
                        if (apiItem && apiItem.pk) {
                            apiItemsByValue[apiItem.pk] = apiItem;
                        }
                        
                        // Secondary mapping by datagrid row index
                        if (apiItem && apiItem._datagridRowIndex !== undefined) {
                            apiItemsByRowIndex[apiItem._datagridRowIndex] = apiItem;
                        }
                        
                        // Tertiary mapping by array index as fallback
                        if (!apiItemsByRowIndex[apiIndex]) {
                            apiItemsByRowIndex[apiIndex] = apiItem;
                        }
                    });
                    
                    console.log(`[onChange/datagrid] API mapping created:`, {
                        byValue: Object.keys(apiItemsByValue).length,
                        byRowIndex: Object.keys(apiItemsByRowIndex).length,
                        totalApiItems: items.length
                    });
                    
                    // Update rows with matching API data using dynamic mapping
                    newDefaultValue.forEach((row, rowIndex) => {
                        let apiItem = null;
                        let matchMethod = '';
                        
                        // Try to match by detected mapping field first
                        if (mappingField) {
                            const mappingValue = row[mappingField];
                            if (mappingValue && apiItemsByValue[mappingValue]) {
                                apiItem = apiItemsByValue[mappingValue];
                                matchMethod = `${mappingField}=${mappingValue}`;
                            }
                        }
                        
                        // Fallback to row index mapping
                        if (!apiItem && apiItemsByRowIndex[rowIndex] !== undefined) {
                            apiItem = apiItemsByRowIndex[rowIndex];
                            matchMethod = `rowIndex=${rowIndex}`;
                        }
                        
                        console.log(`[onChange/datagrid] Row ${rowIndex}: Product="${row.product_name?.substring(0, 30)}...", Match: ${matchMethod || 'NONE'}, API found: ${!!apiItem}`);
                        
                        apiComponents.forEach((sc) => {
                            const valKey = sc.apiSource.valueKey || sc.key;
                            const apiValue = apiItem?.[valKey];
                            
                            if (sc.key === "image") {
                                // Replace "unknown" only if valid API data exists
                                if (apiValue !== undefined && apiValue !== null && apiValue !== "") {
                                    console.log(`[onChange/datagrid] Row ${rowIndex}: Image updated from "unknown" to "${apiValue}" via ${matchMethod}`);
                                    row[sc.key] = apiValue;
                                } else {
                                    console.log(`[onChange/datagrid] Row ${rowIndex}: Image remains "unknown" (${matchMethod}, API value: ${apiValue})`);
                                }
                            } else {
                                // For other fields, update if valid data exists
                                if (apiValue !== undefined && apiValue !== null) {
                                    row[sc.key] = apiValue;
                                }
                            }
                        });
                    });
                }
            });
        }

        // Step 5: Handle existing defaultValue if no new data
        if (newDefaultValue.length === 0 && component.defaultValue && Array.isArray(component.defaultValue)) {
            console.log("[onChange/datagrid] Using existing defaultValue");
            
            component.defaultValue.forEach((row) => {
                const processedRow = {};
                components.forEach((sc) => {
                    if (sc.key === "image") {
                        // For image field, set "unknown" if empty/null/undefined
                        processedRow[sc.key] = (row[sc.key] && row[sc.key] !== "" && row[sc.key] !== null) ? row[sc.key] : "unknown";
                    } else {
                        // For other fields, use original value
                        processedRow[sc.key] = row[sc.key];
                    }
                });
                // Add content HTML
                Object.entries(contentHTMLMap).forEach(([key, html]) => {
                    processedRow[key] = html;
                });
                newDefaultValue.push(processedRow);
            });
        }

        // Step 6: Create empty row if still no data
        if (newDefaultValue.length === 0) {
            const emptyRow = {};
            components.forEach((sc) => {
                if (sc.key === "image") {
                    emptyRow[sc.key] = "unknown";
                } else {
                    emptyRow[sc.key] = undefined;
                }
            });
            // Add content HTML
            Object.entries(contentHTMLMap).forEach(([key, html]) => {
                emptyRow[key] = html;
            });
            newDefaultValue.push(emptyRow);
        }

        // Step 7: Final validation - ensure image fields have proper values
        newDefaultValue.forEach((row, rowIndex) => {
            components.forEach(sc => {
                if (sc.key === "image") {
                    if (!row[sc.key] || row[sc.key] === null || row[sc.key] === undefined || row[sc.key] === "") {
                        row[sc.key] = "unknown";
                    }
                }
            });
        });

        // Update component with processed data
        component.defaultValue = newDefaultValue;
        
        // Initialize data structure for compatibility
        if (!component.data) {
            component.data = {};
        }
        component.data.rows = newDefaultValue;

        // Apply pagination if configured
        if (component.pagination && component.pagination.enabled) {
            const pageSize = component.pagination.pageSize || 10;
            const currentPage = component.pagination.currentPage || 1;
            const startIndex = (currentPage - 1) * pageSize;
            const endIndex = startIndex + pageSize;
            
            component.data.totalRows = newDefaultValue.length;
            component.data.currentPage = currentPage;
            component.data.totalPages = Math.ceil(component.data.totalRows / pageSize);
            component.data.paginatedRows = newDefaultValue.slice(startIndex, endIndex);
        }

        // Debug logging for final results
        const imageFields = newDefaultValue.map((row, index) => ({
            rowIndex: index,
            image: row.image,
            hasValidImage: row.image && row.image !== "unknown" && row.image !== ""
        }));
        
        console.log(`[onChange/datagrid] Final result: ${newDefaultValue.length} rows processed`);
        console.log(`[onChange/datagrid] Image field status:`, imageFields);
        
        console.log(`[onChange] DataGrid component processed successfully: ${component.key} (${newDefaultValue.length} rows)`);
        
    } catch (error) {
        console.error(`[onChange] Error processing DataGrid component ${component.key}:`, error);
        
        // Fallback: ensure component has basic structure
        if (!component.data) {
            component.data = { rows: [] };
        }
        if (!component.defaultValue) {
            component.defaultValue = [];
        }
        
        throw new Error(`Failed to process DataGrid component ${component.key}: ${error.message}`);
    }
}

module.exports = processDataGridComponent;
