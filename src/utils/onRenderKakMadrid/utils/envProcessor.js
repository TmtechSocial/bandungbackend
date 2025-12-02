/**
 * Environment Variable Processor
 * Replaces ${env.*} placeholders in JSON objects with actual environment variables
 */

/**
 * Replace environment variables in a string
 * @param {string} str - String that may contain ${env.VARIABLE_NAME} placeholders
 * @returns {string} String with environment variables replaced
 */
function replaceEnvVariables(str) {
    if (typeof str !== 'string') return str;
    
    return str.replace(/\$\{env\.([^}]+)\}/g, (match, envVarName) => {
        const envValue = process.env[envVarName];
        if (envValue === undefined) {
            console.warn(`[envProcessor] Environment variable ${envVarName} not found, keeping placeholder: ${match}`);
            return match; // Keep original placeholder if env var not found
        }
        console.log(`[envProcessor] Replaced ${match} with ${envValue}`);
        return envValue;
    });
}

/**
 * Recursively process an object to replace all environment variables
 * @param {any} obj - Object, array, or primitive value to process
 * @returns {any} Processed object with environment variables replaced
 */
function processEnvVariables(obj) {
    if (obj === null || obj === undefined) {
        return obj;
    }
    
    if (typeof obj === 'string') {
        return replaceEnvVariables(obj);
    }
    
    if (Array.isArray(obj)) {
        return obj.map(item => processEnvVariables(item));
    }
    
    if (typeof obj === 'object') {
        const processed = {};
        for (const [key, value] of Object.entries(obj)) {
            processed[key] = processEnvVariables(value);
        }
        return processed;
    }
    
    // For primitives (number, boolean, etc.), return as-is
    return obj;
}

/**
 * Process schema JSON to replace environment variables
 * @param {Object} schema - The schema object
 * @returns {Object} Schema with environment variables replaced
 */
function processSchemaEnvVariables(schema) {
    console.log('[envProcessor] Processing schema for environment variables...');
    
    if (!schema) {
        console.warn('[envProcessor] No schema provided');
        return schema;
    }
    
    const processedSchema = processEnvVariables(schema);
    console.log('[envProcessor] Schema environment variable processing completed');
    return processedSchema;
}

/**
 * Process event JSON to replace environment variables
 * @param {Object} event - The event object
 * @returns {Object} Event with environment variables replaced
 */
function processEventEnvVariables(event) {
    console.log('[envProcessor] Processing event for environment variables...');
    
    if (!event) {
        console.warn('[envProcessor] No event provided');
        return event;
    }
    
    const processedEvent = processEnvVariables(event);
    console.log('[envProcessor] Event environment variable processing completed');
    return processedEvent;
}

/**
 * Get environment variable with fallback
 * @param {string} varName - Environment variable name
 * @param {string} fallback - Fallback value if env var not found
 * @returns {string} Environment variable value or fallback
 */
function getEnvVar(varName, fallback = '') {
    const value = process.env[varName];
    if (value === undefined) {
        console.warn(`[envProcessor] Environment variable ${varName} not found, using fallback: ${fallback}`);
        return fallback;
    }
    return value;
}

/**
 * Log all environment variables that match a pattern (for debugging)
 * @param {string} pattern - Regex pattern to match env var names
 */
function logMatchingEnvVars(pattern = '.*') {
    const regex = new RegExp(pattern, 'i');
    const matchingVars = Object.keys(process.env).filter(key => regex.test(key));
    
    console.log(`[envProcessor] Environment variables matching "${pattern}":`);
    matchingVars.forEach(key => {
        // Don't log sensitive values, just show they exist
        const value = process.env[key];
        const displayValue = key.toLowerCase().includes('password') || 
                           key.toLowerCase().includes('secret') || 
                           key.toLowerCase().includes('token')
                           ? '***HIDDEN***' 
                           : value;
        console.log(`[envProcessor]   ${key} = ${displayValue}`);
    });
}

module.exports = {
    replaceEnvVariables,
    processEnvVariables,
    processSchemaEnvVariables,
    processEventEnvVariables,
    getEnvVar,
    logMatchingEnvVars
};
