// process/processComponents.js - OPTIMIZED VERSION for onChange

const processSelectComponent = require("./processSelectComponent");
const processSelectBoxesComponent = require("./processSelectBoxesComponent");
const processContentComponent = require("./processContentComponent");
const processDefaultComponent = require("./processDefaultComponent");
const processDataGridComponent = require("./processDataGridComponent");
const processEditGridComponent = require("./processEditGridComponent");

// Optimization: Component processor mapping for faster lookup
const componentProcessors = {
  select: processSelectComponent,
  selectboxes: processSelectBoxesComponent,
  content: processContentComponent,
  datagrid: processDataGridComponent,
  editgrid: processEditGridComponent,
  default: processDefaultComponent,
};

/**
 * Process components for onChange events
 * Optimized for partial updates and enhanced performance monitoring
 * @param {Array|Object} components - Components to process
 * @param {Array} queryData - SQL/Graph query results
 * @param {Object} formState - Current form state
 * @param {Object} session - User session data
 * @param {Object} apiConfigs - API configurations
 * @param {Object} memberResult - Member/session result data
 * @returns {Object} Processing results with performance metrics
 */
async function processComponents(
  components,
  queryData,
  formState,
  session,
  apiConfigs,
  memberResult
) {
  const startTime = Date.now();
  console.log(`[onChange] Starting component processing`);

  // Validation: Ensure proper input format
  if (components && typeof components === "object" && !Array.isArray(components)) {
    components = [components];
  }

  if (!components || components.length === 0) {
    console.log(`[onChange] No components to process`);
    return {
      success: true,
      processedCount: 0,
      totalTime: 0,
      components: []
    };
  }

  // Enhanced: Check API data availability
  if (formState && formState.apiResults) {
    console.log(`[onChange] API results available for ${Object.keys(formState.apiResults).length} sources`);
  } else {
    console.log(`[onChange] No API results available`);
  }

  // Optimization: Group components by processing strategy for onChange
  const parallelComponents = [];      // Can run in parallel (content, etc.)
  const sequentialComponents = [];    // Need sequential processing (select, datagrid, etc.)
  const fastSyncComponents = [];      // Lightweight sync processing (default, textfield, etc.)

  components.forEach((component) => {
    const { type } = component;

    // Fast sync components (no async operations, lightweight)
    if (type === "textfield" || type === "email" || type === "password" || 
        type === "number" || type === "textarea" || type === "checkbox" || 
        type === "radio" || type === "button" || type === "hidden" || 
        type === "htmlelement" || !type) {
      fastSyncComponents.push(component);
    }
    // Heavy components that can run in parallel
    else if (type === "content") {
      parallelComponents.push(component);
    }
    // Components that might need API calls or have dependencies
    else {
      sequentialComponents.push(component);
    }
  });

  console.log(`[onChange] Component distribution - Fast: ${fastSyncComponents.length}, Parallel: ${parallelComponents.length}, Sequential: ${sequentialComponents.length}`);

  const results = {
    success: true,
    processedCount: 0,
    errors: [],
    components: [],
    timing: {}
  };

  // Process fast sync components first (no await needed)
  const syncStartTime = Date.now();
  fastSyncComponents.forEach((component) => {
    try {
      const processor = componentProcessors.default;
      processor(component, queryData, formState, apiConfigs, session);
      results.processedCount++;
      results.components.push({
        key: component.key,
        type: component.type || 'default',
        status: 'success',
        processingType: 'sync'
      });
    } catch (error) {
      console.error(`[onChange] Error processing sync component ${component.key}:`, error);
      results.errors.push({
        key: component.key,
        type: component.type || 'default',
        error: error.message,
        processingType: 'sync'
      });
    }
  });
  results.timing.syncTime = Date.now() - syncStartTime;

  // Process parallel components
  let parallelTime = 0;
  if (parallelComponents.length > 0) {
    const parallelStartTime = Date.now();
    const parallelPromises = parallelComponents.map(async (component) => {
      const { type } = component;
      const processor = componentProcessors[type] || componentProcessors.default;

      try {
        if (type === "content") {
          const htmlContentArray = processor(component, queryData, formState, apiConfigs);
          
          // Update the component's html property with the processed content
          if (htmlContentArray && htmlContentArray.length > 0) {
            component.html = htmlContentArray.length === 1 
              ? htmlContentArray[0] 
              : htmlContentArray.join("");
          }
        } else {
          processor(component, queryData, formState, apiConfigs, session);
        }
        
        return { 
          success: true, 
          type, 
          key: component.key,
          processingType: 'parallel'
        };
      } catch (error) {
        return {
          success: false,
          type,
          key: component.key,
          error: error.message,
          processingType: 'parallel'
        };
      }
    });

    try {
      const parallelResults = await Promise.all(parallelPromises);
      parallelResults.forEach(result => {
        if (result.success) {
          results.processedCount++;
          results.components.push(result);
        } else {
          results.errors.push(result);
        }
      });
      
      parallelTime = Date.now() - parallelStartTime;
      results.timing.parallelTime = parallelTime;
      
      console.log(`[onChange] Parallel processing completed: ${parallelResults.filter(r => r.success).length}/${parallelResults.length} successful`);
    } catch (error) {
      console.error(`[onChange] Error in parallel processing:`, error);
      parallelTime = Date.now() - parallelStartTime;
      results.timing.parallelTime = parallelTime;
    }
  }

  // Process sequential components
  const sequentialStartTime = Date.now();
  for (const component of sequentialComponents) {
    const { type } = component;
    const processor = componentProcessors[type] || componentProcessors.default;
    
    // Enhanced: Reset component state for onChange (more selective than onRender)
    if (type !== "datagrid") {
      // For select components, only reset if they have dynamic data sources
      if (type === "select") {
        if (component.table || component.apiSource) {
          if (component.data && Array.isArray(component.data.values)) {
            component.data.values = [];
          }
        }
        // Static selects are not touched
      } else {
        // Reset other component types
        if (component.data && typeof component.data === 'object') {
          Object.keys(component.data).forEach((k) => delete component.data[k]);
        }
        if (typeof component.html !== "undefined") {
          component.html = undefined;
        }
        if (component.value && !component.defaultValue) {
          component.value = undefined;
        }
      }
    }
    
    try {
      // Enhanced: Type-specific processing for onChange
      switch (type) {
        case "select":
          processor(component, queryData, formState, apiConfigs);
          break;
        case "datagrid":
          processor(component, queryData, formState);
          break;
        case "editgrid":
          processor(component, queryData, formState, apiConfigs, session);
          break;
        case "selectboxes":
          processor(component, formState, apiConfigs, memberResult, queryData);
          break;
        default:
          processor(component, queryData, formState, apiConfigs, session);
          break;
      }
      
      results.processedCount++;
      results.components.push({
        key: component.key,
        type: component.type,
        status: 'success',
        processingType: 'sequential'
      });
      
    } catch (error) {
      console.error(`[onChange] Error processing sequential component ${component.key}:`, error);
      results.errors.push({
        key: component.key,
        type: component.type,
        error: error.message,
        processingType: 'sequential'
      });
    }
  }
  
  results.timing.sequentialTime = Date.now() - sequentialStartTime;
  results.timing.totalTime = Date.now() - startTime;

  // Enhanced: Final processing summary for onChange
  console.log(`[onChange] Component processing completed:`);
  console.log(`  - Total processed: ${results.processedCount}/${components.length}`);
  console.log(`  - Errors: ${results.errors.length}`);
  console.log(`  - Sync time: ${results.timing.syncTime}ms`);
  console.log(`  - Parallel time: ${results.timing.parallelTime || 0}ms`);
  console.log(`  - Sequential time: ${results.timing.sequentialTime}ms`);
  console.log(`  - Total time: ${results.timing.totalTime}ms`);

  // Check for specific component results
  const componentTypeCounts = {};
  results.components.forEach(comp => {
    componentTypeCounts[comp.type] = (componentTypeCounts[comp.type] || 0) + 1;
  });
  
  console.log(`[onChange] Component type distribution:`, componentTypeCounts);

  // Return enhanced results for onChange
  return {
    success: results.errors.length === 0,
    processedCount: results.processedCount,
    totalComponents: components.length,
    errors: results.errors,
    components: results.components,
    timing: results.timing,
    componentTypeCounts
  };
}

module.exports = processComponents;
