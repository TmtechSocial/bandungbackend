// onChange/process/processChangeComponents.js

const processSelectComponent = require("../../onRender/process/select");
const processSelectBoxesComponent = require("../../onRender/process/selectboxes");
const processContentComponent = require("../../onRender/process/content");
const processDefaultComponent = require("../../onRender/process/default");
const processDataGridComponent = require("../../onRender/process/datagrid");
const processEditGridComponent = require("../../onRender/process/editgrid");

// Component processor mapping for faster lookup
const componentProcessors = {
  select: processSelectComponent,
  selectboxes: processSelectBoxesComponent,
  content: processContentComponent,
  datagrid: processDataGridComponent,
  editgrid: processEditGridComponent,
  default: processDefaultComponent,
};

/**
 * Process components specifically for onChange scenarios
 * @param {Array} components - Array of components to process
 * @param {Array} queryData - Query data from SQL/GraphQL
 * @param {Object} formState - Current form state
 * @param {Object} session - User session
 * @param {Object} apiConfigs - API configurations
 * @param {Object} memberResult - LDAP member result
 * @param {Object} eventData - Change event data
 * @returns {Promise<Object>} Processing results
 */
async function processChangeComponents(
  components,
  queryData,
  formState,
  session,
  apiConfigs,
  memberResult,
  eventData
) {
  const startTime = Date.now();
  
  console.log(`[onChange/process] Processing ${components.length} changed components`);

  // Ensure components is an array
  if (!Array.isArray(components)) {
    components = components ? [components] : [];
  }

  if (components.length === 0) {
    console.log('[onChange/process] No components to process');
    return { processedComponents: [], stats: { totalTime: 0, processedCount: 0 } };
  }

  // Add event data to form state for component processing
  if (eventData) {
    formState.changeEventData = eventData;
    const eventKey = Object.keys(eventData)[0];
    const eventValue = eventData[eventKey];
    
    // Update form values with change data
    if (!formState.values) {
      formState.values = {};
    }
    formState.values[eventKey] = eventValue;
    
    console.log(`[onChange/process] Added change data to form state: ${eventKey} = ${eventValue}`);
  }

  // Categorize components for optimal processing
  const categorizedComponents = categorizeChangeComponents(components, eventData);
  
  console.log(`[onChange/process] Component categorization:`, {
    apiDependent: categorizedComponents.apiDependent.length,
    dataDependent: categorizedComponents.dataDependent.length,
    static: categorizedComponents.static.length
  });

  const processedComponents = [];
  const processingStats = {
    successful: 0,
    failed: 0,
    skipped: 0,
    apiCalls: 0,
    dataQueries: 0
  };

  // Process static components first (fastest)
  if (categorizedComponents.static.length > 0) {
    const staticResults = await processStaticChangeComponents(
      categorizedComponents.static,
      queryData,
      formState,
      session,
      apiConfigs,
      memberResult
    );
    processedComponents.push(...staticResults.components);
    processingStats.successful += staticResults.successful;
    processingStats.failed += staticResults.failed;
  }

  // Process data-dependent components
  if (categorizedComponents.dataDependent.length > 0) {
    const dataResults = await processDataDependentComponents(
      categorizedComponents.dataDependent,
      queryData,
      formState,
      session,
      apiConfigs,
      memberResult,
      eventData
    );
    processedComponents.push(...dataResults.components);
    processingStats.successful += dataResults.successful;
    processingStats.failed += dataResults.failed;
    processingStats.dataQueries += dataResults.dataQueries;
  }

  // Process API-dependent components
  if (categorizedComponents.apiDependent.length > 0) {
    const apiResults = await processApiDependentComponents(
      categorizedComponents.apiDependent,
      queryData,
      formState,
      session,
      apiConfigs,
      memberResult,
      eventData
    );
    processedComponents.push(...apiResults.components);
    processingStats.successful += apiResults.successful;
    processingStats.failed += apiResults.failed;
    processingStats.apiCalls += apiResults.apiCalls;
  }

  const totalTime = Date.now() - startTime;
  processingStats.totalTime = totalTime;
  processingStats.processedCount = processedComponents.length;

  console.log(`[onChange/process] Completed processing in ${totalTime}ms:`, processingStats);

  return {
    processedComponents,
    stats: processingStats
  };
}

/**
 * Categorize components based on their dependencies
 * @param {Array} components - Components to categorize
 * @param {Object} eventData - Change event data
 * @returns {Object} Categorized components
 */
function categorizeChangeComponents(components, eventData) {
  const categorized = {
    static: [],
    dataDependent: [],
    apiDependent: []
  };

  components.forEach(component => {
    if (component.apiSource) {
      categorized.apiDependent.push(component);
    } else if (component.table || hasDataDependency(component, eventData)) {
      categorized.dataDependent.push(component);
    } else {
      categorized.static.push(component);
    }
  });

  return categorized;
}

/**
 * Check if component has data dependency
 * @param {Object} component - Component to check
 * @param {Object} eventData - Change event data
 * @returns {Boolean} True if has data dependency
 */
function hasDataDependency(component, eventData) {
  if (!eventData) return false;
  
  const eventKey = Object.keys(eventData)[0];
  
  // Check if component references the changed field in its configuration
  const componentStr = JSON.stringify(component);
  return componentStr.includes(eventKey) || componentStr.includes('${' + eventKey + '}');
}

/**
 * Process static components (no external dependencies)
 * @param {Array} components - Static components
 * @param {Array} queryData - Query data
 * @param {Object} formState - Form state
 * @param {Object} session - User session
 * @param {Object} apiConfigs - API configs
 * @param {Object} memberResult - Member result
 * @returns {Promise<Object>} Processing results
 */
async function processStaticChangeComponents(components, queryData, formState, session, apiConfigs, memberResult) {
  console.log(`[onChange/process] Processing ${components.length} static components`);
  
  const results = { components: [], successful: 0, failed: 0 };
  
  for (const component of components) {
    try {
      const processor = componentProcessors[component.type] || componentProcessors.default;
      
      // Process the component
      if (component.type === "selectboxes") {
        processor(component, formState, apiConfigs, memberResult);
      } else {
        processor(component, queryData, formState, apiConfigs, session);
      }
      
      results.components.push(component);
      results.successful++;
      
      console.log(`[onChange/process] Successfully processed static component: ${component.key}`);
    } catch (error) {
      console.error(`[onChange/process] Failed to process static component ${component.key}:`, error.message);
      results.failed++;
    }
  }
  
  return results;
}

/**
 * Process data-dependent components
 * @param {Array} components - Data-dependent components
 * @param {Array} queryData - Query data
 * @param {Object} formState - Form state
 * @param {Object} session - User session
 * @param {Object} apiConfigs - API configs
 * @param {Object} memberResult - Member result
 * @param {Object} eventData - Change event data
 * @returns {Promise<Object>} Processing results
 */
async function processDataDependentComponents(components, queryData, formState, session, apiConfigs, memberResult, eventData) {
  console.log(`[onChange/process] Processing ${components.length} data-dependent components`);
  
  const results = { components: [], successful: 0, failed: 0, dataQueries: 0 };
  
  for (const component of components) {
    try {
      const processor = componentProcessors[component.type] || componentProcessors.default;
      
      // Process the component with updated query data
      if (component.type === "selectboxes") {
        processor(component, formState, apiConfigs, memberResult, queryData);
      } else {
        processor(component, queryData, formState, apiConfigs, session);
      }
      
      results.components.push(component);
      results.successful++;
      results.dataQueries++;
      
      console.log(`[onChange/process] Successfully processed data-dependent component: ${component.key}`);
    } catch (error) {
      console.error(`[onChange/process] Failed to process data-dependent component ${component.key}:`, error.message);
      results.failed++;
    }
  }
  
  return results;
}

/**
 * Process API-dependent components
 * @param {Array} components - API-dependent components
 * @param {Array} queryData - Query data
 * @param {Object} formState - Form state
 * @param {Object} session - User session
 * @param {Object} apiConfigs - API configs
 * @param {Object} memberResult - Member result
 * @param {Object} eventData - Change event data
 * @returns {Promise<Object>} Processing results
 */
async function processApiDependentComponents(components, queryData, formState, session, apiConfigs, memberResult, eventData) {
  console.log(`[onChange/process] Processing ${components.length} API-dependent components`);
  
  const results = { components: [], successful: 0, failed: 0, apiCalls: 0 };
  
  for (const component of components) {
    try {
      const processor = componentProcessors[component.type] || componentProcessors.default;
      
      // Ensure API data is available in form state for this component
      if (component.apiSource && component.apiSource.source) {
        const apiSource = component.apiSource.source;
        if (!formState.apiResults || !formState.apiResults[apiSource]) {
          console.warn(`[onChange/process] API data not available for ${component.key}, source: ${apiSource}`);
        } else {
          results.apiCalls++;
        }
      }
      
      // Process the component
      if (component.type === "selectboxes") {
        processor(component, formState, apiConfigs, memberResult, queryData);
      } else {
        processor(component, queryData, formState, apiConfigs, session);
      }
      
      results.components.push(component);
      results.successful++;
      
      console.log(`[onChange/process] Successfully processed API-dependent component: ${component.key}`);
    } catch (error) {
      console.error(`[onChange/process] Failed to process API-dependent component ${component.key}:`, error.message);
      results.failed++;
    }
  }
  
  return results;
}

/**
 * Update component with new data (legacy support)
 * @param {Object} component - Component to update
 * @param {*} newData - New data for the component
 */
function updateChangeComponent(component, newData) {
  if (!component || !newData) {
    console.warn('[onChange/process] Invalid component or data for update');
    return;
  }

  console.log(`[onChange/process] Updating component ${component.key} with new data`);

  // Handle different component types
  switch (component.type) {
    case 'select':
    case 'selectboxes':
      if (!component.data) {
        component.data = { values: [] };
      }
      component.data.values = Array.isArray(newData) ? newData : [newData];
      break;
      
    case 'datagrid':
    case 'editgrid':
      component.defaultValue = Array.isArray(newData) ? newData : [newData];
      break;
      
    case 'content':
      component.html = typeof newData === 'string' ? newData : JSON.stringify(newData);
      break;
      
    default:
      component.defaultValue = newData;
      break;
  }

  console.log(`[onChange/process] Component ${component.key} updated successfully`);
}

module.exports = {
  processChangeComponents,
  categorizeChangeComponents,
  hasDataDependency,
  processStaticChangeComponents,
  processDataDependentComponents,
  processApiDependentComponents,
  updateChangeComponent
};
