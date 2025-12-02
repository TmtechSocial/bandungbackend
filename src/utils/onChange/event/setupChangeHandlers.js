// onChange/event/setupChangeHandlers.js

/**
 * Setup event handlers specifically for onChange scenarios
 * @param {Object} schema - Form schema
 * @param {Object} formState - Current form state
 * @param {Object} apiConfigs - API configurations
 * @param {Object} eventData - Change event data
 */
function setupChangeHandlers(schema, formState, apiConfigs, eventData) {
  if (!schema || !schema.components) {
    console.warn('[onChange/event] Invalid schema provided for setup handlers');
    return;
  }

  console.log(`[onChange/event] Setting up change handlers for ${schema.components.length} components`);

  // Process each component for onChange-specific handlers
  schema.components.forEach((component) => {
    setupComponentChangeHandler(component, formState, apiConfigs, eventData);
  });

  console.log('[onChange/event] Change handlers setup completed');
}

/**
 * Setup change handler for individual component
 * @param {Object} component - Component configuration
 * @param {Object} formState - Current form state
 * @param {Object} apiConfigs - API configurations
 * @param {Object} eventData - Change event data
 */
function setupComponentChangeHandler(component, formState, apiConfigs, eventData) {
  const { key, type, onChange, apiSource } = component;

  if (!onChange) {
    return; // No onChange configuration
  }

  // Setup refresh field handling
  if (onChange.refreshField) {
    const refreshFields = Array.isArray(onChange.refreshField) 
      ? onChange.refreshField 
      : [onChange.refreshField];

    component._changeHandler = {
      type: 'refresh',
      refreshFields,
      triggerKey: key,
      eventData
    };

    console.log(`[onChange/event] Setup refresh handler for ${key} -> ${refreshFields.join(', ')}`);
  }

  // Setup conditional logic
  if (onChange.condition) {
    component._changeHandler = {
      ...component._changeHandler,
      condition: onChange.condition,
      eventData
    };

    console.log(`[onChange/event] Setup conditional handler for ${key}`);
  }

  // Setup validation triggers
  if (onChange.validateFields) {
    const validateFields = Array.isArray(onChange.validateFields)
      ? onChange.validateFields
      : [onChange.validateFields];

    component._changeHandler = {
      ...component._changeHandler,
      validateFields,
      eventData
    };

    console.log(`[onChange/event] Setup validation handler for ${key} -> ${validateFields.join(', ')}`);
  }

  // Setup API dependency tracking
  if (apiSource && apiSource.dependsOn) {
    const dependsOn = Array.isArray(apiSource.dependsOn)
      ? apiSource.dependsOn
      : [apiSource.dependsOn];

    component._apiDependency = {
      dependsOn,
      source: apiSource.source,
      eventData
    };

    console.log(`[onChange/event] Setup API dependency for ${key} depends on ${dependsOn.join(', ')}`);
  }
}

/**
 * Setup component dependencies for onChange scenarios
 * @param {Object} schema - Form schema
 * @param {Object} formState - Current form state
 * @param {Object} eventData - Change event data
 */
function setupChangeDependencies(schema, formState, eventData) {
  if (!schema || !schema.components) {
    console.warn('[onChange/event] Invalid schema provided for dependencies setup');
    return;
  }

  const eventKey = Object.keys(eventData)[0];
  const eventValue = eventData[eventKey];

  console.log(`[onChange/event] Setting up dependencies for change: ${eventKey} = ${eventValue}`);

  // Create dependency map
  const dependencyMap = new Map();
  
  schema.components.forEach((component) => {
    const { key, onChange, apiSource } = component;
    
    // Track onChange dependencies
    if (onChange && onChange.refreshField) {
      const refreshFields = Array.isArray(onChange.refreshField) 
        ? onChange.refreshField 
        : [onChange.refreshField];
      
      refreshFields.forEach(refreshField => {
        if (!dependencyMap.has(key)) {
          dependencyMap.set(key, new Set());
        }
        dependencyMap.get(key).add(refreshField);
      });
    }

    // Track API dependencies
    if (apiSource && apiSource.dependsOn) {
      const dependsOn = Array.isArray(apiSource.dependsOn)
        ? apiSource.dependsOn
        : [apiSource.dependsOn];
      
      dependsOn.forEach(dependency => {
        if (!dependencyMap.has(dependency)) {
          dependencyMap.set(dependency, new Set());
        }
        dependencyMap.get(dependency).add(key);
      });
    }
  });

  // Store dependency map in form state
  formState.changeDependencies = dependencyMap;
  formState.changeEventData = eventData;

  console.log(`[onChange/event] Dependencies setup completed. Tracked ${dependencyMap.size} dependency relationships`);
  
  // Log the dependency relationships for debugging
  dependencyMap.forEach((dependents, trigger) => {
    console.log(`[onChange/event] ${trigger} -> [${Array.from(dependents).join(', ')}]`);
  });
}

/**
 * Get components that need to be refreshed based on change event
 * @param {Object} schema - Form schema
 * @param {Object} eventData - Change event data
 * @returns {Array} Array of components that need refresh
 */
function getRefreshComponents(schema, eventData) {
  if (!schema || !schema.components || !eventData) {
    return [];
  }

  const eventKey = Object.keys(eventData)[0];
  const refreshComponents = [];

  // Find the component that triggered the change
  const triggerComponent = schema.components.find(comp => comp.key === eventKey);
  
  if (!triggerComponent || !triggerComponent.onChange) {
    console.log(`[onChange/event] No onChange config found for ${eventKey}`);
    return [];
  }

  // Get refresh field keys
  const refreshFieldKeys = triggerComponent.onChange.refreshField
    ? (Array.isArray(triggerComponent.onChange.refreshField) 
        ? triggerComponent.onChange.refreshField 
        : [triggerComponent.onChange.refreshField])
    : [];

  // Find refresh components
  refreshFieldKeys.forEach(refreshKey => {
    const refreshComponent = schema.components.find(comp => comp.key === refreshKey);
    if (refreshComponent) {
      refreshComponents.push(refreshComponent);
    } else {
      console.warn(`[onChange/event] Refresh component not found: ${refreshKey}`);
    }
  });

  console.log(`[onChange/event] Found ${refreshComponents.length} components to refresh for ${eventKey}:`, 
    refreshComponents.map(c => c.key));

  return refreshComponents;
}

/**
 * Validate change event data
 * @param {Object} eventData - Change event data
 * @returns {Boolean} True if valid
 */
function validateChangeEvent(eventData) {
  if (!eventData || typeof eventData !== 'object') {
    console.error('[onChange/event] Invalid event data: must be an object');
    return false;
  }

  const keys = Object.keys(eventData);
  if (keys.length !== 1) {
    console.error('[onChange/event] Invalid event data: must contain exactly one key-value pair');
    return false;
  }

  const eventKey = keys[0];
  const eventValue = eventData[eventKey];

  if (eventKey === '' || eventKey === null || eventKey === undefined) {
    console.error('[onChange/event] Invalid event key: must be non-empty string');
    return false;
  }

  console.log(`[onChange/event] Valid change event: ${eventKey} = ${eventValue}`);
  return true;
}

module.exports = {
  setupChangeHandlers,
  setupComponentChangeHandler,
  setupChangeDependencies,
  getRefreshComponents,
  validateChangeEvent
};
