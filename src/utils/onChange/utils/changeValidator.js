// onChange/utils/changeValidator.js

/**
 * Validate change event data
 * @param {Object} eventData - Change event data to validate
 * @returns {Object} Validation result with isValid flag and errors
 */
function validateChangeEvent(eventData) {
  const errors = [];
  
  // Check if eventData exists
  if (!eventData) {
    errors.push('Event data is required');
    return { isValid: false, errors };
  }

  // Check if eventData is an object
  if (typeof eventData !== 'object' || Array.isArray(eventData)) {
    errors.push('Event data must be an object');
    return { isValid: false, errors };
  }

  // Check if eventData has exactly one key-value pair
  const keys = Object.keys(eventData);
  if (keys.length === 0) {
    errors.push('Event data must contain at least one field');
    return { isValid: false, errors };
  }

  if (keys.length > 1) {
    errors.push('Event data should contain only one changed field per request');
  }

  // Validate event key
  const eventKey = keys[0];
  if (!eventKey || eventKey.trim() === '') {
    errors.push('Event key cannot be empty');
  }

  // Validate event key format (basic validation)
  if (eventKey && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(eventKey)) {
    errors.push('Event key must be a valid field name (alphanumeric and underscore only)');
  }

  // Validate event value
  const eventValue = eventData[eventKey];
  if (eventValue === undefined) {
    errors.push('Event value cannot be undefined');
  }

  return {
    isValid: errors.length === 0,
    errors,
    eventKey: keys[0],
    eventValue: eventData[keys[0]]
  };
}

/**
 * Validate component configuration for onChange
 * @param {Object} component - Component to validate
 * @returns {Object} Validation result
 */
function validateChangeComponent(component) {
  const errors = [];
  
  if (!component) {
    errors.push('Component is required');
    return { isValid: false, errors };
  }

  if (!component.key) {
    errors.push('Component key is required');
  }

  if (!component.type) {
    errors.push('Component type is required');
  }

  // Validate onChange configuration if present
  if (component.onChange) {
    const onChangeErrors = validateOnChangeConfig(component.onChange, component.key);
    errors.push(...onChangeErrors);
  }

  // Validate apiSource configuration if present
  if (component.apiSource) {
    const apiSourceErrors = validateApiSourceConfig(component.apiSource, component.key);
    errors.push(...apiSourceErrors);
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Validate onChange configuration
 * @param {Object} onChange - onChange configuration
 * @param {String} componentKey - Component key for error context
 * @returns {Array} Array of error messages
 */
function validateOnChangeConfig(onChange, componentKey) {
  const errors = [];
  
  if (typeof onChange !== 'object') {
    errors.push(`Component ${componentKey}: onChange must be an object`);
    return errors;
  }

  // Validate refreshField
  if (onChange.refreshField) {
    if (typeof onChange.refreshField !== 'string' && !Array.isArray(onChange.refreshField)) {
      errors.push(`Component ${componentKey}: onChange.refreshField must be a string or array of strings`);
    } else if (Array.isArray(onChange.refreshField)) {
      onChange.refreshField.forEach((field, index) => {
        if (typeof field !== 'string' || field.trim() === '') {
          errors.push(`Component ${componentKey}: onChange.refreshField[${index}] must be a non-empty string`);
        }
      });
    } else if (onChange.refreshField.trim() === '') {
      errors.push(`Component ${componentKey}: onChange.refreshField cannot be empty`);
    }
  }

  // Validate condition if present
  if (onChange.condition && typeof onChange.condition !== 'string') {
    errors.push(`Component ${componentKey}: onChange.condition must be a string`);
  }

  // Validate validateFields if present
  if (onChange.validateFields) {
    if (typeof onChange.validateFields !== 'string' && !Array.isArray(onChange.validateFields)) {
      errors.push(`Component ${componentKey}: onChange.validateFields must be a string or array of strings`);
    }
  }

  return errors;
}

/**
 * Validate API source configuration
 * @param {Object} apiSource - API source configuration
 * @param {String} componentKey - Component key for error context
 * @returns {Array} Array of error messages
 */
function validateApiSourceConfig(apiSource, componentKey) {
  const errors = [];
  
  if (typeof apiSource !== 'object') {
    errors.push(`Component ${componentKey}: apiSource must be an object`);
    return errors;
  }

  // Validate source
  if (!apiSource.source || typeof apiSource.source !== 'string') {
    errors.push(`Component ${componentKey}: apiSource.source is required and must be a string`);
  }

  // Validate valueKey if present
  if (apiSource.valueKey && typeof apiSource.valueKey !== 'string') {
    errors.push(`Component ${componentKey}: apiSource.valueKey must be a string`);
  }

  // Validate labelKey if present
  if (apiSource.labelKey && typeof apiSource.labelKey !== 'string') {
    errors.push(`Component ${componentKey}: apiSource.labelKey must be a string`);
  }

  // Validate dataPath if present
  if (apiSource.dataPath && !Array.isArray(apiSource.dataPath)) {
    errors.push(`Component ${componentKey}: apiSource.dataPath must be an array`);
  }

  // Validate dependsOn if present
  if (apiSource.dependsOn) {
    if (typeof apiSource.dependsOn !== 'string' && !Array.isArray(apiSource.dependsOn)) {
      errors.push(`Component ${componentKey}: apiSource.dependsOn must be a string or array of strings`);
    }
  }

  return errors;
}

/**
 * Validate schema for onChange processing
 * @param {Object} schema - Schema to validate
 * @returns {Object} Validation result
 */
function validateChangeSchema(schema) {
  const errors = [];
  
  if (!schema) {
    errors.push('Schema is required');
    return { isValid: false, errors };
  }

  if (!schema.components || !Array.isArray(schema.components)) {
    errors.push('Schema must contain a components array');
    return { isValid: false, errors };
  }

  // Validate each component
  const componentErrors = [];
  schema.components.forEach((component, index) => {
    const componentValidation = validateChangeComponent(component);
    if (!componentValidation.isValid) {
      componentErrors.push(`Component ${index}: ${componentValidation.errors.join(', ')}`);
    }
  });

  errors.push(...componentErrors);

  return {
    isValid: errors.length === 0,
    errors,
    componentCount: schema.components.length,
    validComponents: schema.components.length - componentErrors.length
  };
}

/**
 * Validate API configurations
 * @param {Object} apiConfigs - API configurations to validate
 * @returns {Object} Validation result
 */
function validateApiConfigs(apiConfigs) {
  const errors = [];
  
  if (!apiConfigs) {
    return { isValid: true, errors: [], apiCount: 0 };
  }

  if (typeof apiConfigs !== 'object') {
    errors.push('API configurations must be an object');
    return { isValid: false, errors };
  }

  const apiCount = Object.keys(apiConfigs).length;
  const validApis = [];
  
  Object.entries(apiConfigs).forEach(([apiName, apiConfig]) => {
    const apiErrors = validateApiConfig(apiConfig, apiName);
    if (apiErrors.length === 0) {
      validApis.push(apiName);
    } else {
      errors.push(`API ${apiName}: ${apiErrors.join(', ')}`);
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
    apiCount,
    validApiCount: validApis.length,
    validApis
  };
}

/**
 * Validate individual API configuration
 * @param {Object} apiConfig - API configuration
 * @param {String} apiName - API name for error context
 * @returns {Array} Array of error messages
 */
function validateApiConfig(apiConfig, apiName) {
  const errors = [];
  
  if (!apiConfig || typeof apiConfig !== 'object') {
    errors.push('API configuration must be an object');
    return errors;
  }

  // Validate URL
  if (!apiConfig.url || typeof apiConfig.url !== 'string') {
    errors.push('API URL is required and must be a string');
  } else {
    try {
      new URL(apiConfig.url.replace(/:(\w+)/g, 'placeholder')); // Replace path params for validation
    } catch (e) {
      errors.push('API URL must be a valid URL format');
    }
  }

  // Validate method
  if (apiConfig.method && typeof apiConfig.method !== 'string') {
    errors.push('API method must be a string');
  } else if (apiConfig.method && !['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(apiConfig.method.toUpperCase())) {
    errors.push('API method must be a valid HTTP method');
  }

  // Validate headers
  if (apiConfig.headers && typeof apiConfig.headers !== 'object') {
    errors.push('API headers must be an object');
  }

  // Validate params
  if (apiConfig.params && typeof apiConfig.params !== 'object') {
    errors.push('API params must be an object');
  }

  return errors;
}

module.exports = {
  validateChangeEvent,
  validateChangeComponent,
  validateOnChangeConfig,
  validateApiSourceConfig,
  validateChangeSchema,
  validateApiConfigs,
  validateApiConfig
};
