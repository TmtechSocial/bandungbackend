// utils/schemaUtils.js - Schema processing utilities
const { deepClone } = require('./commonUtils');

/**
 * Fill schema components with event data for components without dependsOn and affects
 * @param {Object} schema - The schema JSON object
 * @param {Object} eventData - The event data from request body
 * @returns {Object} - Modified schema with filled values
 */
async function fillSchemaWithEventData(schema, eventData) {
  const filledSchema = deepClone(schema);
  
  if (!filledSchema.components || !Array.isArray(filledSchema.components)) {
    return filledSchema;
  }

  // Process each component
  for (let component of filledSchema.components) {
    await processComponent(component, eventData);
  }

  return filledSchema;
}

/**
 * Process individual component and its nested components
 * @param {Object} component - Schema component
 * @param {Object} eventData - Event data
 */
async function processComponent(component, eventData) {
  // Check if component should be auto-filled
  if (shouldAutoFillComponent(component)) {
    fillComponentValue(component, eventData);
  }

  // Process nested components (like in datagrid)
  if (component.components && Array.isArray(component.components)) {
    for (let nestedComponent of component.components) {
      await processComponent(nestedComponent, eventData);
    }
  }
}

/**
 * Determine if a component should be auto-filled
 * @param {Object} component - Schema component
 * @returns {boolean} - True if should be auto-filled
 */
function shouldAutoFillComponent(component) {
  // Skip if component has dependsOn or affects (these are handled by events)
  if (component.dependsOn || component.affects) {
    return false;
  }

  // Skip buttons and content types
  if (component.type === 'button' || component.type === 'content') {
    return false;
  }

  // Skip if component is disabled and not input
  if (component.disabled && !component.input) {
    return false;
  }

  // Skip if component is hidden and not an input
  if (component.hidden && !component.input) {
    return false;
  }

  return true;
}

/**
 * Fill component value with data from event
 * @param {Object} component - Schema component
 * @param {Object} eventData - Event data
 */
function fillComponentValue(component, eventData) {
  const componentKey = component.key;
  
  if (!componentKey || !eventData || typeof eventData !== 'object') {
    return;
  }

  // Get value from event data
  const value = getValueFromEventData(eventData, componentKey);
  
  if (value !== undefined && value !== null) {
    // Set the default value for the component
    component.defaultValue = value;
    
    // For some component types, also set the value property
    if (component.type === 'textfield' || 
        component.type === 'textarea' || 
        component.type === 'number' || 
        component.type === 'select') {
      component.value = value;
    }

    // Special handling for datagrid components
    if (component.type === 'datagrid' && Array.isArray(value)) {
      component.defaultValue = value;
      component.value = value;
    }

    console.log(`Auto-filled component "${componentKey}" with value:`, value);
  }
}

/**
 * Get value from event data using component key
 * @param {Object} eventData - Event data
 * @param {string} key - Component key
 * @returns {*} - Found value or undefined
 */
function getValueFromEventData(eventData, key) {
  // Direct property access
  if (eventData.hasOwnProperty(key)) {
    return eventData[key];
  }

  // Check nested properties (dot notation support)
  if (key.includes('.')) {
    const keys = key.split('.');
    let value = eventData;
    
    for (let nestedKey of keys) {
      if (value && typeof value === 'object' && value.hasOwnProperty(nestedKey)) {
        value = value[nestedKey];
      } else {
        return undefined;
      }
    }
    
    return value;
  }

  return undefined;
}

/**
 * Get components that were auto-filled
 * @param {Object} originalSchema - Original schema
 * @param {Object} filledSchema - Filled schema
 * @returns {Array} - List of auto-filled components
 */
function getAutoFilledComponents(originalSchema, filledSchema) {
  const autoFilled = [];
  
  function compareComponents(original, filled, path = '') {
    if (!original.components || !filled.components) return;
    
    for (let i = 0; i < original.components.length; i++) {
      const origComp = original.components[i];
      const filledComp = filled.components[i];
      
      if (!origComp || !filledComp) continue;
      
      const currentPath = path ? `${path}.${origComp.key}` : origComp.key;
      
      // Check if value was added
      if ((!origComp.defaultValue && filledComp.defaultValue) ||
          (!origComp.value && filledComp.value)) {
        autoFilled.push({
          key: origComp.key,
          path: currentPath,
          type: origComp.type,
          oldValue: origComp.defaultValue || origComp.value,
          newValue: filledComp.defaultValue || filledComp.value
        });
      }
      
      // Recursively check nested components
      if (origComp.components && filledComp.components) {
        compareComponents(origComp, filledComp, currentPath);
      }
    }
  }
  
  compareComponents(originalSchema, filledSchema);
  return autoFilled;
}

module.exports = {
  fillSchemaWithEventData,
  processComponent,
  shouldAutoFillComponent,
  fillComponentValue,
  getValueFromEventData,
  getAutoFilledComponents
};