// Optimized handleRender.js with NO caching and parallel processing
const {
  configureProcess,
  configureQuery,
} = require("../../controller/controllerConfig");
const { getMember } = require("../ldap/ldapHierarki");

const setupDependencies = require("./event/setupDependencies");
const setupHandlers = require("./event/setupHandlers");
const loadInitialApiData = require("./api/loadInitialApiData");
const { processQueryData } = require("./utils/queryProcessor");
const { processSchemaEnvVariables, processEventEnvVariables, logMatchingEnvVars } = require("./utils/envProcessor");
const processComponents = require("./process/processComponents");
const createFormState = require("./formState");

// Semua logika cache DIHAPUS

async function dynamicRender(fastify, process, instance, session) {
  const startTime = Date.now();
  // console.log('Starting dynamicRender with process:', process, 'instance:', instance);

  try {
    // Step 0: Log environment variables for debugging
    // console.log('=== Environment Variables Debug ===');
    logMatchingEnvVars('GRAPHQL|API|HOST|PORT|URL'); // Log common API-related env vars
    // console.log('====================================');

    // Step 1: getMember boleh paralel sejak awal
    const memberPromise = getMember(fastify, session);
    // console.log('Member promise initiated');

    // Step 2: Ambil config (schema & event) - SELALU FRESH
    let getSchema, getEvent, onRenderDetails, schema, otherEvent, processedQueryData, formState, memberResult;
    const configResult = await configureProcess(fastify, process);
    getSchema = getEvent = configResult;

    // Raw schema before env processing
    const rawSchema = Array.isArray(instance)
      ? getSchema[0].schema_grid_json
      : getSchema[0].schema_json;
    
    // Step 2.1: Process environment variables in schema
    // console.log('Processing environment variables in schema...');
    schema = processSchemaEnvVariables(rawSchema);
    // console.log('Schema loaded and env variables processed:', schema.components ? schema.components.length : 'No components');

    // Raw event before env processing
    const rawEvent = getEvent[0].event_json;
    const { onRender: rawRenderEvent, ...restEvent } = rawEvent;
    
    // Step 2.2: Process environment variables in event
    // console.log('Processing environment variables in event...');
    const processedRenderEvent = processEventEnvVariables(rawRenderEvent);
    otherEvent = processEventEnvVariables(restEvent);
    onRenderDetails = processedRenderEvent;
    
    // console.log('Event details loaded and env variables processed:', {
    //   hasApi: !!onRenderDetails.api,
    //   hasGraph: !!onRenderDetails.graph,
    //   processedApiUrls: onRenderDetails.api ? Object.keys(onRenderDetails.api).map(key => ({
    //     [key]: onRenderDetails.api[key].url
    //   })) : []
    // });

    if (instance && (Array.isArray(instance) ? instance.length > 0 : true)) {
      const { graph } = processedRenderEvent;
      if (graph && graph.variables) {
        onRenderDetails = {
          ...processedRenderEvent,
          graph: {
            ...graph,
            variables: {
              ...graph.variables,
              proc_inst_id: instance,
            },
          },
        };
      }
    }

    formState = createFormState(schema, session);
    setupDependencies(schema, formState);

    // Step 3: Jalankan configureQuery
    // console.log('Configuring query with onRenderDetails');
    const responseQuery = await configureQuery(fastify, onRenderDetails);
    if (!responseQuery.data) {
      console.error('Query configuration failed: No data returned');
      throw new Error("Failed to configure process");
    }
    // console.log('Query response received:', {
    //   hasData: !!responseQuery.data,
    //   dataType: typeof responseQuery.data,
    //   isArray: Array.isArray(responseQuery.data)
    // });

    // Step 4: Setelah semua dependensi siap, baru loadInitialApiData
    // console.log('Loading initial API data');
    const apiDataResult = await loadInitialApiData(
      onRenderDetails.api,
      schema,
      responseQuery.data,
      formState,
      session
    );
    // console.log('resulttt api', JSON.stringify(onRenderDetails.api, null, 2));
    // console.log('formState', JSON.stringify(formState, null, 2));
    // console.log('API data loaded:', {
    //   success: !!apiDataResult,
    //   apis: onRenderDetails.api ? Object.keys(onRenderDetails.api) : []
    // });

    // Step 5: Tunggu memberResult jika belum
    memberResult = await memberPromise;

    await processComponents(
      schema.components,
      responseQuery.data,
      formState,
      session,
      onRenderDetails.api,
      memberResult
    );

    // console.log('schemaa jadi', JSON.stringify(schema, null, 2));
    
    setupHandlers(schema, formState, onRenderDetails.api);

    return {
      schema,
      onRenderDetails,
      event: otherEvent,
    };
  } catch (error) {
    console.error("Error in dynamicRender:", error);
    throw new Error(`Failed to configure process: ${error.message}`);
  }
}

module.exports = dynamicRender;
