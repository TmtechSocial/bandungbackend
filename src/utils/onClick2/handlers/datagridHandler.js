const processDatagridComponent = (component, apiData, event) => {
  if (!component.source || !event[component.source]) {
    return component;
  }

  const graphData = apiData?.graph?.[component.source] || [];
  
  // Process the data for each row
  const defaultValue = graphData.map(row => {
    const rowData = { ...row };
    
    // Process each subcomponent in the datagrid
    component.components.forEach(subComp => {
      // Handle components with apiSource (e.g., image URLs)
      if (subComp.apiSource) {
        const { source, valueKey } = subComp.apiSource;
        const apiResult = apiData?.[source]?.[row.part_pk];
        rowData[subComp.key] = apiResult?.[valueKey];
      }
      // Handle table-based components (e.g., sku_toko, product_name)
      else if (subComp.table) {
        rowData[subComp.key] = row[subComp.key];
      }
      // Handle content components (e.g., image_preview)
      else if (subComp.type === 'content') {
        rowData[subComp.key] = processContentComponent(subComp, row);
      }
      // Handle default case
      else {
        rowData[subComp.key] = row[subComp.key];
      }
    });
    
    return rowData;
  });

  return {
    ...component,
    defaultValue
  };
};

const processContentComponent = (component, rowData) => {
  if (!component.html) return '';
  
  // Replace template variables in HTML
  return component.html.replace(/{{([^}]+)}}/g, (match, key) => {
    const path = key.trim().split('.');
    return path.reduce((obj, key) => obj?.[key], rowData) || '';
  });
};

module.exports = processDatagridComponent;
