const fetchApiData = require("../api/fetchApiData");
const updateComponent = require("../process/updateComponent");

// Cache untuk menghindari setup handler berulang
const handlerCache = new Map();

async function updateDependentFields(schema, changedKey, value, formState, apiConfigMap) {
  // Update nilai pada state form
  formState.data[changedKey] = value;

  // Ambil semua field yang tergantung pada field yang berubah
  const dependentFieldKeys = formState.dependencies.get(changedKey) || [];
  
  if (dependentFieldKeys.length === 0) return; // Early return jika tidak ada dependencies

  // Process dependent fields in parallel if possible
  const dependentPromises = dependentFieldKeys.map(async (fieldKey) => {
    const component = schema.components.find((comp) => comp.key === fieldKey);
    if (!component || !component.apiSource) return null;

    const apiSourceKey = component.apiSource.source;
    const apiConfig = apiConfigMap[apiSourceKey];
    if (!apiConfig) return null;

    try {
      const result = await fetchApiData(apiConfig, { [changedKey]: value }, formState.data);
      if (result) {
        formState.apiResults[apiSourceKey] = result;
        updateComponent(component, result);
      }
      return { fieldKey, success: true };
    } catch (error) {
      console.error(`Error updating dependent field ${fieldKey}:`, error);
      return { fieldKey, success: false, error };
    }
  });

  await Promise.all(dependentPromises);
}

function setupHandlers(schema, formState, apiConfigMap) {
  const startTime = Date.now();
  
  // Create a cache key for this schema
  const cacheKey = JSON.stringify({
    componentKeys: schema.components.map(c => c.key),
    dependencies: Array.from(formState.dependencies.entries())
  });

  // Check if handlers are already set up for this schema
  if (handlerCache.has(cacheKey)) {
    // console.log(`setupHandlers: Using cached handlers (${Date.now() - startTime}ms)`);
    return;
  }

  let handlersSetup = 0;
  
  // Optimization: Filter components that need handlers first
  const componentsNeedingHandlers = schema.components.filter((component) => {
    const key = component.key;
    const isDependentSource = formState.dependencies.has(key);
    const isDataGrid = Array.isArray(component.defaultValue) && component.defaultValue.length > 0;
    
    return !isDataGrid && (isDependentSource || component.onChange);
  });

  // console.log(`Setting up handlers for ${componentsNeedingHandlers.length}/${schema.components.length} components`);

  componentsNeedingHandlers.forEach((component) => {
    const key = component.key;
    const originalOnChange = component.onChange;

    component.onChange = async (event) => {
      const value = event?.value ?? event?.target?.value ?? "";
      
      await updateDependentFields(schema, key, value, formState, apiConfigMap);

      // Jalankan handler lama jika ada
      if (typeof originalOnChange === "function") {
        originalOnChange(event);
      }
    };
    
    handlersSetup++;
  });

  // Cache the setup
  handlerCache.set(cacheKey, true);
  
  const totalTime = Date.now() - startTime;
  // console.log(`setupHandlers completed: ${handlersSetup} handlers in ${totalTime}ms`);
  
  // Cleanup cache if it gets too big
  if (handlerCache.size > 50) {
    const oldestKey = handlerCache.keys().next().value;
    handlerCache.delete(oldestKey);
  }
}

module.exports = setupHandlers;