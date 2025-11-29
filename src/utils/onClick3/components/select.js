const { getNestedValue } = require("../utils/helpers");

function fillSelectComponent(component, apiData, eventData) {
  if (!['select', 'selectboxes'].includes(component.type)) return component;

  let filledComp = { ...component };

  // Handle data source from API if specified
  if (component.apiSource) {
    const { valueKey, labelKey } = component.apiSource;
    const sourceData = getNestedValue(apiData, valueKey);
    
    if (Array.isArray(sourceData)) {
      filledComp.data = {
        values: sourceData.map(item => ({
          value: item[valueKey] || '',
          label: item[labelKey] || ''
        }))
      };
    }
  }

  // Handle dependent value
  if (component.dependsOn && eventData[component.dependsOn]) {
    filledComp.defaultValue = eventData[component.dependsOn];
  }

  return filledComp;
}

module.exports = fillSelectComponent;
