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
const processComponents = require("./process/processComponents");
const createFormState = require("./formState");

// Semua logika cache DIHAPUS

async function dynamicRender(fastify, process, instance, session) {
  const startTime = Date.now();

  try {
    // Step 1: getMember boleh paralel sejak awal
    const memberPromise = getMember(fastify, session);

    // Step 2: Ambil config (schema & event) - SELALU FRESH
    let getSchema, getEvent, onRenderDetails, schema, otherEvent, processedQueryData, formState, memberResult;
    const configResult = await configureProcess(fastify, process);
    getSchema = getEvent = configResult;

    schema = Array.isArray(instance)
      ? getSchema[0].schema_grid_json
      : getSchema[0].schema_json;

    const { onRender: renderEvent, ...restEvent } = getEvent[0].event_json;
    otherEvent = restEvent;
    onRenderDetails = renderEvent;

    if (instance && (Array.isArray(instance) ? instance.length > 0 : true)) {
      const { graph } = renderEvent;
      if (graph && graph.variables) {
        onRenderDetails = {
          ...renderEvent,
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
    const responseQuery = await configureQuery(fastify, onRenderDetails);
    if (!responseQuery.data) {
      throw new Error("Failed to configure process");
    }

    console.log(`responseQuery: ${JSON.stringify(responseQuery.data, null, 2)}`);

    console.log('responseQuery.data:', JSON.stringify(responseQuery.data, null, 2));

    // Step 4: Setelah semua dependensi siap, baru loadInitialApiData
    const apiDataResult = await loadInitialApiData(
      onRenderDetails.api,
      schema,
      responseQuery.data,
      formState,
      session
    );

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
