// process/processDefaultComponent.js

/**
 * Process Default Component for onChange
 * Handles components that don't require special processing
 * @param {Object} component - The component to process
 * @param {Array} queryData - SQL/Graph query results
 * @param {Object} formState - Current form state
 * @param {Object} apiConfigs - API configurations
 * @param {Object} session - User session data
 */
function processDefaultComponent(component, queryData, formState, apiConfigs, session) {
    try {
        console.log(`[onChange] Processing Default component: ${component.key} (type: ${component.type})`);
        
        // Handle basic component types that might need minimal processing
        switch (component.type) {
            case 'textfield':
            case 'email':
            case 'password':
            case 'number':
            case 'phoneNumber':
            case 'url':
                processTextFieldComponent(component, queryData, formState);
                break;
                
            case 'textarea':
                processTextAreaComponent(component, queryData, formState);
                break;
                
            case 'checkbox':
            case 'radio':
                processCheckboxRadioComponent(component, queryData, formState);
                break;
                
            case 'button':
                processButtonComponent(component, formState, session);
                break;
                
            case 'hidden':
                processHiddenComponent(component, queryData, formState);
                break;
                
            case 'htmlelement':
                processHtmlElementComponent(component, queryData, formState);
                break;
                
            default:
                // For unknown component types, just ensure basic structure
                console.log(`[onChange] Processing unknown component type: ${component.type}`);
                if (!component.data) {
                    component.data = {};
                }
                break;
        }
        
        console.log(`[onChange] Default component processed successfully: ${component.key}`);
        
    } catch (error) {
        console.error(`[onChange] Error processing Default component ${component.key}:`, error);
        throw new Error(`Failed to process Default component ${component.key}: ${error.message}`);
    }
}

/**
 * Process text field components
 */
function processTextFieldComponent(component, queryData, formState) {
    // Set default value if specified and no current value
    if (component.defaultValue !== undefined && !component.value) {
        component.value = component.defaultValue;
    }
    
    // Apply validation rules if needed
    if (component.validate) {
        if (!component.data) component.data = {};
        component.data.validation = component.validate;
    }
}

/**
 * Process textarea components
 */
function processTextAreaComponent(component, queryData, formState) {
    // Similar to text field but may have different default handling
    if (component.defaultValue !== undefined && !component.value) {
        component.value = component.defaultValue;
    }
    
    // Handle wysiwyg editor settings
    if (component.wysiwyg) {
        if (!component.data) component.data = {};
        component.data.editorOptions = component.wysiwyg;
    }
}

/**
 * Process checkbox and radio components
 */
function processCheckboxRadioComponent(component, queryData, formState) {
    // Set default checked state
    if (component.defaultValue !== undefined && component.value === undefined) {
        component.value = component.defaultValue;
    }
    
    // Ensure boolean value for checkbox
    if (component.type === 'checkbox' && typeof component.value !== 'boolean') {
        component.value = Boolean(component.value);
    }
}

/**
 * Process button components
 */
function processButtonComponent(component, formState, session) {
    // Set button state based on form state or session
    if (component.disabled === undefined && formState) {
        // Could implement logic to disable button based on form validation
        component.disabled = false;
    }
    
    // Add session-specific properties if needed
    if (session && component.roleBasedVisibility) {
        const userRole = session.role || 'default';
        if (component.allowedRoles && !component.allowedRoles.includes(userRole)) {
            component.hidden = true;
        }
    }
}

/**
 * Process hidden field components
 */
function processHiddenComponent(component, queryData, formState) {
    // Hidden fields might get values from query data or session
    if (component.calculateValue && queryData) {
        // Could implement calculation logic here
        // For now, just ensure the component has a data structure
        if (!component.data) component.data = {};
    }
    
    // Set default value if specified
    if (component.defaultValue !== undefined && component.value === undefined) {
        component.value = component.defaultValue;
    }
}

/**
 * Process HTML element components
 */
function processHtmlElementComponent(component, queryData, formState) {
    // HTML elements might need content processing
    if (component.content && typeof component.content === 'string') {
        // Could implement template variable replacement here
        // For now, just ensure content is preserved
        if (!component.data) component.data = {};
        component.data.processedContent = component.content;
    }
}

module.exports = processDefaultComponent;
