const processContentComponent = require('./content');

/**
 * Enhanced helper function to get nested data using dot notation with unlimited depth support
 */
function getNestedData(obj, path) {
    if (!path || !obj) return null;
    
    console.log(`[getNestedData] Searching for path: ${path} in:`, Object.keys(obj));
    
    const keys = path.split('.');
    let current = obj;
    let navigationHistory = [];
    
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        navigationHistory.push({
            step: i,
            key: key,
            currentType: typeof current,
            isArray: Array.isArray(current),
            availableKeys: current && typeof current === 'object' ? Object.keys(current) : []
        });
        
        console.log(`[getNestedData] Step ${i}: Looking for key "${key}" in:`, 
            typeof current, 
            Array.isArray(current) ? `Array(${current.length})` : Object.keys(current || {}));
        
        if (current && typeof current === 'object') {
            if (key in current) {
                current = current[key];
                console.log(`[getNestedData] Step ${i}: Found "${key}", type:`, 
                    typeof current, 
                    Array.isArray(current) ? `Array(${current.length})` : '');
                
                if (Array.isArray(current) && i < keys.length - 1) {
                    if (current.length > 0) {
                        console.log(`[getNestedData] Step ${i}: Entering first element of array for further navigation`);
                        current = current[0];
                        
                        if (!current || typeof current !== 'object') {
                            console.log(`[getNestedData] Step ${i}: Array element is not navigable:`, typeof current);
                            return null;
                        }
                    } else {
                        console.log(`[getNestedData] Step ${i}: Array is empty, cannot navigate further`);
                        return null;
                    }
                }
            } else {
                console.log(`[getNestedData] Step ${i}: Key "${key}" not found`);
                return null;
            }
        } else {
            console.log(`[getNestedData] Step ${i}: Current is not an object:`, current);
            return null;
        }
    }
    
    console.log(`[getNestedData] SUCCESS - Final result for path ${path}:`, 
        typeof current, 
        Array.isArray(current) ? `Array(${current.length})` : 'Object');
    return current;
}

/**
 * Helper function to get the last part of a nested path
 */
function getTableName(tablePath) {
    if (!tablePath) return tablePath;
    const parts = tablePath.split('.');
    return parts[parts.length - 1];
}

/**
 * NEW: Process nested datagrid recursively - THIS IS THE ONLY NEW FUNCTION
 */
function processNestedDataGrid(nestedComponent, parentRow, queryData, formState, contentHTMLMap) {
    console.log(`[processNestedDataGrid] ========== Processing nested datagrid: ${nestedComponent.key} ==========`);
    console.log(`[processNestedDataGrid] Parent row keys:`, Object.keys(parentRow));
    
    const nestedDefaultValue = [];
    const nestedComponents = nestedComponent.components || [];
    
    // Check if nested datagrid has table-based components
    const nestedTableComponents = nestedComponents.filter(sc => 
        sc.table && 
        sc.type !== 'content' && 
        ['textfield', 'textarea', 'number', 'radio'].includes(sc.type)
    );
    
    console.log(`[processNestedDataGrid] Found ${nestedTableComponents.length} table components in nested grid`);
    console.log(`[processNestedDataGrid] Nested table paths:`, nestedTableComponents.map(c => c.table));
    
    // PRIORITY 1: Try to get nested data from parent row (from schema structure)
    let foundInParent = false;
    
    if (nestedTableComponents.length > 0) {
        const tablePath = nestedTableComponents[0].table;
        
        // Try exact match first
        if (parentRow[tablePath] && Array.isArray(parentRow[tablePath])) {
            console.log(`[processNestedDataGrid] ✅✅✅ FOUND nested data in parent row [EXACT]: ${tablePath}, rows: ${parentRow[tablePath].length}`);
            foundInParent = true;
            
            parentRow[tablePath].forEach((nestedItem, index) => {
                const row = {};
                Object.keys(nestedItem).forEach(key => {
                    row[key] = nestedItem[key];
                });
                console.log(`[processNestedDataGrid] Nested row ${index}:`, row);
                nestedDefaultValue.push(row);
            });
        }
        // Try partial match
        else {
            const tablePathParts = tablePath.split('.');
            const lastPart = tablePathParts[tablePathParts.length - 1];
            
            console.log(`[processNestedDataGrid] Trying partial match with last part: ${lastPart}`);
            
            if (parentRow[lastPart] && Array.isArray(parentRow[lastPart])) {
                console.log(`[processNestedDataGrid] ✅✅✅ FOUND nested data in parent row [PARTIAL]: ${lastPart}, rows: ${parentRow[lastPart].length}`);
                foundInParent = true;
                
                parentRow[lastPart].forEach((nestedItem, index) => {
                    const row = {};
                    Object.keys(nestedItem).forEach(key => {
                        row[key] = nestedItem[key];
                    });
                    console.log(`[processNestedDataGrid] Nested row ${index}:`, row);
                    nestedDefaultValue.push(row);
                });
            }
        }
    }
    
    // PRIORITY 2: Try query data if not found in parent
    if (!foundInParent && queryData && nestedTableComponents.length > 0) {
        console.log(`[processNestedDataGrid] Trying to find data from queryData...`);
        
        queryData.forEach((queryItem) => {
            if (queryItem.graph) {
                nestedTableComponents.forEach((nestedComp) => {
                    const tablePath = nestedComp.table;
                    const nestedData = getNestedData(queryItem.graph, tablePath);
                    
                    if (nestedData && Array.isArray(nestedData)) {
                        console.log(`[processNestedDataGrid] ✅ Found nested data in graph for ${tablePath}, rows: ${nestedData.length}`);
                        
                        nestedData.forEach((nestedItem, index) => {
                            let existingRow = nestedDefaultValue[index];
                            if (!existingRow) {
                                existingRow = {};
                                nestedDefaultValue.push(existingRow);
                            }
                            Object.keys(nestedItem).forEach(key => {
                                existingRow[key] = nestedItem[key];
                            });
                        });
                    }
                });
            }
        });
    }
    
    // PRIORITY 3: Use existing defaultValue
    if (nestedDefaultValue.length === 0 && nestedComponent.defaultValue && Array.isArray(nestedComponent.defaultValue)) {
        console.log(`[processNestedDataGrid] Using existing defaultValue: ${nestedComponent.defaultValue.length} rows`);
        nestedComponent.defaultValue.forEach(row => {
            nestedDefaultValue.push({...row});
        });
    }
    
    // Ensure all components have values
    nestedDefaultValue.forEach(row => {
        nestedComponents.forEach(sc => {
            if (sc.type === 'content') return;
            if (row[sc.key] === undefined) {
                row[sc.key] = undefined;
            }
        });
        Object.entries(contentHTMLMap).forEach(([key, html]) => {
            row[key] = html;
        });
    });
    
    // Create empty row if still no data
    if (nestedDefaultValue.length === 0) {
        console.log(`[processNestedDataGrid] ⚠️ No data found, creating empty row`);
        const emptyRow = {};
        nestedComponents.forEach(sc => {
            if (sc.type !== 'content') {
                emptyRow[sc.key] = undefined;
            }
        });
        Object.entries(contentHTMLMap).forEach(([key, html]) => {
            emptyRow[key] = html;
        });
        nestedDefaultValue.push(emptyRow);
    }
    
    console.log(`[processNestedDataGrid] ========== Final nested rows: ${nestedDefaultValue.length} ==========`);
    return nestedDefaultValue;
}

function processDataGridComponent(component, queryData, formState) {
    const { components } = component;
    const newDefaultValue = [];

    // Validasi data API/GraphQL
    if (formState && formState.apiResults) {
        console.log("[datagrid] API Results available keys:", Object.keys(formState.apiResults));
    } else {
        console.warn("[datagrid] API Results belum tersedia!");
    }

    // Proses content component terlebih dahulu
    const contentHTMLMap = {};
    components.forEach((subComponent) => {
        if (subComponent.type === 'content') {
            processContentComponent(subComponent, queryData, formState);
            if (subComponent.html) {
                contentHTMLMap[subComponent.key] = subComponent.html;
            }
        }
    });

    // Identifikasi komponen utama (UNCHANGED - exclude nested datagrids)
    const mainComponents = components.filter(sc => 
        sc.table && 
        sc.type !== 'content' && 
        !sc.apiSource && 
        sc.type !== 'datagrid' &&  // ONLY ADDITION: Skip nested datagrids
        ['textfield', 'textarea', 'number'].includes(sc.type)
    );

    // Buat mapping komponen berdasarkan nama table (UNCHANGED)
    const tableComponentMap = {};
    const primaryTablePath = {};
    
    const allTablePaths = components
        .filter(sc => sc.type !== 'content' && sc.type !== 'datagrid' && sc.table)
        .map(sc => sc.table);
    
    console.log(`[datagrid] All table paths found:`, allTablePaths);
    
    function findLongestCommonPrefix(paths) {
        if (paths.length === 0) return {};
        if (paths.length === 1) return { [paths[0]]: paths[0] };
        
        const groupings = {};
        const processed = new Set();
        
        paths.forEach(path => {
            if (processed.has(path)) return;
            
            const relatedPaths = paths.filter(otherPath => {
                if (otherPath === path) return true;
                return path.startsWith(otherPath + '.') || otherPath.startsWith(path + '.');
            });
            
            if (relatedPaths.length > 1) {
                const parts = relatedPaths.map(p => p.split('.'));
                let commonLength = Math.min(...parts.map(p => p.length));
                
                for (let i = 0; i < commonLength; i++) {
                    const firstPart = parts[0][i];
                    const allMatch = parts.every(p => p[i] === firstPart);
                    if (!allMatch) {
                        commonLength = i;
                        break;
                    }
                }
                
                const primaryPath = parts[0].slice(0, Math.max(2, commonLength)).join('.');
                
                relatedPaths.forEach(relatedPath => {
                    groupings[relatedPath] = primaryPath;
                    processed.add(relatedPath);
                });
                
                console.log(`[datagrid] Grouped paths under "${primaryPath}":`, relatedPaths);
            } else {
                groupings[path] = path;
                processed.add(path);
            }
        });
        
        return groupings;
    }
    
    const pathGroupings = findLongestCommonPrefix(allTablePaths);
    
    components.forEach((subComponent) => {
        if (subComponent.type === 'content' || subComponent.type === 'datagrid') return;
        const table = subComponent.table;
        if (!table) return;
        
        const primaryPath = pathGroupings[table] || table;
        
        if (!tableComponentMap[primaryPath]) {
            tableComponentMap[primaryPath] = [];
            primaryTablePath[primaryPath] = new Set();
        }
        tableComponentMap[primaryPath].push(subComponent);
        primaryTablePath[primaryPath].add(table);
    });

    const hasTableComponents = Object.keys(tableComponentMap).length > 0;
    const hasApiComponents = components.some(sc => sc.apiSource && sc.type !== 'content');

    console.log(`[datagrid] hasTableComponents: ${hasTableComponents}, hasApiComponents: ${hasApiComponents}`);

    // SPECIAL HANDLING: API-only case (UNCHANGED)
    if (!hasTableComponents && hasApiComponents && formState?.apiResults) {
        console.log(`[datagrid] 🔄 SPECIAL CASE: No table components, creating rows from API data`);
        
        const apiSources = components
            .filter(sc => sc.apiSource && sc.type !== 'content')
            .map(sc => sc.apiSource.source);
        
        const uniqueApiSources = [...new Set(apiSources)];
        
        let primaryApiSource = null;
        let primaryApiData = null;
        
        const priorityOrder = ['bom', 'partComponents', 'parts'];
        
        for (const source of priorityOrder) {
            if (uniqueApiSources.includes(source)) {
                const apiData = formState.apiResults[source];
                if (Array.isArray(apiData) && apiData.length > 0) {
                    primaryApiSource = source;
                    primaryApiData = apiData;
                    break;
                }
            }
        }
        
        if (!primaryApiSource) {
            for (const source of uniqueApiSources) {
                const apiData = formState.apiResults[source];
                if (Array.isArray(apiData) && apiData.length > 0) {
                    primaryApiSource = source;
                    primaryApiData = apiData;
                    break;
                }
            }
        }
        
        if (primaryApiSource && primaryApiData) {
            primaryApiData.forEach((apiItem, index) => {
                const row = {};
                
                components.forEach((sc) => {
                    if (sc.type === 'content') return;
                    if (sc.key === "image") {
                        row[sc.key] = "unknown";
                    } else {
                        row[sc.key] = undefined;
                    }
                });
                
                Object.keys(apiItem).forEach(key => {
                    row[key] = apiItem[key];
                });
                
                Object.entries(contentHTMLMap).forEach(([key, html]) => {
                    row[key] = html;
                });
                
                newDefaultValue.push(row);
            });
        }
    }

    // Proses data dari query (ONLY ADDITION: nested datagrid processing at the end)
    if (queryData && hasTableComponents) {
        queryData.forEach((queryItem) => {
            Object.entries(tableComponentMap).forEach(([primaryPath, tableComponents]) => {

                // Handle SQL data (UNCHANGED)
                if (queryItem.sqlQuery?.table === primaryPath) {
                    queryItem.sqlQuery.data.forEach((item, index) => {
                        const row = {};
                        
                        Object.keys(item).forEach(key => {
                            row[key] = item[key];
                        });
                        
                        components.forEach((sc) => {
                            if (sc.key === "image") {
                                row[sc.key] = "unknown";
                            } else if (row[sc.key] === undefined) {
                                row[sc.key] = undefined;
                            }
                        });
                        
                        Object.entries(contentHTMLMap).forEach(([key, html]) => {
                            row[key] = html;
                        });
                        
                        // NEW: Process nested datagrids
                        components.forEach((sc) => {
                            if (sc.type === 'datagrid') {
                                row[sc.key] = processNestedDataGrid(sc, row, queryData, formState, contentHTMLMap);
                            }
                        });
                        
                        newDefaultValue.push(row);
                    });
                }

                // Handle Graph data (UNCHANGED except nested datagrid processing)
                if (queryItem.graph) {
                    let processedData = false;
                    let primaryData = null;
                    
                    if (primaryPath.includes('.')) {
                        primaryData = getNestedData(queryItem.graph, primaryPath);
                        if (primaryData && Array.isArray(primaryData)) {
                            processedData = true;
                            
                            primaryData.forEach((primaryItem, index) => {
                                const row = {};
                                
                                Object.keys(primaryItem).forEach(key => {
                                    row[key] = primaryItem[key];
                                });
                                
                                tableComponents.forEach((sc) => {
                                    if (sc.type === 'content' || !sc.table) return;
                                    
                                    const componentTablePath = sc.table;
                                    
                                    if (componentTablePath === primaryPath) {
                                        if (sc.key === "image" && row[sc.key] === undefined) {
                                            row[sc.key] = "unknown";
                                        }
                                        return;
                                    }
                                    
                                    if (componentTablePath.startsWith(primaryPath + '.')) {
                                        const extraPath = componentTablePath.substring(primaryPath.length + 1);
                                        const deeperData = getNestedData(primaryItem, extraPath);
                                        
                                        if (deeperData) {
                                            if (Array.isArray(deeperData) && deeperData.length > 0) {
                                                const deeperItem = deeperData[0];
                                                if (deeperItem && typeof deeperItem === 'object') {
                                                    if (sc.key in deeperItem) {
                                                        row[sc.key] = deeperItem[sc.key];
                                                    } else {
                                                        Object.keys(deeperItem).forEach(key => {
                                                            if (row[key] === undefined) {
                                                                row[key] = deeperItem[key];
                                                            }
                                                        });
                                                    }
                                                }
                                            } else if (typeof deeperData === 'object') {
                                                if (sc.key in deeperData) {
                                                    row[sc.key] = deeperData[sc.key];
                                                } else {
                                                    Object.keys(deeperData).forEach(key => {
                                                        if (row[key] === undefined) {
                                                            row[key] = deeperData[key];
                                                        }
                                                    });
                                                }
                                            }
                                        }
                                        
                                        if (sc.key === "image" && row[sc.key] === undefined) {
                                            row[sc.key] = "unknown";
                                        }
                                    }
                                });
                                
                                Object.entries(contentHTMLMap).forEach(([key, html]) => {
                                    row[key] = html;
                                });
                                
                                // NEW: Process nested datagrids
                                components.forEach((sc) => {
                                    if (sc.type === 'datagrid') {
                                        row[sc.key] = processNestedDataGrid(sc, row, queryData, formState, contentHTMLMap);
                                    }
                                });
                                
                                newDefaultValue.push(row);
                            });
                        }
                    }
                    
                    // Fallback: direct table match (UNCHANGED except nested processing)
                    if (!processedData && queryItem.graph[primaryPath]) {
                        queryItem.graph[primaryPath].forEach((item, index) => {
                            const row = {};
                            
                            Object.keys(item).forEach(key => {
                                row[key] = item[key];
                            });
                            
                            components.forEach((sc) => {
                                if (sc.key === "image") {
                                    row[sc.key] = "unknown";
                                } else if (row[sc.key] === undefined) {
                                    row[sc.key] = undefined;
                                }
                            });
                            
                            Object.entries(contentHTMLMap).forEach(([key, html]) => {
                                row[key] = html;
                            });
                            
                            // NEW: Process nested datagrids
                            components.forEach((sc) => {
                                if (sc.type === 'datagrid') {
                                    row[sc.key] = processNestedDataGrid(sc, row, queryData, formState, contentHTMLMap);
                                }
                            });
                            
                            newDefaultValue.push(row);
                        });
                    }
                }
            });
        });
    }

    // Process API data (UNCHANGED)
    const apiComponentMap = {};
    components.forEach((sc) => {
        if (sc.type === 'content' || !sc.apiSource) return;
        const source = sc.apiSource.source;
        if (!apiComponentMap[source]) {
            apiComponentMap[source] = [];
        }
        apiComponentMap[source].push(sc);
    });

    if (Object.keys(apiComponentMap).length > 0 && newDefaultValue.length > 0) {
        Object.entries(apiComponentMap).forEach(([source, apiComponents]) => {
            const apiItems1 = formState.apiResults?.[source];
            const apiItems = Array.isArray(apiItems1) ? apiItems1 : [apiItems1];
            const dataPath = apiComponents[0]?.apiSource?.dataPath || [];
            let items = apiItems;
            
            for (const path of dataPath) {
                items = items?.[path] ?? null;
            }

            const isValidApiData = items && Array.isArray(items) && items.length > 0;
            
            if (isValidApiData) {
                const apiItemsByValue = {};
                const apiItemsByRowIndex = {};
                
                items.forEach((apiItem, apiIndex) => {
                    if (apiItem && apiItem.pk) {
                        apiItemsByValue[apiItem.pk] = apiItem;
                    }
                    if (apiItem && apiItem.sub_part) {
                        apiItemsByValue[apiItem.sub_part] = apiItem;
                    }
                    if (apiItem && apiItem._datagridRowIndex !== undefined) {
                        apiItemsByRowIndex[apiItem._datagridRowIndex] = apiItem;
                    }
                    if (!apiItemsByRowIndex[apiIndex]) {
                        apiItemsByRowIndex[apiIndex] = apiItem;
                    }
                });
                
                newDefaultValue.forEach((row, rowIndex) => {
                    let apiItem = null;
                    let matchMethod = '';
                    
                    if (!apiItem && row.pk && apiItemsByValue[row.pk]) {
                        apiItem = apiItemsByValue[row.pk];
                        matchMethod = `pk=${row.pk}`;
                    }
                    
                    if (!apiItem && row.sub_part_id && apiItemsByValue[row.sub_part_id]) {
                        apiItem = apiItemsByValue[row.sub_part_id];
                        matchMethod = `sub_part_id=${row.sub_part_id}`;
                    }
                    
                    if (!apiItem) {
                        for (const key of Object.keys(row)) {
                            if (key === 'image' || key === 'image_preview') continue;
                            const rowValue = row[key];
                            if (rowValue === undefined || rowValue === null) continue;
                            if (typeof rowValue !== 'string' && typeof rowValue !== 'number') continue;
                            if (apiItemsByValue[rowValue]) {
                                apiItem = apiItemsByValue[rowValue];
                                matchMethod = `dynamicKey=${key}=${rowValue}`;
                                break;
                            }
                        }
                    }
                    
                    if (!apiItem && source === 'bom' && row.pk) {
                        const bomItem = items.find(item => item.sub_part == row.pk);
                        if (bomItem) {
                            apiItem = bomItem;
                            matchMethod = `bom.sub_part=${bomItem.sub_part}->row.pk=${row.pk}`;
                        }
                    }
                    
                    if (!apiItem && source === 'partComponents' && row.pk) {
                        const componentItem = items.find(item => item.pk == row.pk);
                        if (componentItem) {
                            apiItem = componentItem;
                            matchMethod = `partComponents.pk=${componentItem.pk}->row.pk=${row.pk}`;
                        }
                    }
                    
                    if (!apiItem && apiItemsByRowIndex[rowIndex] !== undefined) {
                        apiItem = apiItemsByRowIndex[rowIndex];
                        matchMethod = `rowIndex=${rowIndex}`;
                    }
                    
                    apiComponents.forEach((sc) => {
                        const valKey = sc.apiSource.valueKey || sc.key;
                        const apiValue = apiItem?.[valKey];
                        
                        if (sc.key === "image") {
                            if (apiValue !== undefined && apiValue !== null && apiValue !== "") {
                                row[sc.key] = apiValue;
                            }
                        } else {
                            if (apiValue !== undefined && apiValue !== null) {
                                row[sc.key] = apiValue;
                            }
                        }
                    });
                });
            }
        });
    }

    // Use existing defaultValue (ONLY ADDITION: nested datagrid processing)
    if (newDefaultValue.length === 0 && component.defaultValue && Array.isArray(component.defaultValue)) {
        component.defaultValue.forEach((row) => {
            const processedRow = {};
            components.forEach((sc) => {
                // NEW: Process nested datagrid
                if (sc.type === 'datagrid') {
                    processedRow[sc.key] = row[sc.key] || processNestedDataGrid(sc, row, queryData, formState, contentHTMLMap);
                } else if (sc.key === "image") {
                    processedRow[sc.key] = (row[sc.key] && row[sc.key] !== "" && row[sc.key] !== null) ? row[sc.key] : "unknown";
                } else {
                    processedRow[sc.key] = row[sc.key];
                }
            });
            Object.entries(contentHTMLMap).forEach(([key, html]) => {
                processedRow[key] = html;
            });
            newDefaultValue.push(processedRow);
        });
    }

    // Create empty row (ONLY ADDITION: nested datagrid processing)
    if (newDefaultValue.length === 0) {
        const emptyRow = {};
        components.forEach((sc) => {
            // NEW: Process nested datagrid
            if (sc.type === 'datagrid') {
                emptyRow[sc.key] = processNestedDataGrid(sc, emptyRow, queryData, formState, contentHTMLMap);
            } else if (sc.key === "image") {
                emptyRow[sc.key] = "unknown";
            } else {
                emptyRow[sc.key] = undefined;
            }
        });
        Object.entries(contentHTMLMap).forEach(([key, html]) => {
            emptyRow[key] = html;
        });
        newDefaultValue.push(emptyRow);
    }

    // Final validation (UNCHANGED)
    newDefaultValue.forEach((row, rowIndex) => {
        components.forEach(sc => {
            if (sc.key === "image") {
                if (!row[sc.key] || row[sc.key] === null || row[sc.key] === undefined || row[sc.key] === "") {
                    row[sc.key] = "unknown";
                }
            }
        });
    });

    component.defaultValue = newDefaultValue;
    
    console.log(`[datagrid] Final result: ${newDefaultValue.length} rows processed`);
}

module.exports = processDataGridComponent;