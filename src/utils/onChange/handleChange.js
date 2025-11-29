const axios = require('axios');
const {
  configureProcess,
  configureQuery,
} = require("../../controller/controllerConfig");
const { getMember } = require("../ldap/ldapHierarki");
const updateComponent = require('../onRender/process/updateComponent');
const processComponents = require('../onRender/process/processComponents');

async function dynamicChange(fastify, process, event) {
  // console.log("event data:", event);

  try {
    const getSchema = await configureProcess(fastify, process);
    const schema = getSchema[0].schema_json;

    const getEvent = await configureProcess(fastify, process);
    const { onRender: renderEvent, ...otherEvent } = getEvent[0].event_json;

    

    // Handle onChange event
    if (event && Object.keys(event).length > 0) {
      const eventKey = Object.keys(event)[0]; // Get the key from event (e.g., "product_name")
      const eventValue = event[eventKey]; // Get the value (e.g., 2)
      
      console.log(`Processing change event for: ${eventKey} = ${eventValue}`);
      
      // Find the component in schema that matches the event key
      const component = schema.components.find(comp => comp.key === eventKey);
      
      if (component && component.onChange && component.onChange.refreshField) {
        // Handle single refresh field or array of refresh fields
        const refreshFieldKeys = Array.isArray(component.onChange.refreshField) 
          ? component.onChange.refreshField 
          : [component.onChange.refreshField];
        
        console.log(`Found onChange with refreshFields: ${refreshFieldKeys.join(', ')}`);
        
        // Array to store updated components
        const updatedComponents = [];
        
        // Process each refresh field
        for (const refreshFieldKey of refreshFieldKeys) {
          // Find the refreshField component in the schema
          const refreshComponent = schema.components.find(comp => comp.key === refreshFieldKey);
          console.log("refreshComponent", refreshComponent)
          
          
          if (refreshComponent && refreshComponent.apiSource) {
            const apiSourceName = refreshComponent.apiSource.source;
            console.log(`Processing refresh field: ${refreshFieldKey} with API source: ${apiSourceName}`);
            
            // Get the API details from event.json
            const apiDetails = renderEvent.api[apiSourceName];
            
            if (apiDetails) {
              console.log(`API details found for ${apiSourceName}`);
              
              // Create params by replacing template variables in apiDetails.params
              let params = {};
              
              if (apiDetails.params) {
                params = { ...apiDetails.params };
                
                // Replace template variables with actual values from the event
                Object.keys(params).forEach(paramKey => {
                  const paramValue = params[paramKey];
                  if (typeof paramValue === 'string' && paramValue.includes('${')) {
                    const templateVar = paramValue.match(/\${([^}]+)}/)[1];
                    if (templateVar === eventKey) {
                      params[paramKey] = eventValue;
                    }
                  }
                });
              }
              
              // Handle dependsOn in apiSource if it exists
              if (refreshComponent.apiSource.dependsOn === eventKey) {
                // If the API source directly depends on the changed field
                params[eventKey] = eventValue;
              }

              let finalUrl = apiDetails.url;
                // Ganti placeholder di URL dengan nilai dari event
              if (apiDetails.path) {
                Object.entries(apiDetails.path).forEach(([key, rawValue]) => {
                  let value = rawValue;

                  if (typeof value === 'string' && value.includes('${')) {
                    const templateVar = value.match(/\${([^}]+)}/)[1];
                    value = event[templateVar];
                  }

                  finalUrl = finalUrl.replace(`:${key}`, value);
                });
              }
              // Make the API call
              try {
                console.log(`Making API call to: ${apiDetails.url} with params: ${JSON.stringify(params)}`);

                const apiResponse = await axios({
                  method: apiDetails.method,
                  url: finalUrl,
                  headers: apiDetails.headers,
                  params: {
                    ...params,
                    ...(apiDetails.query || {}), // if you separate path vs query params
                  }
                });

                console.log("apiResponse", apiResponse.data.results)

                console.log(`API call successful for ${refreshFieldKey}!`);
                
                // Update the component with the API response data

                updateComponent(refreshComponent, apiResponse.data.results);
                console.log(`Updated component: ${refreshFieldKey}`);
                console.log("refresh component", refreshComponent)
                
                // Add to list of updated components
                updatedComponents.push(refreshComponent);
              } catch (apiError) {
                console.error(`API call failed for ${refreshFieldKey}:`, apiError);
                throw new Error(`API call failed for ${refreshFieldKey}: ${apiError.message}`);
              }
            } else {
              console.warn(`No API details found for ${apiSourceName}`);
            }
          } else {
            // This section is for handling components without apiSource
            // Create a copy of renderEvent with updated graph variables
            let onRenderDetails = { ...renderEvent };
            
            // Check if graph and variables exist
            if (renderEvent.graph && renderEvent.graph.variables) {
              // Create a deep copy of the graph section
              onRenderDetails.graph = {
                ...renderEvent.graph,
                variables: {
                  ...renderEvent.graph.variables,
                  // Add the event value to the variables
                  [eventKey]: eventValue
                }
              };
              
              console.log(`Updating graph variables with ${eventKey}=${eventValue}`);
            }

            try {
              // Configure the query with updated renderEvent
              const responseQuery = await configureQuery(fastify, onRenderDetails);
              if (!responseQuery || !responseQuery.data) {
                throw new Error("Failed to get data from configureQuery");
              }
              
              // Process the component with the query response
              if (refreshComponent) {
                processComponents(refreshComponent, responseQuery.data);
                console.log(`Updated component without apiSource: ${refreshFieldKey}`);
                updatedComponents.push(refreshComponent);
              }
            } catch (queryError) {
              console.error("Error in configureQuery:", queryError);
              throw new Error(`Failed to process component ${refreshFieldKey}: ${queryError.message}`);
            }
          }
        }
        
        // Return all updated components
        if (updatedComponents.length > 0) {
          return {
            data: updatedComponents,
          };
        }
      }
    }

    // If no specific event processing happened, return the default data
    return {
      schema,
      onRender: renderEvent,
      event: otherEvent,
    };
  } catch (error) {
    console.error("Error in dynamicChange:", error);
    throw new Error(`Failed to configure process: ${error.message}`);
  }
}

module.exports = dynamicChange;
