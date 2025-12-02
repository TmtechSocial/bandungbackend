const axios = require("axios");

// Optimization: Create axios instance with better defaults
const axiosInstance = axios.create({
  timeout: 100000, // 10 seconds timeout instead of 1000 seconds
  maxRedirects: 5,
  maxContentLength: 50 * 1024 * 1024, // 50MB limit
});

// Optimization: Add request/response interceptors for logging slow requests
axiosInstance.interceptors.request.use((config) => {
  config.metadata = { startTime: Date.now() };
  return config;
});

axiosInstance.interceptors.response.use(
  (response) => {
    const duration = Date.now() - response.config.metadata.startTime;
    if (duration > 3000) {
      // Log requests taking more than 3 seconds
      console.warn(
        `Slow API request: ${response.config.url} took ${duration}ms`
      );
    }
    return response;
  },
  (error) => {
    if (error.config && error.config.metadata) {
      const duration = Date.now() - error.config.metadata.startTime;
      console.error(
        `Failed API request: ${error.config.url} failed after ${duration}ms`
      );
    }
    return Promise.reject(error);
  }
);

async function fetchApiData(
  apiDetails,
  additionalData = {},
  formData = {},
  event = {},
  apiName = "unknown"
) {
  try {
    let finalUrl = apiDetails.url;
    const {
      method = "GET",
      headers = {},
      params = {},
      data = {},
      path = {},
      query = {}, // support query param override
      responseKey = null, // tambahan: field untuk menentukan key response yang diinginkan
    } = apiDetails;

    const substitutionData = {
      ...formData,
      ...additionalData,
      ...event,
    };

    // Replace ${key} in strings
    const replaceTemplate = (str) =>
      str.replace(/\$\{([^}]+)\}/g, (_, key) => substitutionData[key] ?? "");

    // Replace path parameters :key in URL - Support multiple path params
    if (path && Object.keys(path).length > 0) {
      console.log(`[fetchApiData] Processing ${Object.keys(path).length} path parameters:`, Object.keys(path));
      Object.entries(path).forEach(([key, rawValue]) => {
        let value = rawValue;
        if (typeof value === "string" && value.includes("${")) {
          // Support multiple template variables in single value
          value = value.replace(/\$\{([^}]+)\}/g, (match, templateVar) => {
            return substitutionData[templateVar] ?? "";
          });
        }
        const beforeUrl = finalUrl;
        finalUrl = finalUrl.replace(`:${key}`, value);
        console.log(`[fetchApiData] Path param "${key}": "${rawValue}" → "${value}" (URL: "${beforeUrl}" → "${finalUrl}")`);
      });
    }

    // Apply template substitution on query/params - Support multiple params
    const processedParams = {};
    const allParams = { ...params, ...query };
    
    if (Object.keys(allParams).length > 0) {
      console.log(`[fetchApiData] Processing ${Object.keys(allParams).length} query/params:`, Object.keys(allParams));
      
      Object.entries(allParams).forEach(([k, v]) => {
        if (typeof v === "string") {
          // Support multiple template variables in single parameter value
          const processedValue = v.replace(/\$\{([^}]+)\}/g, (match, templateVar) => {
            const resolvedValue = substitutionData[templateVar] ?? "";
            console.log(`[fetchApiData] Param "${k}" template "${match}" → "${resolvedValue}"`);
            return resolvedValue;
          });
          processedParams[k] = processedValue;
          console.log(`[fetchApiData] Param "${k}": "${v}" → "${processedValue}"`);
        } else {
          processedParams[k] = v;
          console.log(`[fetchApiData] Param "${k}": ${typeof v} value`);
        }
      });
    }

    // Log if this appears to be a bulk API call (parameter "in" converted to params)
    const bulkParams = Object.keys(processedParams).filter((key) =>
      key.includes("_in")
    );
    if (bulkParams.length > 0) {
      console.log(
        `[fetchApiData] Bulk API call detected with "in" parameters:`,
        bulkParams
      );
      bulkParams.forEach((param) => {
        const values = processedParams[param];
        if (typeof values === "string" && values.includes(",")) {
          const valueCount = values.split(",").length;
          console.log(
            `[fetchApiData] ${param}: ${valueCount} values -> "${values.substring(
              0,
              50
            )}${values.length > 50 ? "..." : ""}"`
          );
        }
      });
    }

    // Apply template substitution on body data - Support multiple templates
    let processedData = data;
    
    if (typeof data === "string") {
      // Support multiple template variables in string data
      processedData = data.replace(/\$\{([^}]+)\}/g, (match, templateVar) => {
        const resolvedValue = substitutionData[templateVar] ?? "";
        console.log(`[fetchApiData] Body data template "${match}" → "${resolvedValue}"`);
        return resolvedValue;
      });
      console.log(`[fetchApiData] Body data (string): "${data}" → "${processedData}"`);
    } else if (data && typeof data === "object") {
      // Support multiple template variables in object data
      processedData = {};
      Object.entries(data).forEach(([key, value]) => {
        if (typeof value === "string") {
          const processedValue = value.replace(/\$\{([^}]+)\}/g, (match, templateVar) => {
            const resolvedValue = substitutionData[templateVar] ?? "";
            console.log(`[fetchApiData] Body data["${key}"] template "${match}" → "${resolvedValue}"`);
            return resolvedValue;
          });
          processedData[key] = processedValue;
          console.log(`[fetchApiData] Body data["${key}"]: "${value}" → "${processedValue}"`);
        } else {
          processedData[key] = value;
        }
      });
    }

    // Log API call details (especially for bulk calls)
    // Build URL manually to avoid encoding commas in comma-separated values
    let fullUrl = finalUrl;
    if (Object.keys(processedParams).length > 0) {
      const paramPairs = Object.entries(processedParams).map(([key, value]) => {
        // For parameters that contain commas (like id_in), don't encode the commas
        if (
          typeof value === "string" &&
          value.includes(",") &&
          key.includes("_in")
        ) {
          return `${encodeURIComponent(key)}=${value}`;
        }
        return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
      });
      fullUrl = `${finalUrl}?${paramPairs.join("&")}`;
    }
    console.log(`[fetchApiData] Making API call: ${method} ${fullUrl}`);

    console.log(`[fetchApiData] Fetching API: ${apiName}`);
    console.log(`[fetchApiData] API Details:`, {
      method,
      url: finalUrl,
      headers,
      params,
      data,
      path,
      query,
      responseKey,
    });

    // Optimization: Use optimized axios instance
    const response = await axiosInstance({
      method,
      url: finalUrl,
      headers,
      params: processedParams,
      data: processedData,
    });

    // Fleksibilitas dalam mengembalikan data response
    let result;

    console.log(`[fetchApiData] Response data structure for ${apiName}:`, {
      hasResponseKey: !!responseKey,
      responseKey,
      hasResults: response.data.results !== undefined,
      hasSalesInvoices: response.data.sales_invoices !== undefined,
      isArray: Array.isArray(response.data),
      keys: Object.keys(response.data)
    });

    if (responseKey) {
      result = response.data[responseKey];
      console.log(`[fetchApiData] Using responseKey "${responseKey}":`, result ? 'FOUND' : 'NOT_FOUND');
    } else if (response.data.results !== undefined) {
      result = response.data.results;
      console.log(`[fetchApiData] Using response.data.results:`, result ? 'FOUND' : 'NOT_FOUND');
    } else if (response.data.sales_invoices !== undefined) {
      result = response.data.sales_invoices;
      console.log(`[fetchApiData] Using response.data.sales_invoices:`, result ? 'FOUND' : 'NOT_FOUND');
    } else {
      result = response.data;
      console.log(`[fetchApiData] Using full response.data:`, result ? 'FOUND' : 'NOT_FOUND');
    }

    console.log(`[fetchApiData] Final result for ${apiName}:`, result ? `SUCCESS (${Array.isArray(result) ? 'Array[' + result.length + ']' : 'Object'})` : 'NULL');
    return result;
  } catch (error) {
    console.error(
      `[fetchApiData] Error fetching API [${apiName}]:`,
      error.message
    );
    console.error(
      `[fetchApiData] Full error for API [${apiName}]:`,
      error.response?.data || error
    );
    console.error(`[fetchApiData] Stack trace:`, error.stack);
    return null;
  }
}

module.exports = fetchApiData;
