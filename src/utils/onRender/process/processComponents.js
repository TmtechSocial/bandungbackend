// process/processComponents.js - OPTIMIZED VERSION

const processSelectComponent = require("./select");
const processSelectBoxesComponent = require("./selectboxes");
const processContentComponent = require("./content");
const processDefaultComponent = require("./default");
const processDataGridComponent = require("./datagrid");
const processEditGridComponent = require("./editgrid");

// Optimization: Component processor mapping for faster lookup
const componentProcessors = {
  select: processSelectComponent,
  selectboxes: processSelectBoxesComponent,
  content: processContentComponent,
  datagrid: processDataGridComponent,
  editgrid: processEditGridComponent,
  default: processDefaultComponent,
};

async function processComponents(
  components,
  queryData,
  formState,
  session,
  apiConfigs,
  memberResult
) {
  const startTime = Date.now();

  // Pastikan data API/GraphQL sudah tersedia sebelum mapping
  if (formState && formState.apiResults) {
  } else {
  }

  // Optimization: Normalize components to array
  if (
    components &&
    typeof components === "object" &&
    !Array.isArray(components)
  ) {
    components = [components];
  }

  if (!components || components.length === 0) {
    return;
  }

  // Optimization: Group components by processing strategy
  const parallelComponents = [];
  const sequentialComponents = [];
  const fastSyncComponents = [];

  components.forEach((component) => {
    const { type } = component;
    
    if (type === "selectboxes") {
      console.log("Found selectboxes component in initial grouping:", {
        key: component.key,
        ldap: component.ldap,
        data: component.data,
        values: component.values
      });
    }

    // Fast sync components (no async operations, lightweight)
    if (type === "default") {
      fastSyncComponents.push(component);
    }
    // Heavy components that can run in parallel (image processing, etc.)
    else if (type === "content") {
      parallelComponents.push(component);
    }
    // Components that might need API calls or have dependencies
    else {
      sequentialComponents.push(component);
    }
  });

  // Process fast sync components first (no await needed)
  const syncStartTime = Date.now();
  fastSyncComponents.forEach((component) => {
    const processor = componentProcessors.default;
    try {
      processor(component, queryData, formState, apiConfigs, session);
    } catch (error) {
    }
  });
  const syncTime = Date.now() - syncStartTime;

  // Process parallel components
  let parallelTime = 0;
  if (parallelComponents.length > 0) {
    const parallelStartTime = Date.now();
    const parallelPromises = parallelComponents.map(async (component) => {
      const { type } = component;
      const processor =
        componentProcessors[type] || componentProcessors.default;

      try {
        if (type === "content") {
          const htmlContentArray = processor(
            component,
            queryData,
            formState,
            apiConfigs
          );
          // Update the component's html property with the processed content
          if (htmlContentArray && htmlContentArray.length > 0) {
            component.html =
              htmlContentArray.length === 1
                ? htmlContentArray[0]
                : htmlContentArray.join("");
          }
        } else if (type === "selectboxes") {
          console.log("[PARALLEL] Before processing selectboxes:", {
            key: component.key,
            type: component.type,
            ldap: component.ldap,
            data: component.data,
            values: component.values
          });
          const result = await processor(component, queryData, formState, apiConfigs, session?.fastify);
          console.log("[PARALLEL] After processing selectboxes:", {
            key: component.key,
            type: component.type,
            ldap: component.ldap,
            data: component.data,
            values: component.values,
            result: result
          });
          if (result) {
            Object.assign(component, result);
          }
        } else {
          processor(component, queryData, formState, apiConfigs, session);
        }
        return { success: true, type, key: component.key };
      } catch (error) {
        return {
          success: false,
          type,
          key: component.key,
          error: error.message,
        };
      }
    });

    // FIXED: Properly await parallel components
    try {
      const results = await Promise.all(parallelPromises);
      const successful = results.filter((r) => r.success).length;
      parallelTime = Date.now() - parallelStartTime;
      
    } catch (error) {
      parallelTime = Date.now() - parallelStartTime;
    }
  }

  // Process sequential components
  const sequentialStartTime = Date.now();
  for (const component of sequentialComponents) {
    const { type } = component;
    const processor = componentProcessors[type] || componentProcessors.default;
    // Reset all possible cache/data for non-datagrid and non-selectboxes components
    if (type !== "datagrid" && type !== "selectboxes") {
      // --- FIX: Only reset select if it has table or apiSource ---
      if (type === "select") {
        if (component.table || component.apiSource) {
          if (component.data && Array.isArray(component.data.values)) {
            component.data.values = [];
          }
        }
        // else: do not touch static select
      } else {
        if (component.data) {
          Object.keys(component.data).forEach((k) => delete component.data[k]);
        }
        if (typeof component.html !== "undefined") {
          component.html = undefined;
        }
        if (component.value) {
          component.value = undefined;
        }
      }
    }
    try {
      switch (type) {
        case "select":
          processor(component, queryData, formState, apiConfigs);
          break;
        case "datagrid":
          processor(component, queryData, formState);
          break;
        case "editgrid":
          processor(component, queryData, formState);
          break;
        case "selectboxes":
          console.log("Processing selectboxes component:", {
            key: component.key,
            type: component.type,
            ldap: component.ldap
          });
          // Tambahkan await di sini
          const result = await processor(component, queryData, formState, apiConfigs, session?.fastify);
          
          // Jika ada result, update component
          if (result) {
              Object.assign(component, result);
          }
          
          console.log("Selectboxes component after processing:", {
            key: component.key,
            data: component.data,
            values: component.values,
            result: result // tambahkan log result
          });
          break;
        default:
          processor(component, queryData, formState, apiConfigs, session);
          break;
      }
    } catch (error) {
    }
  }
  const sequentialTime = Date.now() - sequentialStartTime;

  const totalTime = Date.now() - startTime;
  
  // Final summary
  const allComponents = [...fastSyncComponents, ...parallelComponents, ...sequentialComponents];
  const totalProcessed = allComponents.length;
  
  // Check for any datagrid specific results
  const datagridComponents = allComponents.filter(c => c.type === 'datagrid');
}

module.exports = processComponents;

