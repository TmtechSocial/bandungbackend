// event/setupDependencies.js

function setupDependencies(schema, formState) {
    schema.components.forEach((component) => {
      const { key, apiSource } = component;
      if (apiSource && apiSource.dependsOn) {
        const dependsOn = apiSource.dependsOn;
        if (!formState.dependencies.has(dependsOn)) {
          formState.dependencies.set(dependsOn, []);
        }
        formState.dependencies.get(dependsOn).push(key);
      }
    });
  
    //console.log("Dependencies set:", formState.dependencies);
  }
  
  module.exports = setupDependencies;
  
