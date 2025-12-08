// onChange/utils/changeQueryProcessor.js

/**
 * Process query data specifically for onChange scenarios
 * @param {*} data - Raw query data
 * @param {Object} eventData - Change event data
 * @returns {Array} Processed query data
 */
function processChangeQueryData(data, eventData) {
  console.log('[onChange/utils] Processing query data for change event');
  
  // Handle null or undefined data
  if (!data) {
    console.warn('[onChange/utils] No query data provided');
    return [];
  }

  // Convert to array format for consistent processing
  let processedData = Array.isArray(data) ? data : [data];
  
  // Add event data context to each query item
  if (eventData) {
    const eventKey = Object.keys(eventData)[0];
    const eventValue = eventData[eventKey];
    
    processedData = processedData.map(queryItem => ({
      ...queryItem,
      _changeContext: {
        eventKey,
        eventValue,
        timestamp: new Date().toISOString()
      }
    }));
    
    console.log(`[onChange/utils] Added change context to ${processedData.length} query items`);
  }

  return processedData;
}

/**
 * Filter query data based on change event
 * @param {Array} queryData - Query data array
 * @param {Object} eventData - Change event data
 * @returns {Array} Filtered query data
 */
function filterQueryDataForChange(queryData, eventData) {
  if (!queryData || !Array.isArray(queryData) || !eventData) {
    return queryData || [];
  }

  const eventKey = Object.keys(eventData)[0];
  const eventValue = eventData[eventKey];
  
  console.log(`[onChange/utils] Filtering query data for ${eventKey} = ${eventValue}`);

  // Filter query items that are relevant to the change
  const filteredData = queryData.filter(queryItem => {
    // Check if query item contains reference to changed field
    const queryStr = JSON.stringify(queryItem);
    const isRelevant = queryStr.includes(eventKey) || 
                      queryStr.includes(`\${${eventKey}}`) ||
                      (queryItem.sqlQuery && queryItem.sqlQuery.variables && queryItem.sqlQuery.variables[eventKey] !== undefined) ||
                      (queryItem.graph && queryItem.graph.variables && queryItem.graph.variables[eventKey] !== undefined);
    
    return isRelevant;
  });

  console.log(`[onChange/utils] Filtered ${queryData.length} query items to ${filteredData.length} relevant items`);
  return filteredData;
}

/**
 * Update query variables with change event data
 * @param {Array} queryData - Query data array
 * @param {Object} eventData - Change event data
 * @returns {Array} Updated query data
 */
function updateQueryVariables(queryData, eventData) {
  if (!queryData || !Array.isArray(queryData) || !eventData) {
    return queryData || [];
  }

  const eventKey = Object.keys(eventData)[0];
  const eventValue = eventData[eventKey];
  
  console.log(`[onChange/utils] Updating query variables with ${eventKey} = ${eventValue}`);

  const updatedData = queryData.map(queryItem => {
    const updatedItem = { ...queryItem };
    
    // Update SQL query variables
    if (updatedItem.sqlQuery && updatedItem.sqlQuery.variables) {
      updatedItem.sqlQuery = {
        ...updatedItem.sqlQuery,
        variables: {
          ...updatedItem.sqlQuery.variables,
          [eventKey]: eventValue
        }
      };
    }
    
    // Update GraphQL variables
    if (updatedItem.graph && updatedItem.graph.variables) {
      updatedItem.graph = {
        ...updatedItem.graph,
        variables: {
          ...updatedItem.graph.variables,
          [eventKey]: eventValue
        }
      };
    }
    
    return updatedItem;
  });

  console.log(`[onChange/utils] Updated variables in ${updatedData.length} query items`);
  return updatedData;
}

/**
 * Extract change-relevant data from query results
 * @param {Array} queryData - Query data with results
 * @param {Object} eventData - Change event data
 * @returns {Object} Extracted relevant data
 */
function extractChangeRelevantData(queryData, eventData) {
  if (!queryData || !Array.isArray(queryData) || !eventData) {
    return { relevant: [], all: queryData || [] };
  }

  const eventKey = Object.keys(eventData)[0];
  const eventValue = eventData[eventKey];
  
  console.log(`[onChange/utils] Extracting change-relevant data for ${eventKey} = ${eventValue}`);

  const relevantData = [];
  const allData = [];

  queryData.forEach(queryItem => {
    allData.push(queryItem);
    
    // Check if this query item has data relevant to the change
    let hasRelevantData = false;
    
    // Check SQL query results
    if (queryItem.sqlQuery && queryItem.sqlQuery.data) {
      const sqlData = queryItem.sqlQuery.data;
      const hasEventField = Array.isArray(sqlData) 
        ? sqlData.some(row => row[eventKey] !== undefined)
        : sqlData[eventKey] !== undefined;
      
      if (hasEventField) {
        hasRelevantData = true;
      }
    }
    
    // Check GraphQL results
    if (queryItem.graph) {
      const graphStr = JSON.stringify(queryItem.graph);
      if (graphStr.includes(eventKey) || graphStr.includes(eventValue)) {
        hasRelevantData = true;
      }
    }
    
    if (hasRelevantData) {
      relevantData.push(queryItem);
    }
  });

  console.log(`[onChange/utils] Found ${relevantData.length} relevant query items out of ${allData.length} total`);
  
  return {
    relevant: relevantData,
    all: allData,
    stats: {
      totalItems: allData.length,
      relevantItems: relevantData.length,
      relevanceRatio: allData.length > 0 ? (relevantData.length / allData.length) : 0
    }
  };
}

/**
 * Merge change data into existing query results
 * @param {Array} queryData - Existing query data
 * @param {Object} eventData - Change event data
 * @param {Object} additionalData - Additional data to merge
 * @returns {Array} Merged query data
 */
function mergeChangeDataIntoQuery(queryData, eventData, additionalData = {}) {
  if (!queryData || !Array.isArray(queryData)) {
    return [];
  }

  const eventKey = Object.keys(eventData)[0];
  const eventValue = eventData[eventKey];
  
  console.log(`[onChange/utils] Merging change data into query results`);

  const mergedData = queryData.map(queryItem => {
    const mergedItem = { ...queryItem };
    
    // Merge into SQL query data
    if (mergedItem.sqlQuery && mergedItem.sqlQuery.data) {
      if (Array.isArray(mergedItem.sqlQuery.data)) {
        mergedItem.sqlQuery.data = mergedItem.sqlQuery.data.map(row => ({
          ...row,
          [eventKey]: eventValue,
          ...additionalData
        }));
      } else {
        mergedItem.sqlQuery.data = {
          ...mergedItem.sqlQuery.data,
          [eventKey]: eventValue,
          ...additionalData
        };
      }
    }
    
    // Merge into GraphQL data
    if (mergedItem.graph) {
      Object.keys(mergedItem.graph).forEach(graphKey => {
        if (Array.isArray(mergedItem.graph[graphKey])) {
          mergedItem.graph[graphKey] = mergedItem.graph[graphKey].map(item => ({
            ...item,
            [eventKey]: eventValue,
            ...additionalData
          }));
        } else if (typeof mergedItem.graph[graphKey] === 'object') {
          mergedItem.graph[graphKey] = {
            ...mergedItem.graph[graphKey],
            [eventKey]: eventValue,
            ...additionalData
          };
        }
      });
    }
    
    return mergedItem;
  });

  console.log(`[onChange/utils] Merged change data into ${mergedData.length} query items`);
  return mergedData;
}

/**
 * Validate query data for onChange processing
 * @param {Array} queryData - Query data to validate
 * @param {Object} eventData - Change event data
 * @returns {Object} Validation result
 */
function validateQueryDataForChange(queryData, eventData) {
  const errors = [];
  const warnings = [];
  
  if (!queryData) {
    warnings.push('No query data provided');
    return { isValid: true, errors, warnings, hasData: false };
  }

  if (!Array.isArray(queryData)) {
    errors.push('Query data must be an array');
    return { isValid: false, errors, warnings };
  }

  if (!eventData) {
    warnings.push('No event data provided for context');
  }

  // Validate each query item
  queryData.forEach((queryItem, index) => {
    if (!queryItem || typeof queryItem !== 'object') {
      errors.push(`Query item ${index} must be an object`);
      return;
    }

    // Check if query item has expected structure
    const hasSQL = queryItem.sqlQuery && typeof queryItem.sqlQuery === 'object';
    const hasGraph = queryItem.graph && typeof queryItem.graph === 'object';
    
    if (!hasSQL && !hasGraph) {
      warnings.push(`Query item ${index} has no SQL or GraphQL data`);
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    hasData: queryData.length > 0,
    itemCount: queryData.length
  };
}

module.exports = {
  processChangeQueryData,
  filterQueryDataForChange,
  updateQueryVariables,
  extractChangeRelevantData,
  mergeChangeDataIntoQuery,
  validateQueryDataForChange
};
