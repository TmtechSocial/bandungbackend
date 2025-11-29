// utils/commonUtils.js - Common utility functions

/**
 * Deep clone an object
 * @param {*} obj - Object to clone
 * @returns {*} - Cloned object
 */
function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  if (obj instanceof Date) {
    return new Date(obj.getTime());
  }
  
  if (obj instanceof Array) {
    return obj.map(item => deepClone(item));
  }
  
  if (typeof obj === 'object') {
    const cloned = {};
    for (let key in obj) {
      if (obj.hasOwnProperty(key)) {
        cloned[key] = deepClone(obj[key]);
      }
    }
    return cloned;
  }
  
  return obj;
}

/**
 * Check if a value is empty (null, undefined, empty string, empty array, empty object)
 * @param {*} value - Value to check
 * @returns {boolean} - True if empty
 */
function isEmpty(value) {
  if (value === null || value === undefined) {
    return true;
  }
  
  if (typeof value === 'string') {
    return value.trim() === '';
  }
  
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  
  if (typeof value === 'object') {
    return Object.keys(value).length === 0;
  }
  
  return false;
}

/**
 * Get nested property value from object using dot notation
 * @param {Object} obj - Object to search in
 * @param {string} path - Dot notation path (e.g., 'user.profile.name')
 * @param {*} defaultValue - Default value if not found
 * @returns {*} - Found value or default
 */
function getNestedValue(obj, path, defaultValue = undefined) {
  if (!obj || typeof obj !== 'object' || !path) {
    return defaultValue;
  }
  
  const keys = path.split('.');
  let current = obj;
  
  for (let key of keys) {
    if (current === null || current === undefined || !current.hasOwnProperty(key)) {
      return defaultValue;
    }
    current = current[key];
  }
  
  return current;
}

/**
 * Set nested property value in object using dot notation
 * @param {Object} obj - Object to modify
 * @param {string} path - Dot notation path
 * @param {*} value - Value to set
 * @returns {Object} - Modified object
 */
function setNestedValue(obj, path, value) {
  if (!obj || typeof obj !== 'object' || !path) {
    return obj;
  }
  
  const keys = path.split('.');
  let current = obj;
  
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }
  
  current[keys[keys.length - 1]] = value;
  return obj;
}

/**
 * Format date to ISO string or custom format
 * @param {Date|string} date - Date to format
 * @param {string} format - Format type ('iso', 'local', 'date', 'time')
 * @returns {string} - Formatted date
 */
function formatDate(date, format = 'iso') {
  const dateObj = date instanceof Date ? date : new Date(date);
  
  if (isNaN(dateObj.getTime())) {
    return '';
  }
  
  switch (format) {
    case 'iso':
      return dateObj.toISOString();
    case 'local':
      return dateObj.toLocaleString();
    case 'date':
      return dateObj.toLocaleDateString();
    case 'time':
      return dateObj.toLocaleTimeString();
    default:
      return dateObj.toISOString();
  }
}

/**
 * Sanitize string for safe usage
 * @param {string} str - String to sanitize
 * @returns {string} - Sanitized string
 */
function sanitizeString(str) {
  if (typeof str !== 'string') {
    return '';
  }
  
  return str
    .replace(/[<>]/g, '') // Remove < >
    .replace(/['"]/g, '') // Remove quotes
    .trim();
}

/**
 * Generate unique ID
 * @param {string} prefix - Prefix for ID
 * @returns {string} - Unique ID
 */
function generateUniqueId(prefix = 'id') {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 9);
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * Debounce function
 * @param {Function} func - Function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} - Debounced function
 */
function debounce(func, delay) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func.apply(this, args), delay);
  };
}

module.exports = {
  deepClone,
  isEmpty,
  getNestedValue,
  setNestedValue,
  formatDate,
  sanitizeString,
  generateUniqueId,
  debounce
};