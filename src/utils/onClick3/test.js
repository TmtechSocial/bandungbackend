// Enhanced handleClick.js with UI Instruction support
const { configureProcess } = require("../../controller/controllerConfig");
const loadInitialApiData = require("./api/loadInitialApiData");
const fillComponentWithData = require("./components");
const { getModalConfig } = require("./config/modalConfig");

// Helper function to find clicked button in event object
function findClickedButton(event) {
  console.log("Finding clicked button in event:", JSON.stringify(event, null, 2));

  // If event has specific action related properties
  if (event.click === true) {
    const defaultKey = 'click'; // Use the key from schema.json
    console.log("Click is true, using default key:", defaultKey);
    return { 
      key: defaultKey, 
      type: 'button', 
      actionType: 'uiInstruction', 
      customType: 'modalQRComponent', // Match the customType from schema.json
      affects: 'invoice' // Match the affects from schema.json
    };
  }

  // Check if event has products array with a button
  if (Array.isArray(event.products)) {
    console.log("Checking products array for button");
    const buttonInProducts = event.products.find(product => 
      product.type === 'button' || 
      (product.element && product.element.type === 'button') ||
      product.actionButton === true
    );
    if (buttonInProducts) {
      console.log("Found button in products:", buttonInProducts);
      return buttonInProducts.element || buttonInProducts;
    }
  }

  // Check common locations for button information
  const possibleButtonLocations = [
    event.element,
    event.component,
    event.button,
    event.target,
    ...(Array.isArray(event.components) ? event.components : [])
  ];

  for (const location of possibleButtonLocations) {
    if (location && (location.type === 'button' || location.component === 'button')) {
      console.log("Found button in location:", location);
      return location;
    }
  }

  // If click is true but no button found, create a default button config
  if (event.click === true) {
    const defaultButton = {
      key: 'click',
      type: 'button',
      actionType: 'uiInstruction',
      customType: 'modalQRComponent',
      affects: 'invoice'
    };
    console.log("Created default button config:", defaultButton);
    return defaultButton;
  }

  console.log("No button found in event");
  return null;
}

// Helper function to find all buttons in schema
function findAllButtons(schema) {
  const buttons = [];
  
  function traverse(component) {
    if (!component) return;
    
    if (component.type === 'button') {
      buttons.push({
        key: component.key,
        label: component.label,
        customType: component.customType,
        actionType: component.actionType
      });
    }
    
    if (component.components) {
      component.components.forEach(traverse);
    }
  }
  
  traverse(schema);
  return buttons;
}

function findButtonConfig(schema, eventKey) {
  let buttonConfig = null;

  if (!schema) {
    console.error('Schema is required for findButtonConfig');
    return null;
  }

  if (!eventKey) {
    console.error('EventKey is required for findButtonConfig');
    return null;
  }

  function traverse(component) {
    if (!component) return;

    // Log untuk debugging
    if (component.key && component.type === 'button') {
      console.log(`Found button with key: ${component.key}`);
    }

    if (component.key === eventKey && component.type === 'button') {
      console.log(`Found matching button for key: ${eventKey}`);
      buttonConfig = component;
      return;
    }

    if (component.components) {
      component.components.forEach(traverse);
    }
  }

  traverse(schema);
  
  if (!buttonConfig) {
    console.log(`No button found with key: ${eventKey}`);
    console.log('Available buttons:', JSON.stringify(findAllButtons(schema), null, 2));
  }
  
  return buttonConfig;
}

function findDependencies(schema, affectedKeys) {
  const dependencies = new Set();
  
  function traverse(component) {
    if (!component) return;

    if (affectedKeys.includes(component.key) && component.dependsOn) {
      dependencies.add(component.dependsOn);
    }

    if (component.components) {
      component.components.forEach(traverse);
    }
  }

  traverse(schema);
  return Array.from(dependencies);
}

async function handleUIInstruction(buttonConfig, event) {
  const { customType, affects } = buttonConfig;

  console.log('Handling UI Instruction with config:', { customType, affects });

  try {
    if (!customType) {
      throw new Error('customType is required for UI Instructions');
    }

    // Get modal configuration based on customType
    console.log('Getting modal config for:', customType);
    const modalConfig = getModalConfig(customType, affects);

    // Add any additional dynamic configuration
    const dynamicConfig = {
      ...modalConfig,
      // Add any runtime configurations here
      context: {
        processData: event.data,
        sessionData: event.session
      }
    };

    // Return UI instruction untuk frontend dengan format yang sesuai
    return {
      success: true,
      type: 'UI_INSTRUCTION',
      instruction: {
        modalType: customType,  // modalQRComponent atau modalBarcodeComponent
        config: {
          modalConfig: {
            title: `Scan ${affects}`,  // Judul modal yang akan ditampilkan
            description: `Please scan the ${affects}`,  // Deskripsi untuk pengguna
            onScanSuccess: {
              action: 'setValue',
              field: affects  // Field yang akan diupdate dengan hasil scan
            },
            videoConstraints: {
              facingMode: 'environment'
            },
            scannerOptions: {
              // Opsi tambahan untuk scanner jika diperlukan
            }
          }
        }
      },
      data: {
        targetField: affects,
        context: dynamicConfig.context
      }
    };
  } catch (error) {
    console.error('Error in handleUIInstruction:', error);
    throw new Error(`Failed to handle UI Instruction: ${error.message}`);
  }
}

async function dynamicClick(fastify, process, event, session) {
  try {
    // Validate input parameters
    if (!event) {
      throw new Error('Event object is required');
    }

    // Extract key and button configuration from event
    let buttonComponent = null;
    let eventKey = null;

    console.log("Processing event:", JSON.stringify(event, null, 2));

    // Try to get key from various sources
    if (event.componentId) {
      eventKey = event.componentId;
      console.log("Found key from componentId:", eventKey);
    } else if (event.element?.key) {
      eventKey = event.element.key;
      console.log("Found key from element.key:", eventKey);
    } else if (event.key) {
      eventKey = event.key;
      console.log("Found key from event.key:", eventKey);
    }

    // If no key found, try to find or create button component
    if (!eventKey) {
      buttonComponent = findClickedButton(event);
      if (buttonComponent) {
        eventKey = buttonComponent.key;
        console.log("Found key from buttonComponent:", eventKey);
        
        // Add button configuration to event if it doesn't exist
        if (!event.buttonConfig && buttonComponent.actionType) {
          event.buttonConfig = buttonComponent;
        }
      }
    }
    
    if (!eventKey) {
      console.error('Event details:', JSON.stringify(event, null, 2));
      throw new Error('Could not determine event key from the provided event object');
    }
    
    // Update event object with the found key and button configuration
    event.key = eventKey;
    if (buttonComponent && !event.buttonConfig) {
      event.buttonConfig = buttonComponent;
    }

    // 1. Get process configuration
    const configureProcessResult = await configureProcess(fastify, process);
    if (!configureProcessResult || configureProcessResult.length === 0) {
      throw new Error(`No configuration found for process: ${process}`);
    }
    
    const { schema_json, event_json } = configureProcessResult[0];
    
    if (!schema_json) {
      throw new Error('Schema JSON is required but was undefined');
    }

    console.log("Event received:", JSON.stringify(event, null, 2));
    console.log("Original schema_json:", JSON.stringify(schema_json, null, 2));
    console.log("event_json:", JSON.stringify(event_json, null, 2));

    // Find or use existing button configuration
    let buttonConfig = event.buttonConfig;
    
    if (!buttonConfig) {
      buttonConfig = findButtonConfig(schema_json, event.key);
    }
    
    if (!buttonConfig) {
      // If event has click=true and we're dealing with products, create a default product-related config
      if (event.click === true && Array.isArray(event.products)) {
        buttonConfig = {
          key: event.key,
          type: 'button',
          actionType: 'uiInstruction',
          customType: 'modalQRComponent', // Match the customType from schema.json
          affects: 'invoice' // Match the affects from schema.json
        };
        console.log("Created default product-related button config:", buttonConfig);
      } else {
        throw new Error(`Button configuration not found for key: ${event.key}`);
      }
    }

    // Check if this is a UI Instruction
    if (buttonConfig.actionType === 'uiInstruction') {
      console.log(`Handling UI Instruction: ${buttonConfig.customType}`);
    }

    // Normal flow for updateComponent
    const affectedComponents = event.affects || [];
    console.log("Components to be affected:", affectedComponents);

    const dependencies = findDependencies(schema_json, affectedComponents);
    console.log("Dependencies required:", dependencies);

    const apiData = await loadInitialApiData(event_json.onClick, {
      ...event,
      affected: affectedComponents,
      dependencies
    });
    console.log("API Data:", JSON.stringify(apiData, null, 2));

    const filledSchema = fillComponentWithData(schema_json, apiData, event, affectedComponents);
    console.log("Filled schema_json:", JSON.stringify(filledSchema, null, 2));

    // Dapatkan response berdasarkan tipe button
    let responseData;

    if (buttonConfig.actionType === 'uiInstruction') {
      // Jika UI Instruction, gunakan response dari handleUIInstruction yang sudah dipanggil sebelumnya
      console.log("Using UI Instruction response");
      return {
        message: "Event processed successfully",
        data: await handleUIInstruction(buttonConfig, event)
      };
    } else {
      // Jika bukan UI Instruction, gunakan response Data Update
      console.log("Creating Data Update response");
      responseData = {
        success: true,
        type: 'DATA_UPDATE',
        data: {
          formData: apiData,
          affectedComponents,
          message: 'Data berhasil diperbarui'
        },
        metadata: {
          originalSchema: schema_json,
          filledSchema: filledSchema,
          eventJson: event_json,
          eventData: event,
          dependencies
        }
      };

      const response = {
        message: "Event processed successfully",
        data: responseData
      };

      // Log response sebelum mengembalikan
      console.log('Returning response from dynamicClick:', JSON.stringify(response, null, 2));
      return response;
    }

  } catch (error) {
    console.error("Error in dynamicClick:", error);
    throw new Error(`Failed to configure process: ${error.message}`);
  }
}

module.exports = dynamicClick;