// loadInitialApiDataFull.js
const fetchApiData = require("./fetchApiData");

async function loadInitialApiData(apiRequest, eventData) {
  console.log("Received API request:", JSON.stringify(apiRequest, null, 2));
  console.log("Event data:", JSON.stringify(eventData, null, 2));

  const results = {};

  try {
    if (apiRequest?.api) {
      const apiPromises = Object.entries(apiRequest.api).map(async ([key, config]) => {
        try {
          const configString = JSON.stringify(config);

          const dynamicTemplateRegex = /\$\{graph\.[^}\[]+\}/g; // mendeteksi template seperti ${graph.mo_order_shop.part_pk}
          const hasGraphTemplate = dynamicTemplateRegex.test(configString);
          const hasGraphArray = eventData.graph && Object.values(eventData.graph).some(val => Array.isArray(val));
          const needsArrayProcessing = hasGraphTemplate && hasGraphArray;

          if (!config.path) return { key, result: null };

          let processedConfigs = [];

          if (needsArrayProcessing) {
            const graphArrays = Object.entries(eventData.graph).filter(([_, val]) => Array.isArray(val));
            if (graphArrays.length > 0) {
              const [arrayKey, arrayValue] = graphArrays[0];
              for (let i = 0; i < arrayValue.length; i++) {
                const processedPath = {};
                for (const [pathKey, pathValue] of Object.entries(config.path)) {
                  if (typeof pathValue === 'string' && pathValue.startsWith("${") && pathValue.endsWith("}")) {
                    // otomatis inject index ke template yang tidak punya [i]
                    let template = pathValue;
                    if (!/\[\d+\]/.test(template)) {
                      template = template.replace(/(graph\.[^}\[]+)/, `$1[${i}]`);
                    }
                    processedPath[pathKey] = template;
                  } else {
                    processedPath[pathKey] = pathValue;
                  }
                }
                processedConfigs.push({ ...config, path: processedPath });
              }
            }
          } else {
            const processedPath = {};
            for (const [pathKey, pathValue] of Object.entries(config.path)) {
              processedPath[pathKey] = pathValue;
            }
            processedConfigs.push({ ...config, path: processedPath });
          }

          const resultsPerConfig = await Promise.all(
            processedConfigs.map(cfg => fetchApiData(cfg, eventData))
          );

          return { key, result: resultsPerConfig };
        } catch (error) {
          console.error(`Error processing API request for ${key}:`, error);
          return { key, result: null };
        }
      });

      const apiResults = await Promise.all(apiPromises);
      apiResults.forEach(({ key, result }) => {
        if (result !== null) {
          results[key] = result;
        }
      });
    }

    return results;
  } catch (error) {
    console.error("Error in loadInitialApiData:", error);
    return {};
  }
}

module.exports = loadInitialApiData;
