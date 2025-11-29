async function processFields(component, apiData, event) {
    const processedComponent = { ...component };

    switch (component.type) {
        case 'dataGrid':
            if (apiData?.graph?.[component.key]) {
                processedComponent.data = apiData.graph[component.key];
            }
            break;
            
        case 'select':
            // Handle select options based on API/GraphQL data
            if (apiData?.graph?.[component.key]) {
                const options = apiData.graph[component.key];
                if (Array.isArray(options)) {
                    processedComponent.options = options.map(item => ({
                        label: item[component.optionLabel || 'label'],
                        value: item[component.optionValue || 'value']
                    }));
                }
            }
            break;

        case 'input':
        case 'textarea':
            // Handle default values from API/GraphQL
            if (apiData?.graph?.[component.key]) {
                processedComponent.defaultValue = apiData.graph[component.key];
            }
            break;

        case 'image':
            // Handle image URLs from API
            if (apiData?.api?.[component.key]) {
                processedComponent.src = apiData.api[component.key].url;
            }
            break;
    }

    return processedComponent;
}

module.exports = processFields;
