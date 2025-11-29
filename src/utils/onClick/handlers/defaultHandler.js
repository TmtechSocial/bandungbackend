const processDefaultComponent = (component, apiData) => {
  // Handle components with table reference
  if (component.table && apiData?.graph) {
    const tableData = Object.values(apiData.graph).find(data => 
      Array.isArray(data) && data.length > 0 && data[0][component.key] !== undefined
    );
    if (tableData) {
      return {
        ...component,
        defaultValue: tableData[0][component.key]
      };
    }
  }

  // Handle components with apiSource
  if (component.apiSource) {
    const { source, valueKey } = component.apiSource;
    const apiResult = apiData?.[source];
    if (apiResult) {
      return {
        ...component,
        defaultValue: apiResult[valueKey]
      };
    }
  }

  // Handle regular components with graph data
  if (apiData?.graph) {
    const graphData = Object.values(apiData.graph)[0];
    if (Array.isArray(graphData) && graphData.length > 0 && graphData[0][component.key] !== undefined) {
      return {
        ...component,
        defaultValue: graphData[0][component.key]
      };
    }
  }

  return component;
};

module.exports = processDefaultComponent;
