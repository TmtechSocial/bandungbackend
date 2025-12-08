// // Enhanced onChange with full onRender capabilities
// const axios = require('axios');
// const {
//   configureProcess,
//   configureQuery,
// } = require("../../controller/controllerConfig");
// const { getMember } = require("../ldap/ldapHierarki");

// // Import all onRender modules for comprehensive functionality
// const setupDependencies = require("../onRender/event/setupDependencies");
// const setupHandlers = require("../onRender/event/setupHandlers");
// const loadInitialApiData = require("../onRender/api/loadInitialApiData");
// const { processQueryData } = require("../onRender/utils/queryProcessor");
// const processComponents = require('./process/processComponents');
// const createFormState = require("../onRender/formState");
// const updateComponent = require('../onRender/process/updateComponent');

// /**
//  * Validate component for onChange processing
//  * @param {Object} component - Component to validate
//  * @returns {Object} Validation result
//  */
// function validateRefreshComponent(component) {
//   const errors = [];
  
//   if (!component) {
//     errors.push('Component not found');
//     return { isValid: false, errors };
//   }
  
//   if (!component.key) {
//     errors.push('Component key is required');
//   }
  
//   if (!component.type) {
//     errors.push('Component type is required');
//   }
  
//   // Validate component type is supported
//   const supportedTypes = ['select', 'selectboxes', 'datagrid', 'editgrid', 'content', 'textfield', 'textarea', 'number', 'checkbox'];
//   if (component.type && !supportedTypes.includes(component.type)) {
//     errors.push(`Component type '${component.type}' may not be fully supported`);
//   }
  
//   return {
//     isValid: errors.length === 0,
//     errors,
//     warnings: errors.filter(e => e.includes('may not be'))
//   };
// }

// async function dynamicChange(fastify, process, event, instance = null, session = null) {
//   const startTime = Date.now();
  
//   // Add performance monitoring like onRender
//   const performanceMonitor = {
//     calls: 0,
//     totalTime: 0,
//     recordCall: (duration, metadata = {}) => {
//       performanceMonitor.calls++;
//       performanceMonitor.totalTime += duration;
//       if (duration > 5000) { // Log slow onChange calls
//         console.warn(`Slow onChange call: ${duration}ms`, metadata);
//       }
//     }
//   };

//   try {
//     console.log(`=== Enhanced dynamicChange started for process: ${process} ===`);
    
//     // Step 1: Parallel member loading like onRender
//     const memberPromise = getMember(fastify, session);

//     // Step 2: Get configuration (schema & event) - ALWAYS FRESH like onRender
//     const configResult = await configureProcess(fastify, process);
//     const getSchema = getEvent = configResult;

//     // Determine schema type based on instance like onRender
//     const schema = Array.isArray(instance)
//       ? getSchema[0].schema_grid_json
//       : getSchema[0].schema_json;

//     const { onRender: renderEvent, ...otherEvent } = getEvent[0].event_json;
//     let onRenderDetails = renderEvent;

//     // Step 3: Handle instance and graph variables like onRender
//     if (instance && (Array.isArray(instance) ? instance.length > 0 : true)) {
//       const { graph } = renderEvent;
//       if (graph && graph.variables) {
//         onRenderDetails = {
//           ...renderEvent,
//           graph: {
//             ...graph,
//             variables: {
//               ...graph.variables,
//               proc_inst_id: instance,
//             },
//           },
//         };
//       }
//     }

//     // Step 4: Create form state and setup dependencies like onRender
//     const formState = createFormState(schema, session);
//     setupDependencies(schema, formState);

//     // Step 5: Update graph variables with event data for onChange
//     if (event && Object.keys(event).length > 0) {
//       const eventKey = Object.keys(event)[0];
//       const eventValue = event[eventKey];
      
//       console.log(`Processing enhanced change event for: ${eventKey} = ${eventValue}`);
      
//       // Merge event data into graph variables
//       if (onRenderDetails.graph && onRenderDetails.graph.variables) {
//         onRenderDetails.graph = {
//           ...onRenderDetails.graph,
//           variables: {
//             ...onRenderDetails.graph.variables,
//             [eventKey]: eventValue
//           }
//         };
//       }
//     }

//     // Step 6: Execute Query for onChange processing
//     const responseQuery = await configureQuery(fastify, onRenderDetails);
//     if (!responseQuery || !responseQuery.data) {
//       throw new Error("Failed to configure query for onChange");
//     }

//     console.log(`Query executed successfully for onChange`);

//     // Step 7: Load API data for components that need it
//     const apiDataResult = await loadInitialApiData(
//       onRenderDetails.api,
//       schema,
//       responseQuery.data,
//       formState,
//       session
//     );

//     // Step 8: Wait for member result
//     const memberResult = await memberPromise;

//     // Handle onChange event
//     if (event && Object.keys(event).length > 0) {
//       const eventKey = Object.keys(event)[0]; // Get the key from event (e.g., "product_name")
//       const eventValue = event[eventKey]; // Get the value (e.g., 2)
      
//       console.log(`Processing change event for: ${eventKey} = ${eventValue}`);
      
//       // Find the component in schema that matches the event key
//       const component = schema.components.find(comp => comp.key === eventKey);
      
//       if (component && component.onChange && component.onChange.refreshField) {
//         // Handle single refresh field or array of refresh fields
//         const refreshFieldKeys = Array.isArray(component.onChange.refreshField) 
//           ? component.onChange.refreshField 
//           : [component.onChange.refreshField];
        
//         console.log(`Found onChange with refreshFields: ${refreshFieldKeys.join(', ')}`);
        
//         // Array to store updated components
//         const updatedComponents = [];
        
//         // Process each refresh field
//         for (const refreshFieldKey of refreshFieldKeys) {
//           // Find the refreshField component in the schema
//           const refreshComponent = schema.components.find(comp => comp.key === refreshFieldKey);
          
//           // Validate refresh component
//           const validation = validateRefreshComponent(refreshComponent);
//           if (!validation.isValid) {
//             console.error(`Invalid refresh component ${refreshFieldKey}:`, validation.errors);
//             continue; // Skip invalid components
//           }
          
//           if (validation.warnings.length > 0) {
//             console.warn(`Warnings for component ${refreshFieldKey}:`, validation.warnings);
//           }
          
//           console.log(`Processing valid refresh component: ${refreshFieldKey} (type: ${refreshComponent.type})`)
          
          
//           if (refreshComponent && refreshComponent.apiSource) {
//             const apiSourceName = refreshComponent.apiSource.source;
//             console.log(`Processing refresh field: ${refreshFieldKey} with API source: ${apiSourceName}`);
            
//             // Get the API details from event.json
//             const apiDetails = renderEvent.api[apiSourceName];
            
//             if (apiDetails) {
//               console.log(`API details found for ${apiSourceName}`);
              
//               // Create params by replacing template variables in apiDetails.params
//               let params = {};
              
//               if (apiDetails.params) {
//                 params = { ...apiDetails.params };
                
//                 // Replace template variables with actual values from the event
//                 Object.keys(params).forEach(paramKey => {
//                   const paramValue = params[paramKey];
//                   if (typeof paramValue === 'string' && paramValue.includes('${')) {
//                     const templateVar = paramValue.match(/\${([^}]+)}/)[1];
//                     if (templateVar === eventKey) {
//                       params[paramKey] = eventValue;
//                     }
//                   }
//                 });
//               }
              
//               // Handle dependsOn in apiSource if it exists
//               if (refreshComponent.apiSource.dependsOn === eventKey) {
//                 // If the API source directly depends on the changed field
//                 params[eventKey] = eventValue;
//               }

//               let finalUrl = apiDetails.url;
//                 // Ganti placeholder di URL dengan nilai dari event
//               if (apiDetails.path) {
//                 Object.entries(apiDetails.path).forEach(([key, rawValue]) => {
//                   let value = rawValue;

//                   if (typeof value === 'string' && value.includes('${')) {
//                     const templateVar = value.match(/\${([^}]+)}/)[1];
//                     value = event[templateVar];
//                   }

//                   finalUrl = finalUrl.replace(`:${key}`, value);
//                 });
//               }
//               // Make the API call
//               try {
//                 console.log(`Making API call to: ${apiDetails.url} with params: ${JSON.stringify(params)}`);

//                 const apiResponse = await axios({
//                   method: apiDetails.method,
//                   url: finalUrl,
//                   headers: apiDetails.headers,
//                   params: {
//                     ...params,
//                     ...(apiDetails.query || {}), // if you separate path vs query params
//                   }
//                 });

//                 console.log("apiResponse", apiResponse.data.results)

//                 console.log(`API call successful for ${refreshFieldKey}!`);
                
//                 // Enhanced: Use onChange-specific processor
//                 // Store API data in formState for component processing
//                 if (!formState.apiResults) {
//                   formState.apiResults = {};
//                 }
//                 formState.apiResults[apiSourceName] = apiResponse.data.results;

//                 // Process the component using onChange-optimized logic
//                 const processingResult = await processComponents(
//                   [refreshComponent], // Process only this refresh component
//                   responseQuery.data,
//                   formState,
//                   session,
//                   onRenderDetails.api,
//                   memberResult
//                 );
                
//                 console.log(`[onChange] Component processing result:`, {
//                   success: processingResult.success,
//                   processedCount: processingResult.processedCount,
//                   totalTime: processingResult.timing?.totalTime || 0,
//                   errors: processingResult.errors?.length || 0
//                 });
                
//                 if (!processingResult.success) {
//                   console.warn(`[onChange] Processing warnings for ${refreshFieldKey}:`, processingResult.errors);
//                 }
                
//                 console.log(`Updated component with onChange processor: ${refreshFieldKey}`);
                
//                 // Add to list of updated components
//                 updatedComponents.push(refreshComponent);
//               } catch (apiError) {
//                 console.error(`API call failed for ${refreshFieldKey}:`, apiError);
//                 throw new Error(`API call failed for ${refreshFieldKey}: ${apiError.message}`);
//               }
//             } else {
//               console.warn(`No API details found for ${apiSourceName}`);
//             }
//           } else {
//             // Enhanced: Handle components without apiSource using component-specific processing
//             // Create a copy of renderEvent with updated graph variables
//             let onRenderDetails = { ...renderEvent };
            
//             // Check if graph and variables exist
//             if (renderEvent.graph && renderEvent.graph.variables) {
//               // Create a deep copy of the graph section
//               onRenderDetails.graph = {
//                 ...renderEvent.graph,
//                 variables: {
//                   ...renderEvent.graph.variables,
//                   // Add the event value to the variables
//                   [eventKey]: eventValue
//                 }
//               };
              
//               console.log(`Updating graph variables with ${eventKey}=${eventValue}`);
//             }

//             try {
//               // Configure the query with updated renderEvent
//               const responseQuery = await configureQuery(fastify, onRenderDetails);
//               if (!responseQuery || !responseQuery.data) {
//                 throw new Error("Failed to get data from configureQuery");
//               }
              
//               // Enhanced: Process the component using onChange-optimized processor
//               if (refreshComponent) {
//                 const processingResult = await processComponents(
//                   [refreshComponent], // Process only this refresh component
//                   responseQuery.data,
//                   formState,
//                   session,
//                   onRenderDetails.api,
//                   memberResult
//                 );
                
//                 console.log(`[onChange] Component processing result (no apiSource):`, {
//                   success: processingResult.success,
//                   processedCount: processingResult.processedCount,
//                   totalTime: processingResult.timing?.totalTime || 0,
//                   errors: processingResult.errors?.length || 0
//                 });
                
//                 if (!processingResult.success) {
//                   console.warn(`[onChange] Processing warnings for ${refreshFieldKey}:`, processingResult.errors);
//                 }
                
//                 console.log(`Updated component without apiSource using onChange processor: ${refreshFieldKey}`);
//                 updatedComponents.push(refreshComponent);
//               }
//             } catch (queryError) {
//               console.error("Error in configureQuery:", queryError);
//               throw new Error(`Failed to process component ${refreshFieldKey}: ${queryError.message}`);
//             }
//           }
//         }
        
//         // Enhanced: Return all updated components with performance stats
//         if (updatedComponents.length > 0) {
//           const duration = Date.now() - startTime;
//           performanceMonitor.recordCall(duration, { 
//             process, 
//             eventKey, 
//             refreshComponentCount: updatedComponents.length 
//           });
          
//           console.log(`onChange completed: Updated ${updatedComponents.length} components in ${duration}ms`);
          
//           return {
//             data: updatedComponents,
//             stats: {
//               duration,
//               componentCount: updatedComponents.length,
//               eventKey,
//               eventValue,
//               updatedComponents: updatedComponents.map(c => c.key)
//             }
//           };
//         }
//       }
//     }

//     // Enhanced: If no specific event processing happened, return comprehensive response
//     const duration = Date.now() - startTime;
//     performanceMonitor.recordCall(duration, { process, eventKey: 'none' });
    
//     console.log(`onChange completed with no changes in ${duration}ms`);
    
//     return {
//       schema,
//       onRender: renderEvent,
//       event: otherEvent,
//       message: "No components required onChange processing",
//       stats: {
//         duration,
//         componentCount: 0,
//         eventProcessed: false
//       }
//     };
//   } catch (error) {
//     const duration = Date.now() - startTime;
//     performanceMonitor.recordCall(duration, { 
//       process, 
//       error: error.message,
//       eventKey: event ? Object.keys(event)[0] : 'unknown' 
//     });
    
//     console.error(`onChange failed after ${duration}ms:`, error.message);
//     console.error(`Stack trace:`, error.stack);
    
//     throw new Error(`Enhanced onChange failed: ${error.message}`);
//   }
// }

// /**
//  * Get component processor mapping for onChange
//  * @returns {Object} Component processors
//  */
// function getComponentProcessors() {
//   return {
//     select: require('../onRender/process/select'),
//     selectboxes: require('../onRender/process/selectboxes'),
//     datagrid: require('../onRender/process/datagrid'),
//     editgrid: require('../onRender/process/editgrid'),
//     content: require('../onRender/process/content'),
//     default: require('../onRender/process/default')
//   };
// }

// module.exports = dynamicChange;
