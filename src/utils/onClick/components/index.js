const fillDataGridComponent = require('./datagrid');
const fillSelectComponent = require('./select');
const fillContentComponent = require('./content');
const fillDefaultComponent = require('./default');

function processComponent(component, apiData, eventData) {
  if (!component) return component;

  // Process based on component type
  switch (component.type) {
    case 'datagrid':
      return fillDataGridComponent(component, apiData, eventData);
    case 'select':
    case 'selectboxes':
      return fillSelectComponent(component, apiData, eventData);
    case 'content':
      return fillContentComponent(component, apiData, eventData);
    default:
      return fillDefaultComponent(component, apiData, eventData);
  }
}

function fillComponentWithData(schema, apiData, eventData) {
  if (!schema || !schema.components) return schema;

  const filledComponents = schema.components.map(comp => {
    let filledComp = processComponent(comp, apiData, eventData);

    // Handle nested components recursively
    if (comp.components) {
      filledComp.components = fillComponentWithData(
        { components: comp.components },
        apiData,
        eventData
      ).components;
    }

    return filledComp;
  });

  return { ...schema, components: filledComponents };
}

module.exports = fillComponentWithData;
