// onChange/createChangeFormState.js

/**
 * Create form state specifically for onChange scenarios
 * @param {Object} schema - Form schema
 * @param {Object} session - User session
 * @param {Object} eventData - Change event data
 * @returns {Object} Form state optimized for onChange
 */
function createChangeFormState(schema, session, eventData) {
  console.log('[onChange/formState] Creating change-optimized form state');
  
  const formState = {
    // Core form state
    values: {},
    errors: {},
    touched: {},
    
    // API and data management
    apiResults: {},
    loadingStates: {},
    
    // Change-specific state
    changeEventData: eventData || {},
    changeTrigger: null,
    changeTargets: [],
    
    // Dependencies and relationships
    dependencies: new Map(),
    changeDependencies: new Map(),
    
    // Session and user context
    session: session || {},
    
    // Component state tracking
    componentStates: new Map(),
    
    // Performance tracking
    changeStartTime: Date.now(),
    processingStats: {
      apiCalls: 0,
      componentUpdates: 0,
      validationErrors: 0
    }
  };

  // Initialize form values from schema defaults
  if (schema && schema.components) {
    initializeFormValues(formState, schema.components);
  }

  // Setup change-specific state
  if (eventData) {
    setupChangeState(formState, eventData);
  }

  // Setup component state tracking
  if (schema && schema.components) {
    setupComponentStateTracking(formState, schema.components);
  }

  console.log(`[onChange/formState] Form state created with ${Object.keys(formState.values).length} initial values`);
  
  return formState;
}

/**
 * Initialize form values from schema components
 * @param {Object} formState - Form state object
 * @param {Array} components - Schema components
 */
function initializeFormValues(formState, components) {
  if (!components || !Array.isArray(components)) {
    return;
  }

  components.forEach(component => {
    const { key, defaultValue, type } = component;
    
    if (key && defaultValue !== undefined) {
      formState.values[key] = defaultValue;
    } else if (key) {
      // Set type-appropriate default values
      switch (type) {
        case 'select':
        case 'selectboxes':
          formState.values[key] = null;
          break;
        case 'datagrid':
        case 'editgrid':
          formState.values[key] = [];
          break;
        case 'number':
          formState.values[key] = 0;
          break;
        case 'checkbox':
          formState.values[key] = false;
          break;
        default:
          formState.values[key] = '';
          break;
      }
    }

    // Initialize error and touched states
    if (key) {
      formState.errors[key] = null;
      formState.touched[key] = false;
    }
  });

  console.log(`[onChange/formState] Initialized ${Object.keys(formState.values).length} form values`);
}

/**
 * Setup change-specific state
 * @param {Object} formState - Form state object
 * @param {Object} eventData - Change event data
 */
function setupChangeState(formState, eventData) {
  if (!eventData || typeof eventData !== 'object') {
    return;
  }

  const eventKey = Object.keys(eventData)[0];
  const eventValue = eventData[eventKey];

  formState.changeTrigger = eventKey;
  formState.changeEventData = eventData;

  // Update form value with the changed data
  if (eventKey) {
    formState.values[eventKey] = eventValue;
    formState.touched[eventKey] = true;
  }

  console.log(`[onChange/formState] Setup change state for ${eventKey} = ${eventValue}`);
}

/**
 * Setup component state tracking
 * @param {Object} formState - Form state object
 * @param {Array} components - Schema components
 */
function setupComponentStateTracking(formState, components) {
  if (!components || !Array.isArray(components)) {
    return;
  }

  components.forEach(component => {
    const { key, type, onChange, apiSource } = component;
    
    if (key) {
      formState.componentStates.set(key, {
        type,
        hasOnChange: !!onChange,
        hasApiSource: !!apiSource,
        lastUpdated: null,
        updateCount: 0,
        isLoading: false,
        isError: false,
        errorMessage: null
      });

      // Track loading states for API components
      if (apiSource && apiSource.source) {
        formState.loadingStates[apiSource.source] = false;
      }
    }
  });

  console.log(`[onChange/formState] Setup state tracking for ${formState.componentStates.size} components`);
}

/**
 * Update form state with new values
 * @param {Object} formState - Form state object
 * @param {Object} newValues - New values to merge
 */
function updateFormStateValues(formState, newValues) {
  if (!newValues || typeof newValues !== 'object') {
    return;
  }

  Object.entries(newValues).forEach(([key, value]) => {
    formState.values[key] = value;
    formState.touched[key] = true;
    
    // Update component state if tracked
    if (formState.componentStates.has(key)) {
      const componentState = formState.componentStates.get(key);
      componentState.lastUpdated = Date.now();
      componentState.updateCount++;
    }
  });

  console.log(`[onChange/formState] Updated ${Object.keys(newValues).length} form values`);
}

/**
 * Update API results in form state
 * @param {Object} formState - Form state object
 * @param {Object} apiResults - API results to merge
 */
function updateFormStateApiResults(formState, apiResults) {
  if (!apiResults || typeof apiResults !== 'object') {
    return;
  }

  Object.entries(apiResults).forEach(([source, data]) => {
    formState.apiResults[source] = data;
    formState.loadingStates[source] = false;
    formState.processingStats.apiCalls++;
  });

  console.log(`[onChange/formState] Updated API results for ${Object.keys(apiResults).length} sources`);
}

/**
 * Set component loading state
 * @param {Object} formState - Form state object
 * @param {String} componentKey - Component key
 * @param {Boolean} isLoading - Loading state
 */
function setComponentLoading(formState, componentKey, isLoading) {
  if (formState.componentStates.has(componentKey)) {
    const componentState = formState.componentStates.get(componentKey);
    componentState.isLoading = isLoading;
    
    if (!isLoading) {
      componentState.lastUpdated = Date.now();
    }
  }
}

/**
 * Set component error state
 * @param {Object} formState - Form state object
 * @param {String} componentKey - Component key
 * @param {String} errorMessage - Error message
 */
function setComponentError(formState, componentKey, errorMessage) {
  if (formState.componentStates.has(componentKey)) {
    const componentState = formState.componentStates.get(componentKey);
    componentState.isError = !!errorMessage;
    componentState.errorMessage = errorMessage;
    componentState.isLoading = false;
  }

  if (errorMessage) {
    formState.errors[componentKey] = errorMessage;
    formState.processingStats.validationErrors++;
  } else {
    formState.errors[componentKey] = null;
  }
}

/**
 * Get form state summary for debugging
 * @param {Object} formState - Form state object
 * @returns {Object} Summary information
 */
function getFormStateSummary(formState) {
  const summary = {
    valueCount: Object.keys(formState.values || {}).length,
    errorCount: Object.values(formState.errors || {}).filter(Boolean).length,
    touchedCount: Object.values(formState.touched || {}).filter(Boolean).length,
    apiSourceCount: Object.keys(formState.apiResults || {}).length,
    componentCount: formState.componentStates ? formState.componentStates.size : 0,
    changeTrigger: formState.changeTrigger,
    processingTime: formState.changeStartTime ? Date.now() - formState.changeStartTime : 0,
    stats: formState.processingStats || {}
  };

  return summary;
}

/**
 * Clean up form state (remove unnecessary data)
 * @param {Object} formState - Form state object
 */
function cleanupFormState(formState) {
  // Remove null/undefined values
  Object.keys(formState.values).forEach(key => {
    if (formState.values[key] === null || formState.values[key] === undefined) {
      delete formState.values[key];
    }
  });

  // Remove null errors
  Object.keys(formState.errors).forEach(key => {
    if (!formState.errors[key]) {
      delete formState.errors[key];
    }
  });

  // Clear old component states
  if (formState.componentStates) {
    formState.componentStates.forEach((state, key) => {
      if (!formState.values.hasOwnProperty(key)) {
        formState.componentStates.delete(key);
      }
    });
  }

  console.log('[onChange/formState] Form state cleaned up');
}

module.exports = {
  createChangeFormState,
  initializeFormValues,
  setupChangeState,
  setupComponentStateTracking,
  updateFormStateValues,
  updateFormStateApiResults,
  setComponentLoading,
  setComponentError,
  getFormStateSummary,
  cleanupFormState
};
