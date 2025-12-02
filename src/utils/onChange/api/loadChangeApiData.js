// onChange/api/loadChangeApiData.js
const axios = require("axios");

// Optimization: Create axios instance with better defaults
const axiosInstance = axios.create({
  timeout: 30000, // 30 seconds timeout
  maxRedirects: 5,
  maxContentLength: 50 * 1024 * 1024, // 50MB limit
});

// Add request/response interceptors for logging
axiosInstance.interceptors.request.use(
  (config) => {
    config.metadata = { startTime: Date.now() };
    return config;
  }
);

axiosInstance.interceptors.response.use(
  (response) => {
    const duration = Date.now() - response.config.metadata.startTime;
    if (duration > 3000) {
      console.warn(`Slow onChange API request: ${response.config.url} took ${duration}ms`);
    }
    return response;
  },
  (error) => {
    if (error.config && error.config.metadata) {
      const duration = Date.now() - error.config.metadata.startTime;
      console.error(`Failed onChange API request: ${error.config.url} after ${duration}ms`, error.message);
    }
    return Promise.reject(error);
  }
);

/**
 * Load API data for changed components
 * @param {Object} apiConfigs - API configurations
 * @param {Array} refreshComponents - Components that need to be refreshed
 * @param {Object} eventData - The change event data
 * @param {Object} formState - Current form state
 * @param {Object} session - User session
 * @returns {Promise<Object>} API results mapped by source name
 */
async function loadChangeApiData(apiConfigs, refreshComponents, eventData, formState, session) {
  if (!apiConfigs || !refreshComponents || refreshComponents.length === 0) {
    console.log('[onChange/api] No API configs or refresh components to process');
    return {};
  }

  const startTime = Date.now();
  console.log(`[onChange/api] Loading API data for ${refreshComponents.length} components`);

  // Collect unique API sources from refresh components
  const apiSources = new Set();
  refreshComponents.forEach(component => {
    if (component.apiSource && component.apiSource.source) {
      apiSources.add(component.apiSource.source);
    }
  });

  if (apiSources.size === 0) {
    console.log('[onChange/api] No API sources found in refresh components');
    return {};
  }

  console.log(`[onChange/api] Processing ${apiSources.size} unique API sources:`, Array.from(apiSources));

  // Process API calls in parallel
  const apiPromises = Array.from(apiSources).map(async (sourceName) => {
    try {
      const apiDetails = apiConfigs[sourceName];
      if (!apiDetails) {
        console.warn(`[onChange/api] No API details found for source: ${sourceName}`);
        return { sourceName, data: null, error: `No API config found for ${sourceName}` };
      }

      // Build API call with event data
      const apiResult = await makeChangeApiCall(apiDetails, eventData, formState, session, sourceName);
      
      return { sourceName, data: apiResult, error: null };
    } catch (error) {
      console.error(`[onChange/api] Failed to load data from ${sourceName}:`, error.message);
      return { sourceName, data: null, error: error.message };
    }
  });

  // Wait for all API calls to complete
  const results = await Promise.all(apiPromises);
  
  // Convert results to object mapping
  const apiResults = {};
  results.forEach(({ sourceName, data, error }) => {
    if (data) {
      apiResults[sourceName] = data;
    } else {
      console.warn(`[onChange/api] API source ${sourceName} failed:`, error);
    }
  });

  const duration = Date.now() - startTime;
  console.log(`[onChange/api] Completed loading API data in ${duration}ms, successful sources: ${Object.keys(apiResults).length}`);

  return apiResults;
}

/**
 * Make API call with change event data
 * @param {Object} apiDetails - API configuration
 * @param {Object} eventData - Change event data
 * @param {Object} formState - Current form state
 * @param {Object} session - User session
 * @param {String} sourceName - API source name for logging
 * @returns {Promise<*>} API response data
 */
async function makeChangeApiCall(apiDetails, eventData, formState, session, sourceName) {
  const startTime = Date.now();
  
  const {
    method = "GET",
    url: baseUrl,
    headers = {},
    params = {},
    path = {},
    query = {},
    data: bodyData = {}
  } = apiDetails;

  // Build substitution data
  const substitutionData = {
    ...eventData,
    ...formState.values,
    ...session
  };

  // Replace template variables
  const replaceTemplate = (str) =>
    str.replace(/\$\{([^}]+)\}/g, (_, key) => substitutionData[key] ?? "");

  // Process URL with path parameters
  let finalUrl = baseUrl;
  if (path) {
    Object.entries(path).forEach(([key, rawValue]) => {
      let value = rawValue;
      if (typeof value === "string" && value.includes("${")) {
        value = replaceTemplate(value);
      }
      finalUrl = finalUrl.replace(`:${key}`, encodeURIComponent(value));
    });
  }

  // Process query parameters
  const finalParams = {};
  Object.entries({ ...params, ...query }).forEach(([key, rawValue]) => {
    let value = rawValue;
    if (typeof value === "string" && value.includes("${")) {
      value = replaceTemplate(value);
    }
    finalParams[key] = value;
  });

  // Process headers
  const finalHeaders = {};
  Object.entries(headers).forEach(([key, rawValue]) => {
    let value = rawValue;
    if (typeof value === "string" && value.includes("${")) {
      value = replaceTemplate(value);
    }
    finalHeaders[key] = value;
  });

  // Process body data
  let finalBodyData = null;
  if (bodyData && Object.keys(bodyData).length > 0) {
    finalBodyData = {};
    Object.entries(bodyData).forEach(([key, rawValue]) => {
      let value = rawValue;
      if (typeof value === "string" && value.includes("${")) {
        value = replaceTemplate(value);
      }
      finalBodyData[key] = value;
    });
  }

  console.log(`[onChange/api] Making ${method} request to ${finalUrl} for source: ${sourceName}`);
  console.log(`[onChange/api] Params:`, finalParams);

  try {
    const response = await axiosInstance({
      method,
      url: finalUrl,
      headers: finalHeaders,
      params: finalParams,
      data: finalBodyData
    });

    const duration = Date.now() - startTime;
    console.log(`[onChange/api] API call successful for ${sourceName} in ${duration}ms`);

    // Return the data based on response structure
    if (response.data && response.data.results !== undefined) {
      return response.data.results;
    } else if (response.data && response.data.data !== undefined) {
      return response.data.data;
    } else {
      return response.data;
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[onChange/api] API call failed for ${sourceName} after ${duration}ms:`, error.message);
    throw new Error(`API call failed for ${sourceName}: ${error.message}`);
  }
}

module.exports = {
  loadChangeApiData,
  makeChangeApiCall
};
