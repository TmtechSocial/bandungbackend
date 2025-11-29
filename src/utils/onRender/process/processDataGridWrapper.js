
const processDataGrid = require("./datagrid");

function processDataGridWrapper(component, queryData, formState, session, apiConfigs, memberResult) {
  // Import processComponents here to avoid circular dependency
  const processComponents = require('./processComponents');
  
  return processDataGrid(component, queryData, formState, session, apiConfigs, memberResult, processComponents);
}

module.exports = processDataGridWrapper;