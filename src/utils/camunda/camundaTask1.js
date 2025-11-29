const { Pool } = require("pg");
const dayjs = require('dayjs');

// Database configuration - Use Pool instead of Client
const pool = new Pool({
  user: process.env.DB_USER,
  password: 'Mamat.01',
  host: process.env.DB_HOST,
  database: 'camunda',
  port: 5434,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
});

// Add a throttling mechanism to prevent excessive broadcasts
let lastBroadcastTime = 0;
const BROADCAST_THROTTLE_MS = 2000; // Minimum time between broadcasts (2 seconds)

// Handle pool errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Modified query to handle business key with timestamps correctly
const getTasksQuery = `
  WITH task_variables AS (
    SELECT 
        v.proc_inst_id_,
         string_agg(
            CASE 
                WHEN v.name_ = 'initiator_name' THEN v.text_
                ELSE NULL 
            END,
            ''
        ) as initiator_name,
         string_agg(
            CASE 
                WHEN v.name_ = 'refill_date' THEN v.text_
                ELSE NULL 
            END,
            ''
        ) as refill_date,
         string_agg(
            CASE 
                WHEN v.name_ = 'refill_operasional' THEN v.text_
                ELSE NULL 
            END,
            ''
        ) as refill_operasional
    FROM public.act_ru_variable v
    WHERE v.name_ IN ('initiator_name', 'refill_operasional', 'refill_date')
    GROUP BY v.proc_inst_id_
)
SELECT DISTINCT
    t.proc_inst_id_ as process_instance_id,
    t.id_ as id,
    t.task_def_key_ as task_definition_key,
    t.name_ as name,
    t.assignee_ as assignee,
    t.create_time_ as created,
    split_part(e.business_key_, ':', 1) as business_key1,
    split_part(e.business_key_, ':', 2) as business_key2,
    substring(e.business_key_ from '^[^:]+:[^:]+:(.*)$') as business_key3,
    tv.initiator_name,
    tv.refill_operasional,
    tv.refill_date,
    COALESCE(il.group_id_, il.user_id_) as delegated
FROM public.act_ru_task t
LEFT JOIN task_variables tv 
    ON t.proc_inst_id_ = tv.proc_inst_id_
LEFT JOIN public.act_ru_execution e 
    ON t.proc_inst_id_ = e.proc_inst_id_ AND e.parent_id_ IS NULL
LEFT JOIN public.act_ru_identitylink il 
    ON il.task_id_ = t.id_
WHERE (
    t.task_def_key_ LIKE '%Mirorim%'
)
AND (
    t.assignee_ = $1
    OR (
        t.id_ IN (
            SELECT tid.task_id_ 
            FROM act_ru_identitylink tid 
            WHERE (tid.group_id_ = $2 OR tid.user_id_ = $1)
        )
        AND t.assignee_ IS NULL
    )
)
`;

const formatDate = (date) => {
  if (!date) return '';
  return dayjs(date).format('YYYY-MM-DD HH:mm:ss');
};

const processTask = (task) => {
  return {
    id: task.id,
    taskDefinitionKey: task.task_definition_key,
    processInstanceId: task.process_instance_id,
    name: task.name,
    assignee: task.assignee,
    delegated: task.delegated,
    created: formatDate(task.created),
    initiator_name: task.initiator_name || '',
    refill_date: task.refill_date || '',
    refill_operasional: task.refill_operasional || '',
    businessKey1: task.business_key1 || '',
    businessKey2: task.business_key2 || '',
    businessKey3: task.business_key3 || '',
  };
};

function groupTasksByKey(tasks) {
  const grouped = {};
  tasks.forEach((task) => {
    const levels = task.taskDefinitionKey.split('.');
    let current = grouped;
    levels.forEach((level, index) => {
      if (index === levels.length - 1) {
        if (!current[level]) current[level] = [];
        current[level].push(task);
      } else {
        if (!current[level]) current[level] = {};
        current = current[level];
      }
    });
  });
  return grouped;
}

// Enhanced broadcast function with message type checking and throttling
function throttledBroadcast(wsBroadcaster, message, force = false) {
  const now = Date.now();
  // Skip if throttling is active and not forced
  if (!force && now - lastBroadcastTime < BROADCAST_THROTTLE_MS) {
    console.log("Broadcast throttled - skipping:", message.type);
    return;
  }
  
  // Update timestamp and broadcast
  lastBroadcastTime = now;
  
  if (wsBroadcaster && typeof wsBroadcaster === 'function') {
    console.log(`Broadcasting ${message.type} message`);
    wsBroadcaster(message);
  }
}

module.exports.fetchAllTasks = async (initiatorId, group, returnRaw = false, wsBroadcaster = null) => {
  console.log("Fetching tasks for initiatorId:", initiatorId, "group:", group);
  
  // Use pool.query directly - no need for manual connection management
  try {
    const { rows: tasks } = await pool.query(getTasksQuery, [initiatorId, group]);
    console.log(`Fetched ${tasks.length} tasks from database`);

    const processedTasks = tasks.map(processTask);
    const groupedTasks = groupTasksByKey(processedTasks);

    // If wsBroadcaster is provided, broadcast task updates to all clients
    if (wsBroadcaster && typeof wsBroadcaster === 'function') {
      console.log("Broadcasting task updates via WebSocket");
      
      // Optimize WebSocket broadcasting by sending only what's needed
      // Create a compact payload for better performance
      const payload = {
        type: "TASK_UPDATED",
        tasks: processedTasks,
        userId: initiatorId,
        timestamp: new Date().toISOString()
      };
      
      // Send the update message with optimized payload
      wsBroadcaster(payload);
      
      // Only send full refresh if explicitly needed (i.e., not for every claim/unclaim)
      if (returnRaw) {
        // Only broadcast full task data when needed (returnRaw=true is a signal for complete refresh)
        wsBroadcaster({
          type: "TASKS_REFRESHED",
          groupedTasks,
          timestamp: new Date().toISOString()
        });
      }
    }

    if (returnRaw) {
      return processedTasks;
    }

    return {
      groupedTasks,
    };
  } catch (err) {
    console.error("Error fetching tasks:", err);
    throw new Error(`Failed to fetch tasks: ${err.message}`);
  }
};

// Add a new method to force a refresh without throttling
module.exports.forceRefreshTasks = async (initiatorId, group, wsBroadcaster = null) => {
  try {
    const { rows: tasks } = await pool.query(getTasksQuery, [initiatorId, group]);
    const processedTasks = tasks.map(processTask);
    const groupedTasks = groupTasksByKey(processedTasks);
    
    if (wsBroadcaster && typeof wsBroadcaster === 'function') {
      // Force broadcast without throttling
      wsBroadcaster({
        type: "TASKS_REFRESHED",
        groupedTasks,
        rawTasks: processedTasks,
        initiatorId,
        timestamp: new Date().toISOString(),
        forced: true
      });
    }
    
    return {
      groupedTasks,
      rawTasks: processedTasks
    };
  } catch (err) {
    console.error("Error in force refresh:", err);
    throw err;
  }
};

// Graceful shutdown function
module.exports.closePool = async () => {
  try {
    await pool.end();
    console.log('Database pool closed successfully');
  } catch (err) {
    console.error('Error closing database pool:', err);
  }
};
