// process/select.js

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

function processSelectComponent(component, queryData, formState, apiConfigs) {
    if (!component.data) {
        component.data = { values: [] };
    } else if (component.table || component.apiSource) {
        component.data.values = [];
    }

    const { table, key, defaultValue } = component;

    // Process data from SQL/Graph sources (supporting nested paths)
    if (table) {
        queryData.forEach((queryItem) => {
            // Handle SQL data
            if (queryItem.sqlQuery?.table === table) {
                queryItem.sqlQuery.data.forEach((result) => {
                    const labelKey = component.graphConfig?.labelKey || `label_${table}`;
                    const valueKey = component.graphConfig?.valueKey || `value_${table}`;

                    let label = "";
                    if (labelKey.includes("-")) {
                        label = labelKey.split("-").map(k => {
                            const cleanKey = k.trim();
                            return String(result[cleanKey] ?? "");
                        }).join(" - ");
                    } else {
                        label = String(result[labelKey] ?? result[`label_${table}`] ?? "No Label");
                    }

                    const value = String(result[valueKey] ?? result[`value_${table}`] ?? "");
                    component.data.values.push({ label, value });
                });
            }

            // Handle GraphQL data
            if (queryItem.graph) {
                const labelKey = component.graphConfig?.labelKey || "label";
                const valueKey = component.graphConfig?.valueKey || key;

                // Direct match
                if (queryItem.graph[table]) {
                    queryItem.graph[table].forEach((graphItem) => {
                        let label = "";
                        if (labelKey.includes("-")) {
                            label = labelKey.split("-").map(k => {
                                const cleanKey = k.trim();
                                return String(graphItem[cleanKey] ?? "");
                            }).join(" - ");
                        } else {
                            label = String(graphItem[labelKey] ?? "No Label");
                        }

                        const value = String(graphItem[valueKey] ?? "");
                        component.data.values.push({ label, value });
                    });
                }
                // Nested path
                else {
                    const nestedData = getNestedData(queryItem.graph, table);
                    if (Array.isArray(nestedData)) {
                        nestedData.forEach((graphItem) => {
                            let label = "";
                            if (labelKey.includes("-")) {
                                label = labelKey.split("-").map(k => {
                                    const cleanKey = k.trim();
                                    return String(graphItem[cleanKey] ?? "");
                                }).join(" - ");
                            } else {
                                label = String(graphItem[labelKey] ?? "No Label");
                            }

                            const value = String(graphItem[valueKey] ?? "");
                            component.data.values.push({ label, value });
                        });
                    } else if (nestedData && typeof nestedData === 'object') {
                        let label = "";
                        if (labelKey.includes("-")) {
                            label = labelKey.split("-").map(k => {
                                const cleanKey = k.trim();
                                return String(nestedData[cleanKey] ?? "");
                            }).join(" - ");
                        } else {
                            label = String(nestedData[labelKey] ?? "No Label");
                        }

                        const value = String(nestedData[valueKey] ?? "");
                        component.data.values.push({ label, value });
                    }
                }
            }
        });
    }

    // API source handling tetap sama...
    if (component.apiSource) {
        const sourceKey = component.apiSource?.source;
        const apiData = formState.apiResults[sourceKey];
        if (apiData) {
            const { labelKey = "label", valueKey = "value", optionsPath = [] } = component.apiSource;
            const dataItems = Array.isArray(apiData) ? apiData : [apiData];

            dataItems.forEach(dataItem => {
                let options = dataItem;
                for (const path of optionsPath) {
                    options = options?.[path] ?? null;
                }
                if (Array.isArray(options)) {
                    options.forEach((opt) => {
                        let label = "";
                        if (labelKey.includes("-")) {
                            label = labelKey.split("-").map(k => {
                                const cleanKey = k.trim();
                                return String(opt[cleanKey] ?? "");
                            }).join(" - ");
                        } else {
                            label = String(opt[labelKey] ?? "No Label");
                        }
                        const value = String(opt[valueKey] ?? "");
                        component.data.values.push({ label, value });
                    });
                } else if (options && typeof options === 'object') {
                    let label = "";
                    if (labelKey.includes("-")) {
                        label = labelKey.split("-").map(k => {
                            const cleanKey = k.trim();
                            return String(options[cleanKey] ?? "");
                        }).join(" - ");
                    } else {
                        label = String(options[labelKey] ?? "No Label");
                    }
                    const value = String(options[valueKey] ?? "");
                    component.data.values.push({ label, value });
                }
            });
        }
    }

    // Default value
    if (!component.defaultValue && defaultValue) {
        component.defaultValue = defaultValue;
    }
}

  
module.exports = processSelectComponent;

