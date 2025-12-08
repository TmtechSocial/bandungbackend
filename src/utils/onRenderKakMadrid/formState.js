// formState.js

function createFormState(schema, session) {
    const formState = {
      data: {},
      apiResults: {},
      dependencies: new Map(),
    };
  
    schema.components.forEach((component) => {
      const { key, apiSource, defaultValue } = component;
  
      if (defaultValue !== undefined && defaultValue !== null) {
        formState.data[key] = defaultValue;
      }
  
      if (apiSource && apiSource.dependsOn) {
        const dependsOn = apiSource.dependsOn;
  
        if (!formState.dependencies.has(dependsOn)) {
          formState.dependencies.set(dependsOn, []);
        }
  
        formState.dependencies.get(dependsOn).push(key);
      }
    });
  
    return formState;
  }
  
  module.exports = createFormState;
  