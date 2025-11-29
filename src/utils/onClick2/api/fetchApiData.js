// fetchApiDataLatest.js
const axios = require("axios");

const axiosInstance = axios.create({
  timeout: 10000,
  maxRedirects: 5,
  maxContentLength: 50 * 1024 * 1024,
});

axiosInstance.interceptors.request.use((config) => {
  config.metadata = { startTime: Date.now() };
  return config;
});

axiosInstance.interceptors.response.use(
  (response) => {
    const duration = Date.now() - response.config.metadata.startTime;
    if (duration > 3000) {
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

function simplifyEventData(eventData) {
  const flat = {};

  function flatten(obj, path = []) {
    if (Array.isArray(obj)) {
      // Store array itself at its path
      const arrayPath = path.join(".");
      if (arrayPath) {
        flat[arrayPath] = obj;
      }
      // Then store individual elements
      obj.forEach((item, index) => {
        flatten(item, [...path, index]);
      });
    } else if (obj && typeof obj === "object") {
      for (const key in obj) {
        flatten(obj[key], [...path, key]);
      }
    } else {
      const fullPath = path.join(".");
      flat[fullPath] = obj;
    }
  }

  flatten(eventData);
  return flat;
}

function resolveTemplate(template, flatEventData) {
  if (typeof template !== "string" || !template.startsWith("${"))
    return template;

  try {
    const rawPath = template.slice(2, -1); // e.g. graph.mo_order_shop.part_pk[0]

    // Parse array index if present
    const arrayIndexMatch = rawPath.match(/^(.+?)(?:\[(\d+)\])?$/);
    if (!arrayIndexMatch) {
      console.warn("Invalid template format:", template);
      return "";
    }

    const [_, basePath, indexStr] = arrayIndexMatch;
    const index = indexStr ? parseInt(indexStr, 10) : undefined;

    // Handle mo_order_shop array specifically
    if (basePath.includes(".mo_order_shop.")) {
      const parts = basePath.split(".");
      const field = parts[parts.length - 1];
      const arrayPath = "graph.mo_order_shop";

      if (flatEventData[arrayPath] && Array.isArray(flatEventData[arrayPath])) {
        const array = flatEventData[arrayPath];
        if (index !== undefined) {
          // Return specific array element
          return array[index] && array[index][field];
        } else {
          // Return all values for the field
          return array.map(item => item[field]).filter(Boolean);
        }
      }
    }

    // Try direct path lookup
    if (flatEventData.hasOwnProperty(basePath)) {
      const value = flatEventData[basePath];
      if (Array.isArray(value) && index !== undefined) {
        return value[index];
      }
      return value;
    }

    // If path not found directly, try walking the object structure
    const parts = basePath.split(".");
    let current = eventData;
    
    for (const part of parts) {
      if (current === null || current === undefined) {
        break;
      }
      current = current[part];
    }

    if (current !== undefined) {
      if (Array.isArray(current) && index !== undefined) {
        return current[index];
      }
      return current;
    }

    console.warn("⚠️ Template not resolved:", template);
    return "";
  } catch (err) {
    console.error("Template resolution error:", err);
    return "";
  }
}

async function fetchApiData(apiConfig, eventData) {
  try {
    const simplifiedData = simplifyEventData(eventData);
    console.log(
      "Processing API request with config:",
      JSON.stringify(apiConfig, null, 2)
    );

    const {
      url,
      method = "GET",
      headers = {},
      path = {},
      variables = {},
    } = apiConfig;

    // Handle array paths
    if (
      path &&
      Object.values(path).some(
        (v) => typeof v === "string" && v.includes("mo_order_shop")
      )
    ) {
      const results = [];
      const shopData = eventData.graph?.mo_order_shop || [];

      // Process each item in the array
      for (let i = 0; i < shopData.length; i++) {
        const item = shopData[i];
        try {
          let itemUrl = url;
          
          // Replace path parameters with actual values
          for (const [key, val] of Object.entries(path)) {
            if (typeof val === "string" && val.includes("${graph.mo_order_shop")) {
              const field = val.match(/\.([^}]+)(?:\[\d+\])?}$/)[1];
              const value = item[field];
              itemUrl = itemUrl.replace(
                new RegExp(`:${key}\\b`, "g"),
                value !== undefined ? value : "undefined"
              );
            }
          }
          
          itemUrl = itemUrl.replace(/([^:])\/+/g, "$1/");

          if (itemUrl.includes("undefined")) {
            console.warn(`Skipping item ${i} due to unresolved URL: ${itemUrl}`);
            continue;
          }

          const response = await axiosInstance({
            method,
            url: itemUrl,
            headers,
          });

          results.push(response.data.results !== undefined ? response.data.results : response.data);
        } catch (error) {
          console.error(`Error processing item ${i}:`, error);
        }
      }
      return results;
    }

    let finalUrl = url;
    for (const [key, val] of Object.entries(path)) {
      const resolved = resolveTemplate(val, simplifiedData);
      finalUrl = finalUrl.replace(
        new RegExp(`:${key}\\b`, "g"),
        resolved !== undefined ? resolved : "undefined"
      );
    }
    finalUrl = finalUrl.replace(/([^:])\/+/g, "$1/");

    if (finalUrl.includes("undefined")) {
      throw new Error(`Path parameter unresolved in URL: ${finalUrl}`);
    }

    const resolvedVars = {};
    for (const [key, val] of Object.entries(variables)) {
      resolvedVars[key] = resolveTemplate(val, simplifiedData);
    }

    const response = await axiosInstance({
      method,
      url: finalUrl,
      headers,
      data: method !== "GET" ? resolvedVars : undefined,
      params: method === "GET" ? resolvedVars : undefined,
    });

    // Handle response and errors
    if (response.data && response.data.errors) {
      console.error("API errors:", response.data.errors);
      throw new Error("API errors occurred");
    }

    return response.data.results !== undefined
      ? response.data.results
      : response.data;
  } catch (error) {
    console.error("API error:", error.message);
    throw error;
  }
}

module.exports = fetchApiData;
