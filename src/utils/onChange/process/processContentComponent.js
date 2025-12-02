// process/processContentComponent.js

/**
 * Helper function to get nested data using dot notation
 * @param {Object} obj - The object to traverse
 * @param {String} path - Dot notation path
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

/**
 * Process template variables in HTML content
 * @param {String} html - HTML content with template variables
 * @param {Object} data - Data object for variable replacement
 * @returns {String} Processed HTML content
 */
function processTemplateVariables(html, data) {
    if (!html || typeof html !== 'string') return html;
    
    // Replace {{variable}} patterns with actual data
    return html.replace(/\{\{([^}]+)\}\}/g, (match, variable) => {
        const value = getNestedData(data, variable.trim());
        return value !== null && value !== undefined ? value : match;
    });
}

/**
 * Process Content Component for onChange
 * Handles HTML content components with dynamic data injection
 * @param {Object} component - The content component to process
 * @param {Array} queryData - SQL/Graph query results
 * @param {Object} formState - Current form state
 * @param {Object} apiConfigs - API configurations
 * @returns {Array} Array of processed HTML content
 */
function processContentComponent(component, queryData, formState, apiConfigs) {
    try {
        console.log(`[onChange] Processing Content component: ${component.key}`);
        
        const htmlContentArray = [];
        const { table, htmlTemplate } = component;
        
        // If component has static HTML, process it
        if (component.html && !table && !component.apiSource) {
            console.log(`[onChange] Processing static HTML content for: ${component.key}`);
            
            let processedHtml = component.html;
            
            // Process template variables if formState data is available
            if (formState && formState.data) {
                processedHtml = processTemplateVariables(processedHtml, formState.data);
            }
            
            htmlContentArray.push(processedHtml);
            return htmlContentArray;
        }

        // Process data from SQL/Graph sources
        if (table && queryData) {
            console.log(`[onChange] Processing dynamic HTML content for table: ${table}`);
            
            queryData.forEach((queryItem) => {
                // Handle SQL data
                if (queryItem.sqlQuery?.table === table) {
                    console.log(`[onChange] Found SQL data for Content table: ${table}`);
                    
                    queryItem.sqlQuery.data.forEach((result) => {
                        let html = htmlTemplate || component.html || '<div>{{name}}</div>';
                        
                        // Process template variables with SQL result data
                        html = processTemplateVariables(html, result);
                        
                        htmlContentArray.push(html);
                    });
                }

                // Handle Graph data (nested object access)
                if (queryItem.graphQuery?.variables && table.includes('.')) {
                    console.log(`[onChange] Processing nested Graph data for Content: ${table}`);
                    
                    const nestedData = getNestedData(queryItem.graphQuery.variables, table);
                    
                    if (nestedData) {
                        if (Array.isArray(nestedData)) {
                            nestedData.forEach((result) => {
                                let html = htmlTemplate || component.html || '<div>{{name}}</div>';
                                html = processTemplateVariables(html, result);
                                htmlContentArray.push(html);
                            });
                        } else {
                            // Single object
                            let html = htmlTemplate || component.html || '<div>{{name}}</div>';
                            html = processTemplateVariables(html, nestedData);
                            htmlContentArray.push(html);
                        }
                    }
                }
            });
        }

        // Process API data if available
        if (component.apiSource && formState && formState.apiResults) {
            const apiSourceName = component.apiSource.source;
            const apiData = formState.apiResults[apiSourceName];
            
            if (apiData) {
                console.log(`[onChange] Processing API data for Content: ${component.key}`);
                
                if (Array.isArray(apiData)) {
                    apiData.forEach((result) => {
                        let html = htmlTemplate || component.html || '<div>{{name}}</div>';
                        html = processTemplateVariables(html, result);
                        htmlContentArray.push(html);
                    });
                } else {
                    // Single object
                    let html = htmlTemplate || component.html || '<div>{{name}}</div>';
                    html = processTemplateVariables(html, apiData);
                    htmlContentArray.push(html);
                }
            }
        }

        // If no data was processed, use default content
        if (htmlContentArray.length === 0) {
            const defaultHtml = component.html || htmlTemplate || '<div>No content available</div>';
            htmlContentArray.push(defaultHtml);
        }

        console.log(`[onChange] Content component processed successfully: ${component.key} (${htmlContentArray.length} items)`);
        
        return htmlContentArray;
        
    } catch (error) {
        console.error(`[onChange] Error processing Content component ${component.key}:`, error);
        
        // Return fallback content
        const fallbackHtml = component.html || '<div>Error loading content</div>';
        
        throw new Error(`Failed to process Content component ${component.key}: ${error.message}`);
    }
}

module.exports = processContentComponent;
