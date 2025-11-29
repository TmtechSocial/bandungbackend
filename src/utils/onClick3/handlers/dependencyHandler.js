const loadInitialApiData = require("../api/loadInitialApiData");
const { configureQuery } = require("../../../controller/controllerConfig");

async function reQueryAffectedComponents(
  affects,
  dependsOn,
  event_json,
  event
) {
  const affectedData = {};
  let graphQLResult = null; // Store GraphQL result at higher scope
  console.log(
    "Requerying affected components:",
    affects,
    "Depends on:",
    dependsOn
  );

  // Iterate through each affected component
  for (const affectedKey of affects) {
    console.log("Requerying affected component:", affectedKey);

    // Handle GraphQL queries first
    if (event_json.onClick?.graph) {
      console.log("Handling GraphQL query for:", affectedKey);
      try {
        const request = {
          graph: {
            method: event_json.onClick.graph.method,
            endpoint: event_json.onClick.graph.endpoint,
            gqlQuery: event_json.onClick.graph.gqlQuery,
            variables: {
              ...event_json.onClick.graph.variables,
            },
          },
        };

        // Replace template variables in the request
        Object.keys(request.graph.variables).forEach((key) => {
          const value = request.graph.variables[key];
          if (
            typeof value === "string" &&
            value.startsWith("${") &&
            value.endsWith("}")
          ) {
            const eventKey = value.slice(2, -1);
            request.graph.variables[key] = event[eventKey];
          }
        });

        console.log("GraphQL Request:", JSON.stringify(request, null, 2));
        graphQLResult = await configureQuery(null, request);

        console.log(
          "GraphQL result for",
          affectedKey,
          ":",
          JSON.stringify(graphQLResult, null, 2)
        );
        if (graphQLResult?.data?.[0]?.graph) {
          affectedData[affectedKey] = { graph: graphQLResult.data[0].graph };
        }
      } catch (error) {
        console.error(`GraphQL query error for ${affectedKey}:`, error);
      }
    }

    // Handle REST API queries
    if (
      event_json.onClick?.api &&
      graphQLResult?.data?.[0]?.graph?.mo_order_shop
    ) {
      try {
        const apiRequest = {
          api: {},
        };

        // Get the list of part_pk from GraphQL result
        const orderItems = graphQLResult.data[0].graph.mo_order_shop;

        // Copy API configuration and create requests for each part_pk
        Object.entries(event_json.onClick.api).forEach(([key, config]) => {
          // Create a separate request for each part_pk
          orderItems.forEach((item) => {
            const part_pk = item.part_pk.toString();
            // Keep the original key format as defined in event.json
            const requestKey = `${key}`;
            console.log(
              `Creating API request for part_pk: ${part_pk} with key ${requestKey}`
            );

            if (!apiRequest.api[requestKey]) {
              apiRequest.api[requestKey] = {
                url: config.url,
                method: config.method,
                headers: config.headers,
                path: {
                  id: part_pk,
                },
                defaultValue: {
                  part_pk: item.part_pk,
                  product_name: item.product_name,
                  sku_toko: item.sku_toko,
                  quantity_convert: item.quantity_convert,
                },
              };
            }
          });
        });
        // console.log("API Request:", JSON.stringify(apiRequest, null, 2));
        const apiResult = await loadInitialApiData(apiRequest, event);
        // console.log("Raw API Result:", JSON.stringify(apiResult, null, 2));

        if (apiResult) {
          // Format data untuk komponen dengan hasil API yang benar
          const formattedData = {
            api: apiResult,
            data: orderItems.map((item) => {
              // Use the key as defined in event.json
              const imageData = apiResult?.imageFromPk || {};

              console.log(`Processing item ${item.part_pk}:`, {
                imageData,
                rawApiResult: apiResult,
              });

              return {
                key: item.part_pk.toString(),
                value: {
                  part_pk: item.part_pk,
                  product_name: item.product_name,
                  sku_toko: item.sku_toko,
                  quantity_convert: item.quantity_convert,
                  image: imageData.image || "", // For the hidden textfield
                  image_preview: imageData.image
                    ? `https://mirorim.ddns.net:8111${imageData.image}`
                    : "", // For the preview component
                  ...imageData, // Keep other data from API
                },
              };
            }),
            defaultValue: orderItems.map((item) => ({
              part_pk: item.part_pk,
              product_name: item.product_name,
              sku_toko: item.sku_toko,
              quantity_convert: item.quantity_convert,
            })),
          };

          affectedData[affectedKey] = formattedData;
          console.log(
            "Formatted component data:",
            JSON.stringify(formattedData, null, 2)
          );
        }
      } catch (error) {
        console.error(`API query error for ${affectedKey}:`, error);
      }
    }
  }

  return affectedData;
}

module.exports = {
  reQueryAffectedComponents,
};
