const mergeComponentData = require('./mergeComponentData');
const processFields = require('./processFields');

async function processComponents(components, apiData, event, clickedButton) {
    const updatedComponents = [];

    for (const component of components) {
        // Skip components that aren't affected
        if (clickedButton.affects && !clickedButton.affects.includes(component.key)) {
            updatedComponents.push(component);
            continue;
        }

        // Process component based on type
        let processedComponent = { ...component };

        // Validasi dependsOn dan cek event matches
        const dependencies = Array.isArray(component.dependsOn) ? component.dependsOn : 
                           typeof component.dependsOn === 'string' ? [component.dependsOn] : [];
        
        const hasActiveDependency = dependencies.length === 0 || 
                                  dependencies.some(dep => event[dep]);
        
        // Process jika tidak ada dependencies atau ada dependency yang aktif
        if (hasActiveDependency) {
            console.log(`[processComponents] Processing ${component.key} with dependencies:`, dependencies);
            processedComponent = await processFields(processedComponent, apiData, event);
        }

        // Merge any API or GraphQL data
        if (apiData) {
            processedComponent = mergeComponentData(processedComponent, apiData);
        }

        updatedComponents.push(processedComponent);
    }

    return updatedComponents;
}

module.exports = processComponents;
