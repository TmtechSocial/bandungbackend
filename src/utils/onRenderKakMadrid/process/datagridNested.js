const processContentComponent = require("./content");

/**
 * Enhanced helper function to get nested data using dot notation with unlimited depth support
 */
function getNestedData(obj, path) {
  if (!path || !obj) return null;

  const keys = path.split(".");
  let current = obj;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];

    if (current && typeof current === "object") {
      if (key in current) {
        current = current[key];

        // Enhanced array navigation for unlimited depth
        if (Array.isArray(current) && i < keys.length - 1) {
          if (current.length > 0) {
            current = current[0];

            if (!current || typeof current !== "object") {
              return null;
            }
          } else {
            return null;
          }
        }
      } else {
        return null;
      }
    } else {
      return null;
    }
  }

  return current;
}

/**
 * Helper function to get the last part of a nested path
 */
function getTableName(tablePath) {
  if (!tablePath) return tablePath;
  const parts = tablePath.split(".");
  return parts[parts.length - 1];
}

/**
 * NEW: Process nested datagrid components recursively
 */
function processNestedDataGrid(component, parentRow, formState, depth = 0) {
  const indent = "  ".repeat(depth);
  console.log(`${indent}[processNestedDataGrid] Processing nested datagrid: ${component.key} at depth ${depth}`);
  
  if (!component.components || component.components.length === 0) {
    console.log(`${indent}[processNestedDataGrid] No components found`);
    return;
  }

  const nestedRows = [];
  
  // Find the source data for this nested datagrid
  // Look for table path in components
  const tableComponents = component.components.filter(sc => 
    sc.table && sc.type !== 'content'
  );
  
  console.log(`${indent}[processNestedDataGrid] Found ${tableComponents.length} table components`);
  
  if (tableComponents.length > 0) {
    // Get the last part of table path which should match parentRow keys
    const tablePaths = tableComponents.map(sc => sc.table);
    console.log(`${indent}[processNestedDataGrid] Table paths:`, tablePaths);
    
    // Extract the nested data key from parent row
    // Example: "mo_order_shop.konfigurasi_product_order" -> "konfigurasi_product_order"
    const dataKeys = new Set();
    tablePaths.forEach(path => {
      const parts = path.split('.');
      const lastPart = parts[parts.length - 1];
      dataKeys.add(lastPart);
    });
    
    console.log(`${indent}[processNestedDataGrid] Looking for data keys in parent row:`, Array.from(dataKeys));
    console.log(`${indent}[processNestedDataGrid] Parent row keys:`, Object.keys(parentRow));
    
    // Find matching data in parent row
    let sourceData = null;
    let sourceKey = null;
    
    for (const key of dataKeys) {
      if (parentRow[key] && Array.isArray(parentRow[key]) && parentRow[key].length > 0) {
        sourceData = parentRow[key];
        sourceKey = key;
        break;
      }
    }
    
    if (sourceData) {
      console.log(`${indent}[processNestedDataGrid] ✅ Found source data: ${sourceKey} with ${sourceData.length} items`);
      
      // Process each item in source data
      sourceData.forEach((item, index) => {
        const nestedRow = {};
        
        // Copy all fields from source item
        Object.keys(item).forEach(key => {
          nestedRow[key] = item[key];
        });
        
        // Process each component in nested datagrid
        component.components.forEach(sc => {
          if (sc.type === 'content') {
            // Process content component
            processContentComponent(sc, null, formState);
            return;
          }
          
          // Extract field name from table path
          const fieldName = sc.table ? getTableName(sc.table) : sc.key;
          
          // Map component key to data
          if (sc.key !== fieldName && item[fieldName] !== undefined) {
            nestedRow[sc.key] = item[fieldName];
          } else if (nestedRow[sc.key] === undefined) {
            nestedRow[sc.key] = item[sc.key] !== undefined ? item[sc.key] : null;
          }
        });
        
        console.log(`${indent}[processNestedDataGrid] Nested row ${index}:`, Object.keys(nestedRow));
        nestedRows.push(nestedRow);
      });
    } else {
      console.log(`${indent}[processNestedDataGrid] ⚠️ No source data found in parent row`);
      console.log(`${indent}[processNestedDataGrid] Parent row structure:`, JSON.stringify(parentRow, null, 2).substring(0, 500));
    }
  }
  
  // If no rows created, create empty row
  if (nestedRows.length === 0) {
    const emptyRow = {};
    component.components.forEach(sc => {
      emptyRow[sc.key] = null;
    });
    nestedRows.push(emptyRow);
  }
  
  component.defaultValue = nestedRows;
  console.log(`${indent}[processNestedDataGrid] ✅ Created ${nestedRows.length} nested rows`);
}

/**
 * Main DataGrid processor
 */
function processDataGridComponent(component, queryData, formState) {
  console.log(`\n[datagrid] ========== Processing DataGrid: ${component.key} ==========`);
  
  const { components } = component;
  const newDefaultValue = [];

  // Process content components first
  const contentHTMLMap = {};
  components.forEach((subComponent) => {
    if (subComponent.type === "content") {
      if (subComponent.custom === "button") {
        subComponent.html = `<a
  href="https://mirorim.ddns.net:6789/backendBandung/get-image/{{row.${subComponent.key}}}"
  target="_blank"
  style="display: inline-block; background: #2563eb; color: #fff; padding: 7px 18px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px; margin: 4px 0; box-shadow: 0 2px 8px rgba(37,99,235,0.08); transition: background 0.2s;"
  onmouseover="this.style.background='#1d4ed8'" onmouseout="this.style.background='#2563eb'"
>Lihat Evidence</a>`;
      }
      processContentComponent(subComponent, queryData, formState);
    }
  });

  // Identify main components
  const mainComponents = components.filter(
    (sc) =>
      sc.table &&
      sc.type !== "content" &&
      !sc.apiSource &&
      ["textfield", "textarea", "number"].includes(sc.type)
  );

  // Build table component map
  const tableComponentMap = {};
  const primaryTablePath = {};

  const allTablePaths = components
    .filter((sc) => sc.type !== "content" && sc.table)
    .map((sc) => sc.table);

  console.log(`[datagrid] All table paths found:`, allTablePaths);

  function findLongestCommonPrefix(paths) {
    if (paths.length === 0) return {};
    if (paths.length === 1) return { [paths[0]]: paths[0] };

    const groupings = {};
    const processed = new Set();

    paths.forEach((path) => {
      if (processed.has(path)) return;

      const relatedPaths = paths.filter((otherPath) => {
        if (otherPath === path) return true;
        return (
          path.startsWith(otherPath + ".") || otherPath.startsWith(path + ".")
        );
      });

      if (relatedPaths.length > 1) {
        const parts = relatedPaths.map((p) => p.split("."));
        let commonLength = Math.min(...parts.map((p) => p.length));

        for (let i = 0; i < commonLength; i++) {
          const firstPart = parts[0][i];
          const allMatch = parts.every((p) => p[i] === firstPart);
          if (!allMatch) {
            commonLength = i;
            break;
          }
        }

        const primaryPath = parts[0]
          .slice(0, Math.max(2, commonLength))
          .join(".");

        relatedPaths.forEach((relatedPath) => {
          groupings[relatedPath] = primaryPath;
          processed.add(relatedPath);
        });
      } else {
        groupings[path] = path;
        processed.add(path);
      }
    });

    return groupings;
  }

  const pathGroupings = findLongestCommonPrefix(allTablePaths);

  components.forEach((subComponent) => {
    if (subComponent.type === "content") return;
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
  const hasApiComponents = components.some(
    (sc) => sc.apiSource && sc.type !== "content"
  );

  console.log(`[datagrid] hasTableComponents: ${hasTableComponents}, hasApiComponents: ${hasApiComponents}`);

  // Process query data
  if (queryData && hasTableComponents) {
    queryData.forEach((queryItem) => {
      Object.entries(tableComponentMap).forEach(
        ([primaryPath, tableComponents]) => {
          
          // Handle SQL data
          if (queryItem.sqlQuery?.table === primaryPath) {
            console.log(`[datagrid] Processing SQL data for table: ${primaryPath}`);
            queryItem.sqlQuery.data.forEach((item, index) => {
              const row = {};

              Object.keys(item).forEach((key) => {
                row[key] = item[key];
              });

              components.forEach((sc) => {
                if (sc.key === "image" && row[sc.key] === undefined) {
                  row[sc.key] = "unknown";
                }
              });

              Object.entries(contentHTMLMap).forEach(([key, html]) => {
                row[key] = html;
              });

              newDefaultValue.push(row);
            });
          }

          // Handle Graph data
          if (queryItem.graph) {
            let processedData = false;
            let primaryData = null;

            if (primaryPath.includes(".")) {
              primaryData = getNestedData(queryItem.graph, primaryPath);
              if (primaryData && Array.isArray(primaryData)) {
                console.log(`[datagrid] ✅ Found nested graph data for: ${primaryPath}`);
                processedData = true;

                primaryData.forEach((primaryItem, index) => {
                  const row = {};

                  Object.keys(primaryItem).forEach((key) => {
                    row[key] = primaryItem[key];
                  });

                  tableComponents.forEach((sc) => {
                    if (sc.type === "content" || !sc.table) return;

                    const componentTablePath = sc.table;

                    if (componentTablePath === primaryPath) {
                      if (sc.key === "image" && row[sc.key] === undefined) {
                        row[sc.key] = "unknown";
                      }
                      return;
                    }

                    if (componentTablePath.startsWith(primaryPath + ".")) {
                      const extraPath = componentTablePath.substring(
                        primaryPath.length + 1
                      );

                      const deeperData = getNestedData(primaryItem, extraPath);

                      if (deeperData) {
                        if (Array.isArray(deeperData) && deeperData.length > 0) {
                          const deeperItem = deeperData[0];
                          if (deeperItem && typeof deeperItem === "object") {
                            if (sc.key in deeperItem) {
                              row[sc.key] = deeperItem[sc.key];
                            } else {
                              Object.keys(deeperItem).forEach((key) => {
                                if (row[key] === undefined) {
                                  row[key] = deeperItem[key];
                                }
                              });
                            }
                          }
                        } else if (typeof deeperData === "object") {
                          if (sc.key in deeperData) {
                            row[sc.key] = deeperData[sc.key];
                          }
                        }
                      }

                      if (sc.key === "image" && row[sc.key] === undefined) {
                        row[sc.key] = "unknown";
                      }
                    }
                  });

                  components.forEach((sc) => {
                    if (sc.key === "image" && row[sc.key] === undefined) {
                      row[sc.key] = "unknown";
                    }
                  });

                  Object.entries(contentHTMLMap).forEach(([key, html]) => {
                    row[key] = html;
                  });

                  newDefaultValue.push(row);
                });
              }
            }

            if (!processedData && queryItem.graph[primaryPath]) {
              console.log(`[datagrid] Using direct graph data for: ${primaryPath}`);
              queryItem.graph[primaryPath].forEach((item, index) => {
                const row = {};

                Object.keys(item).forEach((key) => {
                  row[key] = item[key];
                });

                components.forEach((sc) => {
                  if (sc.key === "image" && row[sc.key] === undefined) {
                    row[sc.key] = "unknown";
                  }
                });

                Object.entries(contentHTMLMap).forEach(([key, html]) => {
                  row[key] = html;
                });

                newDefaultValue.push(row);
              });
            }
          }
        }
      );
    });
  }

  // Process API data
  const apiComponentMap = {};
  components.forEach((sc) => {
    if (sc.type === "content" || !sc.apiSource) return;
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
          let matchMethod = "";

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
              if (key === "image" || key === "image_preview") continue;
              const rowValue = row[key];
              if (rowValue === undefined || rowValue === null) continue;
              if (typeof rowValue !== "string" && typeof rowValue !== "number")
                continue;
              if (apiItemsByValue[rowValue]) {
                apiItem = apiItemsByValue[rowValue];
                matchMethod = `dynamicKey=${key}=${rowValue}`;
                break;
              }
            }
          }

          if (!apiItem && source === "bom" && row.pk) {
            const bomItem = items.find((item) => item.sub_part == row.pk);
            if (bomItem) {
              apiItem = bomItem;
              matchMethod = `bom.sub_part=${bomItem.sub_part}->row.pk=${row.pk}`;
            }
          }

          if (!apiItem && source === "partComponents" && row.pk) {
            const componentItem = items.find((item) => item.pk == row.pk);
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

  // Use existing defaultValue if no query data
  if (
    newDefaultValue.length === 0 &&
    component.defaultValue &&
    Array.isArray(component.defaultValue)
  ) {
    component.defaultValue.forEach((row) => {
      const processedRow = {};
      components.forEach((sc) => {
        if (sc.key === "image") {
          processedRow[sc.key] =
            row[sc.key] && row[sc.key] !== "" && row[sc.key] !== null
              ? row[sc.key]
              : "unknown";
        } else {
          processedRow[sc.key] = row[sc.key];
        }
      });
      newDefaultValue.push(processedRow);
    });
  }

  // Create empty row if still no data
  if (newDefaultValue.length === 0) {
    const emptyRow = {};
    components.forEach((sc) => {
      if (sc.key === "image") {x
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

  // Final validation
  newDefaultValue.forEach((row, rowIndex) => {
    components.forEach((sc) => {
      if (sc.key === "image") {
        if (!row[sc.key] || row[sc.key] === null || row[sc.key] === undefined || row[sc.key] === "") {
          row[sc.key] = "unknown";
        }
      }
    });
  });

  console.log(`\n[datagrid] Checking for nested datagrids in ${component.key}...`);
  const nestedDataGrids = components.filter(sc => sc.type === 'datagrid');
  
  if (nestedDataGrids.length > 0) {
    console.log(`[datagrid] Found ${nestedDataGrids.length} nested datagrid(s)`);
    
    // Process each row and its nested datagrids
    newDefaultValue.forEach((row, rowIndex) => {
      console.log(`\n[datagrid] Processing row ${rowIndex} for nested datagrids`);
      
      nestedDataGrids.forEach(nestedDG => {
        console.log(`[datagrid] Processing nested datagrid: ${nestedDG.key} for row ${rowIndex}`);
        processNestedDataGrid(nestedDG, row, formState, 1);
        
        // Attach the processed nested datagrid to the row
        row[nestedDG.key] = nestedDG.defaultValue || [];
        console.log(`[datagrid] ✅ Attached ${row[nestedDG.key].length} nested rows to row ${rowIndex}.${nestedDG.key}`);
      });
    });
  }

  component.defaultValue = newDefaultValue;

  console.log(`[datagrid] ========== Final: ${newDefaultValue.length} rows created ==========\n`);
}

module.exports = processDataGridComponent;