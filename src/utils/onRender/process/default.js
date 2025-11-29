/**
 * Helper function to get nested data using dot notation, including array indexes
 * @param {Object} obj - The object to traverse
 * @param {String} path - Dot notation path (e.g., "mo_retur_receive.invoice_retur_to_invoice[0].resi")
 * @returns {*} The value at the specified path or null if not found
 */
function getNestedData(obj, path) {
  if (!path || !obj) return null;

  // console.log('getNestedData called with path:', path);
  // console.log('Object to traverse:', JSON.stringify(obj, null, 2));
  // Convert array notation [0] into dot notation: a[0].b => a.0.b
  const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');

  // console.log('Parsed keys:', keys);

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

/**
 * Main function to process component's default value based on query data, API, or session
 * @param {Object} component - The form component
 * @param {Array} queryData - The array of query result data (from SQL or GraphQL)
 * @param {Object} formState - Current form state (including API results)
 * @param {Object} apiConfigs - API config (unused here, but reserved)
 * @param {Object} session - Session object
 */
function processDefaultComponent(component, queryData, formState, apiConfigs, session) {
  const { table, key, defaultValue } = component;
  let value = defaultValue;

  if (table) {
    queryData.forEach((queryItem) => {
      // Handle SQL data (flat table)
      if (queryItem.sqlQuery?.table === table) {
        const found = queryItem.sqlQuery.data.find((item) => item[key] !== undefined);
        if (found) {
          value = found[key];
        }
      }

      // Handle GraphQL data
      if (queryItem.graph) {
        const graph = queryItem.graph;

        // Direct match: table exists directly as array in graph
        if (graph[table]) {
          // console.log('Direct match found:', JSON.stringify(graph[table], null,2));
          const found = graph[table].find((item) => item[key] !== undefined);
          if (found) {
            value = found[key];
          }
        } else {
          // Try to access nested object/array using dot notation
          const nestedData = getNestedData(graph, table);
          // console.log('Nested data found:', JSON.stringify(nestedData, null, 2));

          if (Array.isArray(nestedData)) {
            const found = nestedData.find((item) => item[key] !== undefined);
            if (found) {
              value = found[key];
            }
          } else if (nestedData && typeof nestedData === 'object') {
            if (nestedData[key] !== undefined) {
              value = nestedData[key];
            }
          }
        }
      }
    });
  }

  // Handle data from API source
  if (component.apiSource) {
    // console.log('Processing API source for component: ', JSON.stringify(component, null, 2));
    const sourceKey = component.apiSource.source;
    // console.log(`Fetching API data for source: ${sourceKey}`);
    const apiData = formState.apiResults[sourceKey];
    // console.log(`API data for ${sourceKey}:`, JSON.stringify(apiData, null, 2));
    const { valueKey, dataPath = [] } = component.apiSource;
    // console.log(`Using valueKey: ${valueKey}, dataPath: ${dataPath}`);

    if (apiData) {
      const dataItems = Array.isArray(apiData) ? apiData : [apiData];
      // console.log(`Data items found: ${dataItems.length}`, JSON.stringify(dataItems, null, 2));
      if (dataItems.length > 0) {
        let val = dataItems[0];
        // console.log(`Initial value from API:`, JSON.stringify(val, null, 2));
        for (const path of dataPath) {
          val = val?.[path] ?? null;
        }

        if (valueKey && val?.[valueKey] !== undefined) {
          // console.log(`Setting value from API key "${valueKey}":`, val[valueKey]);
          value = val[valueKey];
          // console.log(`Final value set from API:`, value);
        } else if (val !== null) {
          value = val;
        }
      }
    }
  }

  // Handle session reference
  if (typeof value === 'string' && value.startsWith('session.')) {
    const sessionKey = value.split('.')[1];
    if (session?.[sessionKey] !== undefined) {
      value = session[sessionKey];
    }
  }

  component.defaultValue = value;
}

module.exports = processDefaultComponent;
