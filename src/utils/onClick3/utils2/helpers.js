function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

function replaceTemplateVars(str, data) {
  return str.replace(/\${([^}]+)}/g, (_, path) => getNestedValue(data, path) || '');
}

module.exports = {
  getNestedValue,
  replaceTemplateVars
};
