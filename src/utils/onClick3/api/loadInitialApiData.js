// loadInitialApiDataFull.js
const fetchApiData = require("./fetchApiData");

async function loadInitialApiData(apiRequest, eventData) {
  // console.log("Received API request:", JSON.stringify(apiRequest, null, 2));
  // console.log("Event data:", JSON.stringify(eventData, null, 2));

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
                    // tambahkan index array ke path yang sudah ada
                    let template = pathValue;
                    if (template.includes('${graph.') && !template.includes('[')) {
                      const lastDotIndex = template.lastIndexOf('.');
                      template = template.slice(0, lastDotIndex) + `[${i}]` + template.slice(lastDotIndex);
                    }
                    processedPath[pathKey] = template;
                  } else {
                    processedPath[pathKey] = pathValue;
                  }
                }
                // Add defaultValue from the graphArray
                const defaultValue = arrayValue[i];
                processedConfigs.push({ 
                  ...config, 
                  path: processedPath,
                  defaultValue: defaultValue
                });
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
            processedConfigs.map(async cfg => {
              const apiResult = await fetchApiData(cfg, eventData);
              return {
                ...apiResult,
                ...cfg.defaultValue, // Merge with defaultValue from graph data
                image: apiResult?.image || '',
                image_preview: apiResult?.image ? `https://mirorim.ddns.net:8111${apiResult.image}` : '',
                thumbnail: apiResult?.thumbnail ? `https://mirorim.ddns.net:8111${apiResult.thumbnail}` : ''
              };
            })
          );

          // Check if this is an array result that needs to match eventData structure
          const matchingGraphArray = Object.entries(eventData.graph).find(([_, val]) => Array.isArray(val));
          if (matchingGraphArray && resultsPerConfig.length > 0) {
            // Return results with properly formatted data
            return { 
              key, 
              result: resultsPerConfig.map(result => ({
                ...result,
                image_preview: result.image ? 
                  `<div style='text-align:center;'><img class='zoom-image' src='${result.image_preview}' alt='Gambar Produk' style='max-width:100px; height:auto;'/></div>` 
                  : ''
              }))
            };
          } else {
            return { key, result: resultsPerConfig };
          }
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
