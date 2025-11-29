const { getNestedValue } = require("../utils/helpers");

function fillContentComponent(component, apiData, eventData) {
  if (component.type !== 'content') return component;

  let filledComp = { ...component };

  if (component.apiSource) {
    const { valueKey } = component.apiSource;
    const contentValue = getNestedValue(apiData, valueKey);
    
    if (contentValue) {
      // Replace template variables in HTML content
      filledComp.html = filledComp.html.replace(/\${([^}]+)}/g, (_, key) => {
        return getNestedValue({ ...apiData, ...eventData }, key) || '';
      });
    }
  }

  return filledComp;
}

module.exports = fillContentComponent;
