const fetchApiData = require("./fetchApiData");
const updateComponent = require("../process/updateComponent");

function extractArrayValues(data, template) {
  const path = template.replace(/\$\{|\}/g, "");
  const pathParts = path.split(".");
  let currentData = data;
  if (Array.isArray(currentData)) currentData = currentData[0];
  for (let i = 0; i < pathParts.length; i++) {
    if (!currentData) return [];
    if (Array.isArray(currentData)) {
      currentData = currentData.flatMap((item) => item[pathParts[i]]);
    } else {
      currentData = currentData[pathParts[i]];
    }
  }
  if (Array.isArray(currentData)) return currentData.filter(Boolean);
  if (currentData !== undefined && currentData !== null) return [currentData];
  return [];
}

function getValueByPath(obj, path, index = null) {
  if (!obj) return "";
  const normalizedPath = path.replace(/\[(\d+)\]/g, ".$1");
  const keys = normalizedPath.split(".");
  let result = obj;
  if (Array.isArray(obj) && keys.length === 1) {
    const values = obj.map((item) => item[keys[0]]).filter(Boolean);
    if (values.length > 0) return values[0];
  }
  if (Array.isArray(obj)) obj = obj[0];
  result = obj;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (!result) return "";
    if (Array.isArray(result)) result = result[0];
    result = result[key];
  }
  if (Array.isArray(result) && result.length > 0) result = result[0];
  return result !== undefined ? result : "";
}

function resolveTemplate(str, data, index = null) {
  const result = str.replace(/\$\{([^}]+)\}/g, (_, expr) => {
    try {
      const value = getValueByPath(data, expr, index);
      return value;
    } catch {
      return "";
    }
  });
  return result;
}

function getApiDependencies(config) {
  const apiDeps = new Set();
  
  // Helper function to extract API dependencies from any string value
  const extractApiDeps = (value) => {
    if (typeof value === "string" && value.includes("${api.")) {
      const matches = value.match(/\$\{api\.([^.}]+)/g) || [];
      matches.forEach((match) => {
        const apiKey = match.replace("${api.", "");
        apiDeps.add(apiKey);
      });
    }
  };
  
  // Check all possible locations for API dependencies
  if (config.path) {
    Object.values(config.path).forEach(extractApiDeps);
  }
  
  if (config.url) {
    extractApiDeps(config.url);
  }
  
  if (config.params) {
    Object.values(config.params).forEach(extractApiDeps);
  }
  
  if (config.data) {
    if (typeof config.data === "string") {
      extractApiDeps(config.data);
    } else {
      Object.values(config.data).forEach(extractApiDeps);
    }
  }
  
  if (config.headers) {
    Object.values(config.headers).forEach(extractApiDeps);
  }
  
  return Array.from(apiDeps);
}

function getGraphDependencies(config) {
  const configStr = JSON.stringify(config);
  const graphDeps = new Set();
  const matches = configStr.match(/\$\{graph\.([^}]+)\}/g) || [];
  matches.forEach((match) => {
    const path = match.replace(/\$\{graph\.|\}/g, "");
    graphDeps.add(path);
  });
  return Array.from(graphDeps);
}

function areApiDependenciesReady(apiDeps, formState) {
  for (const apiKey of apiDeps) {
    if (!formState.apiResults[apiKey]) {
      // console.log(`[areApiDependenciesReady] Missing API result for: ${apiKey}`);
      return false;
    }
    const result = formState.apiResults[apiKey];
    if (!result || (Array.isArray(result) && result.length === 0)) {
      // console.log(`[areApiDependenciesReady] Empty result for API: ${apiKey}`);
      return false;
    }
  }
  return true;
}

function areGraphDependenciesReady(graphDeps, processedQueryData) {
  for (const path of graphDeps) {
    const value = getValueByPath(processedQueryData, `graph.${path}`);
    if (value === undefined || value === "" || value === null) return false;
  }
  return true;
}

function resolveApiConfigTemplates(config, formState, processedQueryData) {
  // Check if this config needs to be expanded for array data
  const configStr = JSON.stringify(config);
  const apiTemplateMatches = configStr.match(/\$\{api\.([^}]+)\}/g) || [];
  
  // Find if any template references an array field
  let arrayApiKey = null;
  let arrayFieldPath = null;
  let arrayData = null;
  
  for (const match of apiTemplateMatches) {
    const path = match.replace(/\$\{api\.|\}/g, "");
    const [apiKey, ...fieldParts] = path.split(".");
    const fieldPath = fieldParts.join(".");
    const apiResult = formState.apiResults[apiKey];
    
    if (Array.isArray(apiResult) && fieldPath) {
      arrayApiKey = apiKey;
      arrayFieldPath = fieldPath;
      arrayData = apiResult;
      // console.log(`[resolveApiConfigTemplates] Found array data for expansion: ${apiKey}.${fieldPath} (${arrayData.length} items)`);
      break;
    }
  }
  
  // If we found array data, create multiple configs
  if (arrayData && arrayData.length > 0) {
    // console.log(`[resolveApiConfigTemplates] Creating ${arrayData.length} configs for array data from ${arrayApiKey}.${arrayFieldPath}`);
    
    return arrayData.map((item, index) => {
      let itemConfigStr = JSON.stringify(config);
      
      itemConfigStr = itemConfigStr.replace(/\$\{api\.([^}]+)\}/g, (match, path) => {
        const [apiKey, ...fieldParts] = path.split(".");
        const fieldPath = fieldParts.join(".");
        const apiResult = formState.apiResults[apiKey];

        // console.log(`[resolveApiConfigTemplates] Processing ${match} for item ${index}:`, {
        //   apiKey,
        //   fieldPath,
        //   isArrayMatch: apiKey === arrayApiKey && fieldPath === arrayFieldPath
        // });

        if (!apiResult) {
          // console.log(`[resolveApiConfigTemplates] No result for API ${apiKey}`);
          return '""';
        }

        let value;
        if (fieldPath) {
          if (apiKey === arrayApiKey && fieldPath === arrayFieldPath) {
            // Use the current array item's field
            const parts = fieldPath.split('.');
            value = item;
            for (const part of parts) {
              value = value?.[part];
              if (value === undefined || value === null) break;
            }
            // console.log(`[resolveApiConfigTemplates] Extracted from current array item[${index}]:`, value);
          } else if (Array.isArray(apiResult)) {
            // For other array results, extract ALL matching values and use appropriate one
            const allValues = apiResult.map(resultItem => {
              const parts = fieldPath.split('.');
              let val = resultItem;
              for (const part of parts) {
                val = val?.[part];
                if (val === undefined || val === null) break;
              }
              return val;
            }).filter(val => val !== undefined && val !== null);
            
            // Use the first available value or try to match by index
            value = allValues[Math.min(index, allValues.length - 1)] || allValues[0];
            // console.log(`[resolveApiConfigTemplates] Extracted from array[${index}] of ${allValues.length} values:`, value);
          } else {
            // For single object results
            const parts = fieldPath.split('.');
            value = apiResult;
            for (const part of parts) {
              value = value?.[part];
              if (value === undefined || value === null) break;
            }
            // console.log(`[resolveApiConfigTemplates] Extracted from object:`, value);
          }
        } else {
          value = apiResult;
        }
        
        if (value === undefined || value === null) {
          // console.log(`[resolveApiConfigTemplates] No value found for ${match}`);
          return '""';
        }
        
        // console.log(`[resolveApiConfigTemplates] Final value for ${match}:`, value);
        return JSON.stringify(value);
      });

      itemConfigStr = itemConfigStr.replace(/\$\{graph\.([^}]+)\}/g, (match, path) => {
        const value = getValueByPath(processedQueryData, `graph.${path}`);
        if (value === undefined || value === null) return '""';
        return JSON.stringify(value);
      });

      try {
        const resolvedConfig = JSON.parse(itemConfigStr);
        
        // Remove any unwanted fields that might have been added
        if (resolvedConfig.responseKey && resolvedConfig.responseKey === "results") {
          // console.log(`[resolveApiConfigTemplates] Removing incorrect responseKey from config`);
          delete resolvedConfig.responseKey;
        }
        
        return resolvedConfig;
      } catch (parseError) {
        console.error(`[resolveApiConfigTemplates] JSON parse error for item ${index}:`, parseError);
        console.error(`[resolveApiConfigTemplates] Problematic JSON string:`, itemConfigStr);
        return null;
      }
    }).filter(config => config !== null); // Remove any failed configs
  }
  
  // Single config resolution (original logic)
  let resolvedConfigStr = configStr;
  
  resolvedConfigStr = resolvedConfigStr.replace(/\$\{api\.([^}]+)\}/g, (match, path) => {
    const [apiKey, ...fieldParts] = path.split(".");
    const fieldPath = fieldParts.join(".");
    const apiResult = formState.apiResults[apiKey];
    
      // console.log(`[resolveApiConfigTemplates] Processing ${match}:`, {
      //   apiKey,
      //   fieldPath,
      //   apiResult: apiResult ? `${Array.isArray(apiResult) ? 'Array[' + apiResult.length + ']' : 'Object'}` : 'null'
      // });
    
    if (!apiResult) {
     // console.log(`[resolveApiConfigTemplates] No result for API ${apiKey}`);
      return '""';
    }

    let value;
    if (fieldPath) {
      if (Array.isArray(apiResult)) {
        // For array results, try to get the first valid value
        for (const resultItem of apiResult) {
          const parts = fieldPath.split('.');
          let tempValue = resultItem;
          for (const part of parts) {
            tempValue = tempValue?.[part];
            if (tempValue === undefined || tempValue === null) break;
          }
          if (tempValue !== undefined && tempValue !== null) {
            value = tempValue;
            break;
          }
        }
        // console.log(`[resolveApiConfigTemplates] Extracted from array (first valid):`, value);
      } else {
        // For single object results
        const parts = fieldPath.split('.');
        value = apiResult;
        for (const part of parts) {
          value = value?.[part];
          if (value === undefined || value === null) break;
        }
        // console.log(`[resolveApiConfigTemplates] Extracted from object:`, value);
      }
    } else {
      value = apiResult;
    }
    
    if (value === undefined || value === null) {
      // console.log(`[resolveApiConfigTemplates] No value found for ${match}`);
      return '""';
    }

    // console.log(`[resolveApiConfigTemplates] Final value for ${match}:`, value);
    return JSON.stringify(value);
  });

  resolvedConfigStr = resolvedConfigStr.replace(/\$\{graph\.([^}]+)\}/g, (match, path) => {
    const value = getValueByPath(processedQueryData, `graph.${path}`);
    if (value === undefined || value === null) return '""';
    return JSON.stringify(value);
  });

  try {
    const resolvedConfig = JSON.parse(resolvedConfigStr);
    
    // Remove any unwanted fields that might have been added
    if (resolvedConfig.responseKey && resolvedConfig.responseKey === "results") {
      // console.log(`[resolveApiConfigTemplates] Removing incorrect responseKey from single config`);
      delete resolvedConfig.responseKey;
    }
    
    return resolvedConfig;
  } catch (parseError) {
    console.error(`[resolveApiConfigTemplates] JSON parse error for single config:`, parseError);
    console.error(`[resolveApiConfigTemplates] Problematic JSON string:`, resolvedConfigStr);
    return config; // Return original config if parsing fails
  }
}

function resolveApiConfigs(apiConfigs, processedQueryData) {
  const resolvedConfigs = {};
  for (const [key, config] of Object.entries(apiConfigs)) {
    // Handle 'in' params - support multiple 'in' parameters
    if (config.in) {
      const resolvedConfig = { ...config };
      if (typeof resolvedConfig.url === "string") {
        resolvedConfig.url = resolveTemplate(
          resolvedConfig.url,
          processedQueryData
        );
      }
      const inParams = {};
      // console.log(`[resolveApiConfigs] Processing ${Object.keys(config.in).length} 'in' parameters for ${key}:`, Object.keys(config.in));
      
      for (const [paramKey, paramTemplate] of Object.entries(config.in)) {
        if (typeof paramTemplate === "string") {
          const values = extractArrayValues(processedQueryData, paramTemplate);
          const resolvedValue = values.length > 0
            ? values.join(",")
            : resolveTemplate(paramTemplate, processedQueryData);
          inParams[paramKey] = resolvedValue;
          // console.log(`[resolveApiConfigs] 'in' param "${paramKey}": template "${paramTemplate}" → "${resolvedValue}" (${values.length} values)`);
        } else {
          inParams[paramKey] = paramTemplate;
        }
      }
      resolvedConfig.params = { ...resolvedConfig.params, ...inParams };
      delete resolvedConfig.in;
      resolvedConfigs[key] = resolvedConfig;
      // console.log(`[resolveApiConfigs] ${key} resolved with ${Object.keys(inParams).length} 'in' params:`, Object.keys(inParams));
      continue;
    }

    // Check if this API config depends on other API results and should be processed as multiple calls
    const hasApiDependency = JSON.stringify(config).includes("${api.");
    if (hasApiDependency) {
      // For API-dependent configs, keep original config for later processing
      resolvedConfigs[key] = config;
      continue;
    }

    let arrayData = null;
    let hasArrayTemplate = false;
    let arrayTemplateKey = null;

    // Check path parameters for arrays - support multiple path params
    if (config.path) {
      // console.log(`[resolveApiConfigs] Checking ${Object.keys(config.path).length} path parameters for arrays in ${key}:`, Object.keys(config.path));
      for (const [paramKey, paramVal] of Object.entries(config.path)) {
        if (typeof paramVal === "string") {
          const values = extractArrayValues(processedQueryData, paramVal);
          if (values.length > 1) {
            arrayData = values;
            hasArrayTemplate = true;
            arrayTemplateKey = paramKey;
            console.log(`[resolveApiConfigs] Found array template in path param "${paramKey}": ${values.length} values`);
            break;
          }
        }
      }
    }

    // Check URL for arrays
    if (!hasArrayTemplate && typeof config.url === "string") {
      const values = extractArrayValues(processedQueryData, config.url);
      if (values.length > 1) {
        arrayData = values;
        hasArrayTemplate = true;
        arrayTemplateKey = null;
        console.log(`[resolveApiConfigs] Found array template in URL: ${values.length} values`);
      }
    }

    // Check query/params for arrays - support multiple query params
    if (!hasArrayTemplate && config.params) {
      // console.log(`[resolveApiConfigs] Checking ${Object.keys(config.params).length} query parameters for arrays in ${key}:`, Object.keys(config.params));
      for (const [paramKey, paramVal] of Object.entries(config.params)) {
        if (typeof paramVal === "string") {
          const values = extractArrayValues(processedQueryData, paramVal);
          if (values.length > 1) {
            arrayData = values;
            hasArrayTemplate = true;
            arrayTemplateKey = paramKey;
            console.log(`[resolveApiConfigs] Found array template in query param "${paramKey}": ${values.length} values`);
            break;
          }
        }
      }
    }

    if (hasArrayTemplate && arrayData) {
      // console.log(`[resolveApiConfigs] Creating ${arrayData.length} configurations for ${key} due to array template`);
      const configArray = arrayData.map((val, i) => {
        const arrayResolvedConfig = { ...config };
        if (typeof arrayResolvedConfig.url === "string") {
          arrayResolvedConfig.url =
            arrayTemplateKey === null
              ? resolveTemplate(arrayResolvedConfig.url, processedQueryData, i)
              : arrayResolvedConfig.url;
        }
        if (arrayResolvedConfig.path) {
          if (arrayTemplateKey) {
            arrayResolvedConfig.path = { ...arrayResolvedConfig.path };
            arrayResolvedConfig.path[arrayTemplateKey] = val;
          } else {
            arrayResolvedConfig.path = Object.fromEntries(
              Object.entries(arrayResolvedConfig.path).map(
                ([paramKey, paramVal]) => [
                  paramKey,
                  typeof paramVal === "string"
                    ? resolveTemplate(paramVal, processedQueryData, i)
                    : paramVal,
                ]
              )
            );
          }
        }
        if (arrayResolvedConfig.params) {
          if (arrayTemplateKey) {
            arrayResolvedConfig.params = { ...arrayResolvedConfig.params };
            arrayResolvedConfig.params[arrayTemplateKey] = val;
          } else {
            // Resolve all params with templates
            arrayResolvedConfig.params = Object.fromEntries(
              Object.entries(arrayResolvedConfig.params).map(
                ([paramKey, paramVal]) => [
                  paramKey,
                  typeof paramVal === "string"
                    ? resolveTemplate(paramVal, processedQueryData, i)
                    : paramVal,
                ]
              )
            );
          }
        }
        return arrayResolvedConfig;
      });
      resolvedConfigs[key] = configArray;
    } else {
      // Single config resolution - support multiple parameters
      const resolvedConfig = { ...config };
      if (typeof resolvedConfig.url === "string") {
        resolvedConfig.url = resolveTemplate(
          resolvedConfig.url,
          processedQueryData
        );
      }
      if (resolvedConfig.path) {
        // console.log(`[resolveApiConfigs] Resolving ${Object.keys(resolvedConfig.path).length} path parameters for ${key}`);
        resolvedConfig.path = Object.fromEntries(
          Object.entries(resolvedConfig.path).map(([paramKey, paramVal]) => [
            paramKey,
            typeof paramVal === "string"
              ? resolveTemplate(paramVal, processedQueryData)
              : paramVal,
          ])
        );
      }
      if (resolvedConfig.params) {
        // console.log(`[resolveApiConfigs] Resolving ${Object.keys(resolvedConfig.params).length} query parameters for ${key}`);
        resolvedConfig.params = Object.fromEntries(
          Object.entries(resolvedConfig.params).map(([paramKey, paramVal]) => [
            paramKey,
            typeof paramVal === "string"
              ? resolveTemplate(paramVal, processedQueryData)
              : paramVal,
          ])
        );
      }
      resolvedConfigs[key] = resolvedConfig;
    }
  }
  return resolvedConfigs;
}

async function executeApi(key, config, formState, additionalData = {}) {
  if (Array.isArray(config)) {
    // console.log(`[executeApi] ${key} executing ${config.length} configurations`);
    const results = await Promise.all(
      config.map(async (singleConfig, index) => {
        // console.log(`[executeApi] ${key}[${index}] executing config:`, JSON.stringify(singleConfig, null, 2));
        const result = await fetchApiData(singleConfig, additionalData, formState.data, {}, `${key}[${index}]`);
        // console.log(`[executeApi] ${key}[${index}] result:`, result ? `SUCCESS (${Array.isArray(result) ? 'Array[' + result.length + ']' : 'Object'})` : 'NULL');
        return result;
      })
    );

    const validResults = results.filter((result) => result !== null);
    // console.log(`[executeApi] ${key} array results: ${validResults.length}/${results.length} successful`);
    
    // Flatten array results if they are arrays themselves
    const flattenedResults = validResults.flat();
    // console.log(`[executeApi] ${key} flattened results: ${flattenedResults.length} items total`);

    return flattenedResults.length > 0 ? flattenedResults : null;
  } else {
    // console.log(`[executeApi] ${key} executing single config:`, JSON.stringify(config, null, 2));
    const result = await fetchApiData(config, additionalData, formState.data, {}, key);
    // console.log(`[executeApi] ${key} single result:`, result ? `SUCCESS (${Array.isArray(result) ? 'Array[' + result.length + ']' : 'Object'})` : 'NULL');
    return result;
  }
}

async function loadInitialApiData(
  apiConfigs,
  schema,
  processedQueryData,
  formState,
  session
) {
  if (!apiConfigs) return;

  const independentApis = [];
  const graphDependentApis = [];
  const apiDependentApis = [];

  for (const [key, config] of Object.entries(apiConfigs)) {
    const apiDeps = getApiDependencies(config);
    const graphDeps = getGraphDependencies(config);
    if (apiDeps.length > 0) {
      apiDependentApis.push({ key, config, apiDeps, graphDeps });
    } else if (graphDeps.length > 0) {
      graphDependentApis.push({ key, config, apiDeps, graphDeps });
    } else {
      independentApis.push({ key, config, apiDeps, graphDeps });
    }
  }

  // console.log(`[loadInitialApiData] API categorization:`, {
  //   independent: independentApis.map(a => a.key),
  //   graphDependent: graphDependentApis.map(a => a.key),
  //   apiDependent: apiDependentApis.map(a => a.key)
  // });

  const resolvedConfigs = resolveApiConfigs(apiConfigs, processedQueryData);
  independentApis.forEach((api) => (api.config = resolvedConfigs[api.key]));
  graphDependentApis.forEach((api) => (api.config = resolvedConfigs[api.key]));
  // Keep original configs for API-dependent ones as they need template resolution

  const completedApis = new Set();
  const pendingApis = [];

  // Execute independent APIs first
  if (independentApis.length > 0) {
    await Promise.all(
      independentApis.map(async ({ key, config }) => {
        try {
          const result = await executeApi(key, config, formState);
          if (result !== null) {
            formState.apiResults[key] = result;
            completedApis.add(key);
            // console.log(`[loadInitialApiData] Independent API ${key} completed successfully`);
          } else {
            // console.log(`[loadInitialApiData] Independent API ${key} returned null`);
          }
        } catch (error) {
          console.error(`[loadInitialApiData] Independent API ${key} failed:`, error.message);
        }
      })
    );
  }

  // Execute graph-dependent APIs
  for (const { key, config, graphDeps } of graphDependentApis) {
    try {
      if (areGraphDependenciesReady(graphDeps, processedQueryData)) {
        const result = await executeApi(key, config, formState);
        if (result !== null) {
          formState.apiResults[key] = result;
          completedApis.add(key);
          // console.log(`[loadInitialApiData] Graph-dependent API ${key} completed successfully`);
        } else {
          // console.log(`[loadInitialApiData] Graph-dependent API ${key} returned null`);
        }
      } else {
        // console.log(`[loadInitialApiData] Graph dependencies not ready for ${key}:`, graphDeps);
        pendingApis.push({ key, config, apiDeps: [], graphDeps });
      }
    } catch (error) {
      console.error(`[loadInitialApiData] Graph-dependent API ${key} failed:`, error.message);
    }
  }

  pendingApis.push(...apiDependentApis);

  // Remove iteration limit for unlimited chaining support
  let maxIterations = Math.max(50, Object.keys(apiConfigs).length * 3); // Dynamic limit based on API count
  let iteration = 0;
  let lastPendingCount = pendingApis.length;
  let stuckIterations = 0;

  while (pendingApis.length > 0 && iteration < maxIterations) {
    iteration++;
    // console.log(`[loadInitialApiData] Iteration ${iteration}, pending APIs:`, pendingApis.map(a => a.key));
    
    const readyApis = [];
    const stillPendingApis = [];

    for (const apiItem of pendingApis) {
      const { key, config, apiDeps, graphDeps } = apiItem;
      const apiDepsReady = areApiDependenciesReady(apiDeps, formState);
      const graphDepsReady = areGraphDependenciesReady(
        graphDeps,
        processedQueryData
      );
      
      // console.log(`[loadInitialApiData] Checking dependencies for ${key}:`, {
      //   apiDeps,
      //   graphDeps,
      //   apiDepsReady,
      //   graphDepsReady,
      //   availableApis: Object.keys(formState.apiResults)
      // });
      
      if (apiDepsReady && graphDepsReady) {
        readyApis.push(apiItem);
      } else {
        stillPendingApis.push(apiItem);
      }
    }

    if (readyApis.length === 0) {
      // Check if we're stuck (no progress)
      if (pendingApis.length === lastPendingCount) {
        stuckIterations++;
        if (stuckIterations >= 3) {
          console.warn(`[loadInitialApiData] Stuck after ${stuckIterations} iterations. Checking for circular dependencies...`);
          
          // Try to identify circular dependencies or missing data
          for (const apiItem of pendingApis) {
            const { key, config, apiDeps, graphDeps } = apiItem;
            console.error(`[loadInitialApiData] STUCK API "${key}":`, {
              apiDeps,
              graphDeps,
              availableApis: Object.keys(formState.apiResults),
              missingApiDeps: apiDeps.filter(dep => !formState.apiResults[dep]),
              missingGraphDeps: graphDeps.filter(dep => {
                const value = getValueByPath(processedQueryData, `graph.${dep}`);
                return value === undefined || value === "" || value === null;
              })
            });
          }
          break;
        }
      } else {
        stuckIterations = 0; // Reset if we made progress
      }
      
      // console.log(`[loadInitialApiData] No APIs ready in iteration ${iteration}, continuing...`);
      lastPendingCount = pendingApis.length;
      continue;
    }

    // console.log(`[loadInitialApiData] Processing ${readyApis.length} ready APIs:`, readyApis.map(a => a.key));

    await Promise.all(
      readyApis.map(async ({ key, config, apiDeps }) => {
        try {
          const resolvedConfig = resolveApiConfigTemplates(
            config,
            formState,
            processedQueryData
          );
          
          // console.log(`[loadInitialApiData] Resolved config for ${key}:`, JSON.stringify(resolvedConfig, null, 2));
          
          const result = await executeApi(key, resolvedConfig, formState);
          if (result !== null) {
            formState.apiResults[key] = result;
            completedApis.add(key);
            // console.log(`[loadInitialApiData] API-dependent API ${key} completed successfully`);
          } else {
            console.log(`[loadInitialApiData] API-dependent API ${key} returned null`);
          }
        } catch (error) {
          console.error(`[loadInitialApiData] API-dependent API ${key} failed:`, error.message);
        }
      })
    );

    pendingApis.length = 0;
    pendingApis.push(...stillPendingApis);
    
    // Update progress tracking
    lastPendingCount = pendingApis.length;
    if (pendingApis.length < lastPendingCount) {
      stuckIterations = 0; // Reset stuck counter if we made progress
    }
  }

  if (pendingApis.length > 0) {
    console.error(`[loadInitialApiData] ${pendingApis.length} APIs still pending after ${iteration} iterations (max: ${maxIterations}):`, 
      pendingApis.map(a => ({
        key: a.key,
        apiDeps: a.apiDeps,
        graphDeps: a.graphDeps,
        missingApiDeps: a.apiDeps.filter(dep => !formState.apiResults[dep]),
        missingGraphDeps: a.graphDeps.filter(dep => {
          const value = getValueByPath(processedQueryData, `graph.${dep}`);
          return value === undefined || value === "" || value === null;
        })
      })));
    
    // Log detailed analysis for debugging
    console.error(`[loadInitialApiData] Available API results:`, Object.keys(formState.apiResults));
    console.error(`[loadInitialApiData] Graph data keys:`, Object.keys(processedQueryData));
  }

  // Handle field dependencies
  if (formState.dependencies) {
    for (const [dependsOnKey, fieldKeys] of formState.dependencies.entries()) {
      const value = formState.data[dependsOnKey];
      if (!value) continue;
      for (const fieldKey of fieldKeys) {
        const component = schema.components.find((c) => c.key === fieldKey);
        const apiKey = component?.apiSource?.source;
        const config = resolvedConfigs[apiKey];
        if (config && !completedApis.has(apiKey)) {
          try {
            const result = await executeApi(apiKey, config, formState, {
              [dependsOnKey]: value,
            });
            if (result !== null) {
              formState.apiResults[apiKey] = result;
              updateComponent(component, result);
            }
          } catch (error) {
            console.error(`[loadInitialApiData] Field dependency API ${apiKey} failed:`, error.message);
          }
        }
      }
    }
  }

  console.log(`[loadInitialApiData] Final API results:`, {
    completed: Array.from(completedApis),
    total: Object.keys(apiConfigs).length
  });
}

module.exports = loadInitialApiData;
