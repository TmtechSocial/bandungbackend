// onChange/index.js - Main entry point for onChange functionality

// Main onChange handler
const dynamicChange = require('./handleChange');

// API utilities
const { loadChangeApiData, makeChangeApiCall } = require('./api/loadChangeApiData');

// Event utilities
const {
  setupChangeHandlers,
  setupComponentChangeHandler,
  setupChangeDependencies,
  getRefreshComponents,
  validateChangeEvent
} = require('./event/setupChangeHandlers');

// Processing utilities
const {
  processChangeComponents,
  categorizeChangeComponents,
  updateChangeComponent
} = require('./process/processChangeComponents');

// Validation utilities
const {
  validateChangeEvent: validateEvent,
  validateChangeComponent,
  validateChangeSchema,
  validateApiConfigs
} = require('./utils/changeValidator');

// Query processing utilities
const {
  processChangeQueryData,
  filterQueryDataForChange,
  updateQueryVariables,
  extractChangeRelevantData,
  mergeChangeDataIntoQuery,
  validateQueryDataForChange
} = require('./utils/changeQueryProcessor');

// Form state utilities
const {
  createChangeFormState,
  updateFormStateValues,
  updateFormStateApiResults,
  setComponentLoading,
  setComponentError,
  getFormStateSummary,
  cleanupFormState
} = require('./createChangeFormState');

// Export main function
module.exports = dynamicChange;

// Export all utilities for advanced usage
module.exports.api = {
  loadChangeApiData,
  makeChangeApiCall
};

module.exports.event = {
  setupChangeHandlers,
  setupComponentChangeHandler,
  setupChangeDependencies,
  getRefreshComponents,
  validateChangeEvent
};

module.exports.process = {
  processChangeComponents,
  categorizeChangeComponents,
  updateChangeComponent
};

module.exports.utils = {
  validator: {
    validateEvent,
    validateChangeComponent,
    validateChangeSchema,
    validateApiConfigs
  },
  queryProcessor: {
    processChangeQueryData,
    filterQueryDataForChange,
    updateQueryVariables,
    extractChangeRelevantData,
    mergeChangeDataIntoQuery,
    validateQueryDataForChange
  },
  formState: {
    createChangeFormState,
    updateFormStateValues,
    updateFormStateApiResults,
    setComponentLoading,
    setComponentError,
    getFormStateSummary,
    cleanupFormState
  }
};

// Export version info
module.exports.version = '2.0.0';
module.exports.description = 'Enhanced onChange functionality with comprehensive onRender capabilities';

// Export legacy function for backward compatibility
module.exports.dynamicChangeSimple = dynamicChange.dynamicChangeSimple;
