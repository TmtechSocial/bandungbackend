// process/select.js
const { getUsersByGroup, getAllGroups } = require('../../ldap/ldapGroups');

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

async function processLdapData(component, fastify) {
    try {
        const { ldap } = component;
        
        // Initialize component data structure properly
        if (!component.data) {
            component.data = { values: [] };
        }
        if (!Array.isArray(component.data.values)) {
            component.data.values = [];
        }
        
        // Initialize values as an array first
        component.values = [];

        if (Array.isArray(ldap)) {
            console.log("[SELECTBOXES] Processing multiple LDAP groups:", ldap);
            
            const userPromises = ldap.map(group => getUsersByGroup(fastify, group));
            const usersArrays = await Promise.all(userPromises);
            
            const allUsers = usersArrays.flat().filter(Boolean);
            const processedUids = new Set();
            const dataValues = [];
            const valuesObj = {};

            // Process users
            allUsers.forEach(user => {
                if (user && user.uid && !processedUids.has(user.uid)) {
                    processedUids.add(user.uid);
                    
                    // Add to data.values array for display
                    dataValues.push({
                        label: user.cn || "No Name",
                        value: user.uid
                    });
                    
                    // Set default value in values object
                    valuesObj[user.uid] = false;
                }
            });

            // Set the processed data
            component.data.values = dataValues;
            
            // Convert values object to array format that FormIO expects
            component.values = component.data.values.map(item => ({
                value: item.value,
                label: item.label,
                selected: valuesObj[item.value] || false
            }));

            console.log("[SELECTBOXES] Final processed structure:", {
                dataValuesLength: component.data.values.length,
                valuesLength: component.values.length,
                sampleValue: component.values[0]
            });

            return {
                data: { values: dataValues },
                values: component.values
            };
        }
    } catch (error) {
        console.error("[SELECTBOXES] Error processing LDAP data:", error);
        throw error;
    }
}

async function processSelectComponent(component, queryData, formState, apiConfigs, fastify) {
    console.log("[SELECTBOXES] Starting processSelectComponent for:", {
        key: component.key,
        type: component.type
    });

    if (formState && formState.apiResults) {
    } else {
        console.warn("[select] API Results belum tersedia!");
    }
    
    const { table, key, defaultValue, ldap } = component;
    // Hanya reset data.values jika memang akan diisi ulang dari sumber data
    if (!component.data) {
        component.data = { values: [] };
    } else if (table || component.apiSource || ldap) {
        // Hanya clear jika memang akan diisi ulang dari SQL/Graph/API/LDAP
        component.data.values = [];
    }

    // Handle LDAP data if specified
    if (ldap) {
        await processLdapData(component, fastify);
        
        // Tunggu dan pastikan data sudah terisi
        console.log("[SELECTBOXES] After LDAP processing:", {
            key: component.key,
            hasValues: Boolean(component.values),
            dataValuesLength: component.data?.values?.length
        });

        // Return result hanya jika data sudah terisi
        if (component.data?.values?.length > 0) {
            const result = {
                data: component.data,
                values: component.values,
                defaultValue: component.defaultValue
            };
            
            console.log("[SELECTBOXES] Returning LDAP result:", {
                key: component.key,
                valuesCount: result.data?.values?.length,
                uniqueValuesCount: Object.keys(result.values || {}).length
            });
            
            return result;
        } else {
            console.warn("[SELECTBOXES] No LDAP data found after processing");
        }
        return;
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

    console.log("[SELECTBOXES] Processing completed:", {
      componentKey: component.key,
      valuesCount: component.data?.values?.length,
      hasDefaultValue: Boolean(component.defaultValue),
      dataValues: component.data?.values
    });
    
    // Set default value if needed
    if (!component.defaultValue && defaultValue) {
      component.defaultValue = defaultValue;
      console.log("[SELECTBOXES] Set default value:", {
        componentKey: component.key,
        defaultValue: defaultValue
      });
    }

    // Return the processed component data
    const result = {
      data: component.data,
      values: component.values,
      defaultValue: component.defaultValue
    };

    console.log("[SELECTBOXES] Returning processed result:", {
      key: component.key,
      hasValues: Boolean(result.values),
      valuesCount: result.data?.values?.length
    });

    return result;
}
  
module.exports = processSelectComponent;
