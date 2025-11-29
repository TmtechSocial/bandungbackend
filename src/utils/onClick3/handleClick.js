// Enhanced handleClick.js with modular structure
const {
  configureProcess,
  configureQuery,
} = require("../../controller/controllerConfig");
const loadInitialApiData = require("./api/loadInitialApiData");
const {
  handleUIInstruction,
} = require("../../controller/controllerUIInstruction");
const processComponents = require("./process/processComponents");
const { processSchemaEnvVariables, processEventEnvVariables, logMatchingEnvVars } = require("./utils/envProcessor");

/**
 * Helper function untuk mengambil nested data menggunakan dot notation
 * @param {Object} obj - Object yang akan di-traverse
 * @param {String} path - Path dengan dot notation (e.g., "mo_retur_receive.invoice_retur_to_invoice")
 * @returns {*} Nilai pada path yang ditentukan atau null jika tidak ditemukan
 */
function getNestedData(obj, path) {
  if (!path || !obj) return null;

  // console.log(`[handleClick] Searching nested path: ${path} in:`, Object.keys(obj));

  const keys = path.split(".");
  let current = obj;

  for (const key of keys) {
    if (current && typeof current === "object") {
      if (key in current) {
        current = current[key];
        // console.log(`[handleClick] Found "${key}", type:`, typeof current);

        // Jika array ditemukan dan masih ada keys, navigasi ke elemen pertama
        if (Array.isArray(current) && keys.indexOf(key) < keys.length - 1) {
          current = current.length > 0 ? current[0] : null;
        }
      } else {
        // console.log(`[handleClick] Key "${key}" not found`);
        return null;
      }
    } else {
      return null;
    }
  }

  return current;
}

async function dynamicClick(fastify, process, event, session) {
  try {
    // 1. Get process configuration
    const configureProcessResult = await configureProcess(fastify, process);
    const { schema_json: schema_1, event_json: event_1 } = configureProcessResult[0];

    const schema_json = processSchemaEnvVariables(schema_1);
    const event_json = processEventEnvVariables(event_1);

    console.log("schema_json", JSON.stringify(schema_json, null, 2));
    console.log("event_json", JSON.stringify(event_json, null, 2));

    // Find the clicked button's configuration
    const clickedButton = schema_json.components.find(
      (component) =>
        component.key === Object.keys(event).find((key) => event[key] === true)
    );

    // If button has actionType: uiInstruction, handle UI instruction
    if (clickedButton?.actionType === "uiInstruction") {
      // Process UI instruction through controller
      const uiInstructionResult = await handleUIInstruction({
        eventData: event,
        customType: clickedButton.customType,
        affects: clickedButton.affects,
      });

      return {
        success: true,
        actionType: "uiInstruction",
        customType: clickedButton.customType,
        affects: clickedButton.affects,
        instruction: uiInstructionResult.data,
      };
    }

    // Handle updateComponent flow with affects and dependsOn support
    if (clickedButton?.actionType === "updateComponent") {
      let apiData = {};
      let graphQLData = {};

      // 1. Execute GraphQL query if configured
      if (event_json.onClick?.graph) {
        const graphQLRequest = {
          graph: {
            ...event_json.onClick.graph,
            variables: {
              ...event_json.onClick.graph.variables,
            },
          },
        };

        // Replace template variables
        Object.keys(graphQLRequest.graph.variables).forEach((key) => {
          const value = graphQLRequest.graph.variables[key];
          if (
            typeof value === "string" &&
            value.startsWith("${") &&
            value.endsWith("}")
          ) {
            const eventKey = value.slice(2, -1);
            graphQLRequest.graph.variables[key] = event[eventKey];
          }
        });

        const graphQLResult = await configureQuery(null, graphQLRequest);
        if (graphQLResult?.data?.[0]?.graph) {
          graphQLData = graphQLResult.data[0].graph;
        }
      }

      // 2. Execute REST API calls if configured
      if (event_json.onClick?.api) {
        const apiRequest = {
          api: {},
        };

        // Add graph data to event data for API calls that depend on GraphQL results
        const eventDataWithGraph = {
          ...event,
          graph: graphQLData,
        };

        // Process API requests
        Object.entries(event_json.onClick.api).forEach(([key, config]) => {
          apiRequest.api[key] = config;
        });

        // console.log("Sending API request:", JSON.stringify(apiRequest, null, 2));
        apiData = await loadInitialApiData(apiRequest, eventDataWithGraph);
      }

      // 3. Combine API and GraphQL data
      const combinedData = {
        api: apiData,
        graph: graphQLData,
      };

      // 4. Pre-process untuk datagrid components
      const preProcessedComponents = schema_json.components.map((component) => {
        if (component.type === "datagrid") {
          // console.log(`[handleClick] Pre-processing datagrid: ${component.key}`);

          // Buat mapping untuk components yang memiliki apiSource
          const apiComponentMap = {};
          component.components.forEach((sc) => {
            if (sc.type === "content" || !sc.apiSource) return;
            const source = sc.apiSource.source;
            if (!apiComponentMap[source]) {
              apiComponentMap[source] = [];
            }
            apiComponentMap[source].push(sc);
          });

          // Proses data grid dengan mengikuti logika dari datagrid.js
          const newDefaultValue = [];

          // Handle Graph data
          if (combinedData.graph) {
            // Cek jika ada table property di component
            const tablePath = component.table || component.source;
            // console.log(`[handleClick] Looking for datagrid data in table: ${tablePath}`);

            let graphData = null;

            // Coba cari data berdasarkan table path
            if (tablePath && tablePath.includes(".")) {
              graphData = getNestedData(combinedData.graph, tablePath);
              // console.log(`[handleClick] Found nested graph data for ${tablePath}:`,
              //   Array.isArray(graphData) ? `Array(${graphData.length})` : typeof graphData);
            } else if (tablePath && combinedData.graph[tablePath]) {
              graphData = combinedData.graph[tablePath];
              // console.log(`[handleClick] Found direct graph data for ${tablePath}:`,
              //   Array.isArray(graphData) ? `Array(${graphData.length})` : typeof graphData);
            } else {
              // Jika tidak ada table/source, coba cari di root level
              Object.entries(combinedData.graph).forEach(([key, data]) => {
                if (Array.isArray(data) && data.length > 0) {
                  graphData = data;
                  // console.log(`[handleClick] Found graph data in root key ${key}:`, `Array(${data.length})`);
                }
              });
            }

            // Proses data yang ditemukan
            if (Array.isArray(graphData)) {
              graphData.forEach((item, idx) => {
                const row = {};
                // Copy semua field dari graph data
                Object.keys(item).forEach((key) => {
                  row[key] = item[key];
                });

                // Set default values untuk components
                component.components.forEach((sc) => {
                  if (sc.key === "image") {
                    row[sc.key] = "unknown";
                  } else if (row[sc.key] === undefined) {
                    row[sc.key] = null;
                  }
                });

                // Tambahkan index untuk referensi
                row._index = idx;
                newDefaultValue.push(row);
                // console.log(`[handleClick] Processed row ${idx} for ${component.key}:`, Object.keys(row));
              });
            }
          }

          // Handle API data untuk image dan field lainnya
          if (combinedData.api && Object.keys(apiComponentMap).length > 0) {
            // console.log(`[handleClick] Processing API data for datagrid ${component.key}`);

            Object.entries(apiComponentMap).forEach(
              ([source, apiComponents]) => {
                const apiItems = combinedData.api[source];
                // console.log(`[handleClick] API source ${source}:`,
                //   Array.isArray(apiItems) ? `Array(${apiItems.length})` : typeof apiItems);

                if (Array.isArray(apiItems)) {
                  // Jika belum ada data dari graph, buat rows baru dari API
                  if (newDefaultValue.length === 0) {
                    apiItems.forEach((apiItem, idx) => {
                      const row = { _index: idx };
                      apiComponents.forEach((sc) => {
                        const valKey = sc.apiSource.valueKey || sc.key;
                        row[sc.key] =
                          apiItem[valKey] ||
                          (sc.key === "image" ? "unknown" : null);
                      });
                      newDefaultValue.push(row);
                    });
                  } else {
                    // Update existing rows dengan API data
                    newDefaultValue.forEach((row, rowIndex) => {
                      const apiItem = apiItems[rowIndex];
                      if (apiItem) {
                        apiComponents.forEach((sc) => {
                          const valKey = sc.apiSource.valueKey || sc.key;
                          if (sc.key === "image") {
                            const imageValue = apiItem[valKey];
                            if (imageValue && imageValue !== "") {
                              row[sc.key] = imageValue;
                              // console.log(`[handleClick] Updated image for row ${rowIndex}`);
                            }
                          } else {
                            row[sc.key] = apiItem[valKey] || row[sc.key];
                          }
                        });
                      }
                    });
                  }
                }
              }
            );
          }

          // Final validation untuk datagrid
          if (newDefaultValue.length === 0) {
            // console.log(`[handleClick] No data found for datagrid ${component.key}, creating empty row`);
            const emptyRow = {};
            component.components.forEach((sc) => {
              if (sc.key === "image") {
                emptyRow[sc.key] = "unknown";
              } else {
                emptyRow[sc.key] = null;
              }
            });
            newDefaultValue.push(emptyRow);
          }

          // console.log(`[handleClick] Final datagrid ${component.key} data:`, {
          //   rowCount: newDefaultValue.length,
          //   sampleFields: newDefaultValue.length > 0 ? Object.keys(newDefaultValue[0]) : []
          // });

          const updatedComponent = {
            ...component,
            defaultValue: newDefaultValue,
            type: "datagrid",
            input: true,
            rows: newDefaultValue.length,
            data: {
              values: newDefaultValue,
            },
            preProcessed: true, // Flag khusus untuk pre-processing
            _processedAt: new Date().toISOString(),
          };

          // console.log(`[handleClick] Pre-processed datagrid ${component.key}:`, {
          //   rowCount: newDefaultValue.length,
          //   hasDefaultValue: !!updatedComponent.defaultValue,
          //   defaultValueLength: updatedComponent.defaultValue?.length
          // });

          return updatedComponent;
        }
        return component;
      });

      // 4.1 Process all components with the combined data
      const updatedComponents = await processComponents(
        preProcessedComponents,
        combinedData,
        event,
        clickedButton
      );

      // console.log("[handleClick] Initial components processed:", updatedComponents.length);

      // 5. Process affects and dependsOn relationships dengan referensi dari datagrid.js
      let affectedComponents = updatedComponents.map((component) => {
        // Jika komponen tidak memiliki dependsOn dan tidak dalam affects,
        // langsung set default value dari event
        if (
          !component.dependsOn &&
          (!clickedButton.affects ||
            !clickedButton.affects.includes(component.key))
        ) {
          // console.log(`[handleClick] Setting direct value for ${component.key} from event`);
          return {
            ...component,
            defaultValue: event[component.key] || null,
            updated: true,
          };
        }
        return component;
      });
      if (clickedButton.affects) {
        // console.log("[handleClick] Processing affects for:", clickedButton.affects);

        // Filter components yang affected
        const affectedKeys = clickedButton.affects;
        affectedComponents = affectedComponents.map((component) => {
          // Handle pre-processed components
          if (component.preProcessed && component.type === "datagrid") {
            if (affectedKeys.includes(component.key)) {
              // console.log(`[handleClick] Using pre-processed data for datagrid: ${component.key}`);
              return {
                ...component,
                updated: true,
                _processedAt: new Date().toISOString(),
              };
            }
          }

          // Skip components that are already processed by affects
          if (component.updated && !component.preProcessed) {
            // console.log(`[handleClick] Skipping already processed component: ${component.key}`);
            return component;
          }
          if (affectedKeys.includes(component.key)) {
            // Validasi dependsOn harus array
            const dependencies = Array.isArray(component.dependsOn)
              ? component.dependsOn
              : typeof component.dependsOn === "string"
              ? [component.dependsOn]
              : [];

            // Cek apakah ada dependency yang aktif
            const hasActiveDependency =
              dependencies.length === 0 ||
              dependencies.some((dep) => event[dep]);

            if (hasActiveDependency) {
              // console.log(`[handleClick] Processing component ${component.key} with dependencies:`, dependencies);
              const processedData = {};

              // Proses Graph Data
              if (combinedData.graph) {
                // Support untuk nested path seperti di datagrid
                if (component.graphPath && component.graphPath.includes(".")) {
                  const nestedData = getNestedData(
                    combinedData.graph,
                    component.graphPath
                  );
                  if (nestedData) {
                    processedData.graph = nestedData;
                    // console.log(`[handleClick] Found nested graph data for ${component.key} at path: ${component.graphPath}`);
                  }
                } else {
                  processedData.graph = combinedData.graph[component.key] || [];
                  // console.log(`[handleClick] Using direct graph data for ${component.key}`);
                }
              }

              // Proses API Data
              if (combinedData.api && combinedData.api[component.key]) {
                const apiData = combinedData.api[component.key];
                // Handle array atau single object dari API
                processedData.api = Array.isArray(apiData)
                  ? apiData
                  : [apiData];
                // console.log(`[handleClick] Processed API data for ${component.key}: ${processedData.api.length} items`);
              }

              let defaultValue;

              if (component.type === "datagrid") {
                // Untuk datagrid, kita perlu memproses data dengan lebih detail
                const gridData = [];

                // 1. Coba ambil dari Graph terlebih dahulu
                if (processedData.graph && Array.isArray(processedData.graph)) {
                  processedData.graph.forEach((item) => {
                    const row = {};
                    // Copy semua field dari graph data
                    Object.keys(item).forEach((key) => {
                      row[key] = item[key];
                    });

                    // Set default untuk field image
                    if (component.components) {
                      component.components.forEach((sc) => {
                        if (sc.key === "image") {
                          row[sc.key] = "unknown";
                        } else if (row[sc.key] === undefined) {
                          row[sc.key] = null;
                        }
                      });
                    }

                    gridData.push(row);
                  });
                }

                // 2. Apply API data jika ada
                if (processedData.api && component.components) {
                  const apiComponentMap = {};
                  component.components.forEach((sc) => {
                    if (sc.apiSource) {
                      const source = sc.apiSource.source;
                      if (!apiComponentMap[source]) {
                        apiComponentMap[source] = [];
                      }
                      apiComponentMap[source].push(sc);
                    }
                  });

                  Object.entries(apiComponentMap).forEach(
                    ([source, apiComponents]) => {
                      const apiItems = processedData.api[source];
                      if (Array.isArray(apiItems)) {
                        gridData.forEach((row, rowIndex) => {
                          const apiItem = apiItems[rowIndex];
                          if (apiItem) {
                            apiComponents.forEach((sc) => {
                              const valKey = sc.apiSource.valueKey || sc.key;
                              if (sc.key === "image") {
                                row[sc.key] = apiItem[valKey] || "unknown";
                              } else {
                                row[sc.key] = apiItem[valKey] || row[sc.key];
                              }
                            });
                          }
                        });
                      }
                    }
                  );
                }

                defaultValue = gridData.length > 0 ? gridData : [];

                // console.log(`[handleClick] Processed datagrid ${component.key}:`, {
                //   rowCount: gridData.length,
                //   hasGraphData: !!processedData.graph,
                //   hasApiData: !!processedData.api,
                //   fields: gridData.length > 0 ? Object.keys(gridData[0]) : []
                // });
              } else {
                // Untuk komponen non-datagrid
                defaultValue =
                  processedData.api || event[component.key] || null;
              }

              // console.log(`[handleClick] Setting processed value for ${component.key}:`, {
              //   type: component.type,
              //   hasGraph: !!processedData.graph,
              //   hasApi: !!processedData.api,
              //   finalValue: component.type === 'datagrid' ? `Array(${defaultValue.length})` : defaultValue
              // });

              const processedComponent = {
                ...component,
                data: processedData.graph || [],
                defaultValue: defaultValue,
                updated: true, // Menandai bahwa sudah diproses oleh affects
                preProcessed: false, // Reset flag pre-processing
                _processedAt: new Date().toISOString(),
              };

              // console.log(`[handleClick] Fully processed component ${component.key}:`, {
              //   type: component.type,
              //   defaultValueType: Array.isArray(defaultValue) ? 'array' : typeof defaultValue,
              //   length: Array.isArray(defaultValue) ? defaultValue.length : undefined
              // });

              return processedComponent;
            }
          }
          return component;
        });
      }

      // 6. Filter komponen yang perlu direturn (hanya yang dependsOn atau affects)
      const componentsToReturn = affectedComponents.filter((component) => {
        // Log current component state
        // console.log(`[handleClick] Checking component ${component.key}:`, {
        //   type: component.type,
        //   hasDefaultValue: !!component.defaultValue,
        //   defaultValueLength: Array.isArray(component.defaultValue) ? component.defaultValue.length : undefined,
        //   preProcessed: !!component.preProcessed,
        //   updated: !!component.updated,
        //   inAffects: clickedButton.affects?.includes(component.key)
        // });

        // Include jika komponen ada dalam affects
        if (
          clickedButton.affects &&
          clickedButton.affects.includes(component.key)
        ) {
          // Untuk datagrid, pastikan defaultValue tetap terbawa
          if (component.type === "datagrid" && component.defaultValue) {
            // console.log(`[handleClick] Including datagrid ${component.key} with ${component.defaultValue.length} rows`);
            return true;
          }
          // console.log(`[handleClick] Including ${component.key} (in affects list)`);
          return true;
        }

        // Include jika komponen memiliki dependsOn yang aktif
        if (component.dependsOn) {
          const dependencies = Array.isArray(component.dependsOn)
            ? component.dependsOn
            : typeof component.dependsOn === "string"
            ? [component.dependsOn]
            : [];

          const hasActiveDependency = dependencies.some((dep) => event[dep]);
          if (hasActiveDependency) {
            // console.log(`[handleClick] Including ${component.key} (has active dependency)`);
            return true;
          }
        }

        // console.log(`[handleClick] Excluding ${component.key} (no affects/dependsOn match)`);
        return false;
      });

      // console.log(`[handleClick] Returning ${componentsToReturn.length} of ${affectedComponents.length} components`);

      // Return hanya komponen yang relevan
      return {
        success: true,
        actionType: "updateComponent",
        updatedComponents: componentsToReturn,
        data: combinedData,
        affects: clickedButton.affects,
        originalSchema: schema_json,
      };
    }

    // If no specific handling needed, return original schema
    return {
      success: false,
      message: "No valid action type found",
      originalSchema: schema_json,
      eventJson: event_json,
      eventData: event,
    };
  } catch (error) {
    console.error("Error in dynamicClick:", error);
    throw new Error(`Failed to configure process: ${error.message}`);
  }
}

module.exports = dynamicClick;
