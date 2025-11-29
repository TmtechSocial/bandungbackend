const { getNestedValue } = require("../utils/helpers");

function fillDataGridComponent(component, apiData, eventData, affected = []) {
    // Jika bukan datagrid atau tidak terpengaruh, return as is
    if (component.type !== 'datagrid' || 
        (affected.length > 0 && !affected.includes(component.key))) {
        return component;
    }

    let filledComp = { ...component };

    if (component.source) {
        // Ambil data dari graph result berdasarkan source
        const sourceData = getNestedValue(apiData, `graph.${component.source}`) || [];
        
        if (Array.isArray(sourceData)) {
            // Transform data sesuai dengan struktur komponen
            filledComp.defaultValue = sourceData.map(row => {
                const rowData = {};
                
                // Iterate melalui setiap kolom yang didefinisikan di components
                component.components.forEach(col => {
                    // Jika kolom memiliki apiSource khusus
                    if (col.apiSource) {
                        const { valueKey } = col.apiSource;
                        rowData[col.key] = getNestedValue(row, valueKey);
                    } 
                    // Jika nama kolom sama dengan field di data
                    else if (row[col.key] !== undefined) {
                        rowData[col.key] = row[col.key];
                    }
                    // Jika ada transformasi khusus
                    else if (col.dataTransform) {
                        rowData[col.key] = evaluateTransform(col.dataTransform, row);
                    }
                });

                // Tambahkan properti tambahan jika diperlukan
                if (component.includeRowIndex) {
                    rowData._rowIndex = sourceData.indexOf(row);
                }

                return rowData;
            });

            // Log hasil transformasi
            console.log(`Datagrid ${component.key} filled with ${filledComp.defaultValue.length} rows:`, 
                JSON.stringify(filledComp.defaultValue, null, 2));

            // Tambahkan metadata jika diperlukan
            if (component.metadata) {
                filledComp.metadata = {
                    total: sourceData.length,
                    loaded: sourceData.length
                };
            }
        }
    }

    return filledComp;
}

// Utility function untuk mengevaluasi transformasi data
function evaluateTransform(transform, data) {
    if (typeof transform === 'function') {
        return transform(data);
    }
    // Support untuk string template transformation
    if (typeof transform === 'string') {
        return transform.replace(/\${([^}]+)}/g, (_, key) => data[key] || '');
    }
    return null;
}

module.exports = fillDataGridComponent;
