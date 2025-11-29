const { getNestedValue } = require("../utils/helpers");

function fillDefaultComponent(component, apiData, eventData) {
  let filledComp = { ...component };

  // Handle API source data
  if (component.apiSource) {
    const { valueKey } = component.apiSource;
    const apiValue = getNestedValue(apiData, valueKey);
    if (apiValue !== undefined) {
      filledComp.defaultValue = apiValue;
    }
  }

  // Handle dependent value
  if (component.dependsOn && eventData[component.dependsOn]) {
    filledComp.defaultValue = eventData[component.dependsOn];
  }

  return filledComp;
}

module.exports = fillDefaultComponent;
