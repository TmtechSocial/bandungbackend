const processDatagridComponent = require('./datagridHandler');
const processSelectComponent = require('./selectHandler');
const processDefaultComponent = require('./defaultHandler');

const processComponent = (component, apiData, event, clickedButton) => {
  // Check if component should be updated
  const isAffected = clickedButton.affects && clickedButton.affects.includes(component.key);
  const isDependant = component.dependsOn && Object.keys(event).includes(component.dependsOn);

  // Set default value from event data if exists and no updates needed
  if (event[component.key] !== undefined && !isAffected && !isDependant) {
    return {
      ...component,
      defaultValue: event[component.key]
    };
  }

  // Process components that need updating
  if (isAffected || isDependant) {
    switch (component.type) {
      case 'datagrid':
        return processDatagridComponent(component, apiData, event);
      case 'select':
        return processSelectComponent(component, apiData);
      default:
        return processDefaultComponent(component, apiData);
    }
  }

  // Return original component if no updates needed
  return component;
};

module.exports = processComponent;
