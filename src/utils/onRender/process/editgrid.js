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
    if (formState && formState.apiResults) {

    } else {
        console.warn("[select] API Results belum tersedia!");
    }
    
    const { table, key, defaultValue } = component;
    // Hanya reset data.values jika memang akan diisi ulang dari sumber data
    if (!component.data) {
        component.data = { values: [] };
    } else if (table || component.apiSource) {
        // Hanya clear jika memang akan diisi ulang dari SQL/Graph/API
        component.data.values = [];
    }

    // Process data from SQL/Graph sources (supporting nested paths)
    if(table){

        queryData.forEach((queryItem) => {
            // Handle SQL data (direct table match)
            if (queryItem.sqlQuery?.table === table) {

                queryItem.sqlQuery.data.forEach((result) => {
                    component.data.values.push({
                        label: String(result[`label_${table}`] || "No Label"),
                        value: String(result[`value_${table}`] || ""),
                    });
                });
            }
      
            // Handle Graph data (supporting nested paths)
            if (queryItem.graph) {
                // Try direct table match first
                if (queryItem.graph[table]) {

                    const labelKey = component.graphConfig?.labelKey || "label";
                    const valueKey = component.graphConfig?.valueKey || key;
                    
                    queryItem.graph[table].forEach((graphItem) => {
                        component.data.values.push({
                            label: String(graphItem[labelKey] || "No Label"),
                            value: String(graphItem[valueKey] || ""),
                        });
                    });
                } 
                // Try nested path (e.g., "mo_retur_receive.invoice_retur_to_invoice")
                else {
                    const nestedData = getNestedData(queryItem.graph, table);
                    if (nestedData && Array.isArray(nestedData)) {

                        const labelKey = component.graphConfig?.labelKey || "label";
                        const valueKey = component.graphConfig?.valueKey || key;
                        
                        nestedData.forEach((graphItem) => {
                            component.data.values.push({
                                label: String(graphItem[labelKey] || "No Label"),
                                value: String(graphItem[valueKey] || ""),
                            });
                        });
                    } else if (nestedData && typeof nestedData === 'object') {

                        const labelKey = component.graphConfig?.labelKey || "label";
                        const valueKey = component.graphConfig?.valueKey || key;
                        
                        component.data.values.push({
                            label: String(nestedData[labelKey] || "No Label"),
                            value: String(nestedData[valueKey] || ""),
                        });
                    } else {

                    }
                }
            }
        });
    }


  
    // Process API source data (now supporting arrays)
    if (component.apiSource) {
      const sourceKey = component.apiSource?.source;
      const apiData = formState.apiResults[sourceKey];

      
      if (apiData) {

  
        const {
          labelKey = "label",
          valueKey = "value",
          optionsPath = []
        } = component.apiSource;
  
        // Handle both array and single object responses
        const dataItems = Array.isArray(apiData) ? apiData : [apiData];
        
        // Process each data item
        dataItems.forEach(dataItem => {
          let options = dataItem;
          
          // Navigate through the optionsPath if defined
          for (const path of optionsPath) {
            options = options?.[path] ?? null;
          }
          
          if (Array.isArray(options)) {
            // Process array of options
            options.forEach((opt) => {
              let label = "";
  
              // Support labelKey format like "location_name - quantity"
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
            // Handle single object option
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
    
    // Set default value if needed
    if (!component.defaultValue && defaultValue) {
      component.defaultValue = defaultValue;
    }
}
  
module.exports = processSelectComponent;
