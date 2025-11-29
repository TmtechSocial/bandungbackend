// utils/loggerUtils.js - Logging utilities for schema filling
const { getAutoFilledComponents } = require('./schemaUtils');

/**
 * Log the schema filling process
 * @param {Object} originalSchema - Original schema
 * @param {Object} filledSchema - Filled schema
 * @param {Object} eventData - Event data used for filling
 */
function logSchemaFilling(originalSchema, filledSchema, eventData) {
  const autoFilledComponents = getAutoFilledComponents(originalSchema, filledSchema);
  
  console.log('\n=== SCHEMA AUTO-FILL REPORT ===');
  console.log(`Event Data Keys: ${Object.keys(eventData).join(', ')}`);
  console.log(`Total Components Processed: ${countComponents(originalSchema)}`);
  console.log(`Auto-Filled Components: ${autoFilledComponents.length}`);
  
  if (autoFilledComponents.length > 0) {
    console.log('\n--- AUTO-FILLED COMPONENTS ---');
    autoFilledComponents.forEach(comp => {
      console.log(`✓ ${comp.key} (${comp.type})`);
      console.log(`  Path: ${comp.path}`);
      console.log(`  Value: ${JSON.stringify(comp.newValue)}`);
      console.log(`  Previous: ${comp.oldValue || 'undefined'}`);
      console.log('');
    });
  } else {
    console.log('\n--- NO COMPONENTS WERE AUTO-FILLED ---');
    console.log('Reasons could be:');
    console.log('- All components have dependsOn or affects properties');
    console.log('- Component keys don\'t match event data keys');
    console.log('- Components are disabled/hidden non-input types');
    console.log('- Event data is empty or malformed');
  }
  
  console.log('=== END SCHEMA AUTO-FILL REPORT ===\n');
}

/**
 * Count total components in schema (including nested)
 * @param {Object} schema - Schema object
 * @returns {number} - Total component count
 */
function countComponents(schema) {
  if (!schema.components || !Array.isArray(schema.components)) {
    return 0;
  }
  
  let count = 0;
  
  function countRecursive(components) {
    for (let component of components) {
      count++;
      if (component.components && Array.isArray(component.components)) {
        countRecursive(component.components);
      }
    }
  }
  
  countRecursive(schema.components);
  return count;
}

/**
 * Log component analysis for debugging
 * @param {Object} component - Component to analyze
 * @param {Object} eventData - Event data
 */
function logComponentAnalysis(component, eventData) {
  console.log(`\n--- COMPONENT ANALYSIS: ${component.key} ---`);
  console.log(`Type: ${component.type}`);
  console.log(`Has dependsOn: ${!!component.dependsOn}`);
  console.log(`Has affects: ${!!component.affects}`);
  console.log(`Is disabled: ${!!component.disabled}`);
  console.log(`Is hidden: ${!!component.hidden}`);
  console.log(`Is input: ${!!component.input}`);
  console.log(`Current value: ${component.value || component.defaultValue || 'undefined'}`);
  console.log(`Event data has key: ${eventData.hasOwnProperty(component.key)}`);
  if (eventData.hasOwnProperty(component.key)) {
    console.log(`Event data value: ${JSON.stringify(eventData[component.key])}`);
  }
  console.log('--- END COMPONENT ANALYSIS ---\n');
}

/**
 * Log detailed schema structure
 * @param {Object} schema - Schema to log
 */
function logSchemaStructure(schema) {
  console.log('\n=== SCHEMA STRUCTURE ===');
  
  if (!schema.components || !Array.isArray(schema.components)) {
    console.log('No components found in schema');
    return;
  }
  
  function logComponentStructure(component, depth = 0) {
    const indent = '  '.repeat(depth);
    const deps = component.dependsOn ? ` [depends: ${component.dependsOn}]` : '';
    const affects = component.affects ? ` [affects: ${component.affects.join(', ')}]` : '';
    const disabled = component.disabled ? ' [disabled]' : '';
    const hidden = component.hidden ? ' [hidden]' : '';
    
    console.log(`${indent}- ${component.key} (${component.type})${deps}${affects}${disabled}${hidden}`);
    
    if (component.components && Array.isArray(component.components)) {
      component.components.forEach(nested => {
        logComponentStructure(nested, depth + 1);
      });
    }
  }
  
  schema.components.forEach(component => {
    logComponentStructure(component);
  });
  
  console.log('=== END SCHEMA STRUCTURE ===\n');
}

module.exports = {
  logSchemaFilling,
  countComponents,
  logComponentAnalysis,
  logSchemaStructure
};