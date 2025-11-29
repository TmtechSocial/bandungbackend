const axios = require('axios');

const axiosInstance = axios.create({
  timeout: 100000,
  maxRedirects: 5,
  maxContentLength: 50 * 1024 * 1024,
});

async function fetchApiData(apiRequest, eventData) {
  console.log('[fetchApiData] API Request:', apiRequest);
  console.log('[fetchApiData] Event Data:', JSON.stringify(eventData, null, 2));

  try {
    let finalUrl = apiRequest.url;
    const {
      method = "GET",
      headers = {},
      path = {},
      params = {},
    } = apiRequest;

    // Function to evaluate template expressions
    const evaluateTemplate = (template) => {
      return template.replace(/\${([^}]+)}/g, (match, path) => {
        return path.split('.')
          .reduce((obj, key) => {
            if (key.includes('[') && key.includes(']')) {
              const [arrayKey, index] = key.split(/[\[\]]/);
              return obj?.[arrayKey]?.[parseInt(index)];
            }
            return obj?.[key];
          }, eventData) ?? '';
      });
    };

    // Process path parameters
    if (path) {
      Object.entries(path).forEach(([key, value]) => {
        if (typeof value === 'string' && value.includes('${')) {
          const resolvedValue = evaluateTemplate(value);
          finalUrl = finalUrl.replace(`:${key}`, resolvedValue);
        } else {
          finalUrl = finalUrl.replace(`:${key}`, value);
        }
      });
    }

    // Process params if any
    const processedParams = {};
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (typeof value === 'string' && value.includes('${')) {
          processedParams[key] = evaluateTemplate(value);
        } else {
          processedParams[key] = value;
        }
      });
    }


    console.log('[fetchApiData] Final URL:', finalUrl);

    const response = await axiosInstance({
      method,
      url: finalUrl,
      headers,
      params: processedParams
    });

    console.log('[fetchApiData] Response:', response.data);

    return response.data;
  } catch (error) {
    console.error('[fetchApiData] Error:', error.message);
    console.error('[fetchApiData] Full error:', error.response?.data || error);
    return null;
  }
}

module.exports = fetchApiData;

