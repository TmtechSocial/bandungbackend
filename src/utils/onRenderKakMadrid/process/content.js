/**
 * Helper function to get nested data using dot notation
 * @param {Object} obj - The object to traverse
 * @param {String} path - Dot notation path (e.g., "mo_retur_receive.invoice_retur_to_invoice")
 * @returns {*} The value at the specified path or null if not found
 */
function getNestedData(obj, path) {
    if (!path || !obj) return null;
    
    const keys = path.split('.');
    let current = obj;
    
    for (const key of keys) {
        if (current && typeof current === 'object' && key in current) {
            current = current[key];
        } else {
            return null;
        }
    }
    
    return current;
}

function processContentComponent(component, queryData, formState, apiConfigs) {
  const { table, key } = component;
  const sourceKey = component.apiSource?.source;
  const valueKey = component.apiSource?.valueKey;
  const apiKey = component.apiSource?.link;
  
  // Process table-based content (supporting nested paths)
  if (table && component.html && queryData) {
    let htmlContentArray = [];
    let tableDataFound = false;
    
    queryData.forEach((queryItem) => {
      // Handle SQL data (direct table match)
      if (queryItem.sqlQuery?.table === table) {
        tableDataFound = true;
        queryItem.sqlQuery.data.forEach((item) => {
          let processedHtml = component.html;
          
          // Replace all placeholders in the HTML template with actual data
          processedHtml = processedHtml.replace(/\{\{\s*row\.(\w+)\s*\}\}/g, (match, fieldName) => {
            return item[fieldName] || '';
          });
          
          htmlContentArray.push(processedHtml);
        });
      }
      
      // Handle Graph data (supporting nested paths)
      if (queryItem.graph) {
        // Try direct table match first
        if (queryItem.graph[table]) {
          tableDataFound = true;
          queryItem.graph[table].forEach((item) => {
            let processedHtml = component.html;
            
            // Replace all placeholders in the HTML template with actual data
            processedHtml = processedHtml.replace(/\{\{\s*row\.(\w+)\s*\}\}/g, (match, fieldName) => {
              return item[fieldName] || '';
            });
            
            htmlContentArray.push(processedHtml);
          });
        } 
        // Try nested path (e.g., "mo_retur_receive.invoice_retur_to_invoice")
        else {
          const nestedData = getNestedData(queryItem.graph, table);
          if (nestedData && Array.isArray(nestedData)) {
            tableDataFound = true;
            nestedData.forEach((item) => {
              let processedHtml = component.html;
              
              // Replace all placeholders in the HTML template with actual data
              processedHtml = processedHtml.replace(/\{\{\s*row\.(\w+)\s*\}\}/g, (match, fieldName) => {
                return item[fieldName] || '';
              });
              
              htmlContentArray.push(processedHtml);
            });
          } else if (nestedData && typeof nestedData === 'object') {
            tableDataFound = true;
            let processedHtml = component.html;
            
            // Replace all placeholders in the HTML template with actual data
            processedHtml = processedHtml.replace(/\{\{\s*row\.(\w+)\s*\}\}/g, (match, fieldName) => {
              return nestedData[fieldName] || '';
            });
            
            htmlContentArray.push(processedHtml);
          }
        }
      }
    });
    
    if (tableDataFound) {
      return htmlContentArray;
    }
  }
  
  // Existing API-based content processing (unchanged)
  // If component has both apiSource and html template, process the template
  if (sourceKey && valueKey && component.html) {
    const apiData = formState.apiResults?.[sourceKey];
    let htmlContentArray = [];
    
    if (apiData) {
      const dataItems = Array.isArray(apiData) ? apiData : [apiData];
      
      dataItems.forEach((dataItem) => {
        if (Array.isArray(dataItem)) {
          dataItem.forEach((item) => {
            const imageUrl = item[valueKey];
            
            if (imageUrl) {
              const fullImageUrl = `${apiKey}${imageUrl}`;
              const processedHtml = component.html.replace(/\$\{[^}]+\}/g, fullImageUrl);
              htmlContentArray.push(processedHtml);
            } else {
              htmlContentArray.push(`
                <div style='text-align:center; padding: 20px; color: #888;'>
                  <span>No Image Available</span>
                </div>
              `);
            }
          });
        } else if (dataItem?.[valueKey]) {
          const imageUrl = dataItem[valueKey];
          const fullImageUrl = `${apiKey}${imageUrl}`;
          const processedHtml = component.html.replace(/\$\{[^}]+\}/g, fullImageUrl);
          htmlContentArray.push(processedHtml);
        } else {
          htmlContentArray.push(`
            <div style='text-align:center; padding: 20px; color: #888;'>
              <span>Image Not Found</span>
            </div>
          `);
        }
      });
    } else {
      htmlContentArray.push(`
        <div style='text-align:center; padding: 20px; color: #888; border: 1px dashed #ccc;'>
          <span>API Data Not Available</span>
        </div>
      `);
    }
    
    return htmlContentArray;
  }
  
  // Fallback to old logic if no apiSource or html template
  if (!sourceKey || !valueKey) {
    return [];
  }
  
  const apiData = formState.apiResults?.[sourceKey];
  let htmlContentArray = [];
  
  if (apiData) {
    const dataItems = Array.isArray(apiData) ? apiData : [apiData];
    
    dataItems.forEach((dataItem) => {
      if (Array.isArray(dataItem)) {
        dataItem.forEach((item) => {
          const imageUrl = item[valueKey];
          
          if (imageUrl) {
            const fullImageUrl = `${apiKey}${imageUrl}`;
            htmlContentArray.push(`
              <div style='text-align:center;'>
                <img src='${fullImageUrl}' alt='Image Content' style='max-width:100%; height:auto;'/>
              </div>
            `);
          } else {
            htmlContentArray.push(`
              <div style='text-align:center; padding: 20px; color: #888;'>
                <span>No Image Available</span>
              </div>
            `);
          }
        });
      } else if (dataItem?.[valueKey]) {
        const imageUrl = dataItem[valueKey];
        const fullImageUrl = `${apiKey}${imageUrl}`;
        htmlContentArray.push(`
          <div style='text-align:center;'>
            <img src='${fullImageUrl}' alt='Image Content' style='max-width:100%; height:auto;'/>
          </div>
        `);
      } else {
        htmlContentArray.push(`
          <div style='text-align:center; padding: 20px; color: #888;'>
            <span>Unknown Content</span>
          </div>
        `);
      }
    });
  } else {
    htmlContentArray.push(`
      <div style='text-align:center; padding: 20px; color: #888; border: 1px dashed #ccc;'>
        <span>API Data Not Available</span>
      </div>
    `);
  }
  
  return htmlContentArray;
}

module.exports = processContentComponent;

