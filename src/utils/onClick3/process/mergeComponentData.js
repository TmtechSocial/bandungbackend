function mergeComponentData(component, data) {
    if (!data) return component;

    const updatedComponent = { ...component };

    // Handle GraphQL data
    if (data.graph) {
        const graphData = data.graph;
        // Merge GraphQL data based on component type
        switch (component.type) {
            case 'dataGrid':
                if (graphData[component.key]) {
                    updatedComponent.data = graphData[component.key];
                }
                break;
            case 'select':
                if (graphData[component.key]) {
                    updatedComponent.options = graphData[component.key].map(item => ({
                        label: item[component.optionLabel || 'label'],
                        value: item[component.optionValue || 'value']
                    }));
                }
                break;
            default:
                if (graphData[component.key]) {
                    updatedComponent.defaultValue = graphData[component.key];
                }
        }
    }

    // Handle REST API data
    if (data.api && data.api[component.key]) {
        const apiData = data.api[component.key];
        // Merge API data based on component type
        switch (component.type) {
            case 'image':
                updatedComponent.src = apiData.url;
                break;
            case 'dataGrid':
                if (Array.isArray(apiData)) {
                    updatedComponent.data = apiData;
                }
                break;
            default:
                updatedComponent.defaultValue = apiData;
        }
    }

    return updatedComponent;
}

module.exports = mergeComponentData;
