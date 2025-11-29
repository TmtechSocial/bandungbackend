const { Pool } = require("pg");
const { DB_USER, DB_PASSWORD, DB_HOST } = process.env;
const dayjs = require('dayjs');

const formatDate = (date) => {
  if (!date) return '';
  return dayjs(date).format('YYYY-MM-DD HH:mm:ss');
};

// Menggunakan Pool bukan Client untuk mengelola koneksi secara efisien
const pool = new Pool({
  user: DB_USER,
  password: DB_PASSWORD,
  host: DB_HOST,
  database: 'camunda',
  port: 5432,
  // Mengoptimalkan pengaturan pool
  max: 20, // Maksimum koneksi dalam pool
  idleTimeoutMillis: 30000, // Waktu idle sebelum koneksi ditutup
  connectionTimeoutMillis: 2000 // Batas waktu sambungan
});

// Caching untuk mengoptimalkan hasil query
const queryCache = {
  data: {},
  timestamp: {},
  ttl: 60000, // 1 menit cache TTL
  
  set(key, data) {
    this.data[key] = data;
    this.timestamp[key] = Date.now();
  },
  
  get(key) {
    if (!this.data[key]) return null;
    if (Date.now() - this.timestamp[key] > this.ttl) {
      delete this.data[key];
      delete this.timestamp[key];
      return null;
    }
    return this.data[key];
  }
};

// Mengelola event pada pool, bukan client tunggal
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Menggunakan Common Table Expressions (CTE) dan split business_key yang menangani format timestamp dengan lebih baik
const getActiveTasksQuery = `
  WITH task_vars AS (
    SELECT 
      v.proc_inst_id_,
      MAX(CASE WHEN v.name_ = 'initiator' THEN v.text_ ELSE '' END) as initiator,
      MAX(CASE WHEN v.name_ = 'initiator_name' THEN v.text_ ELSE '' END) as initiator_name,
      MAX(CASE WHEN v.name_ = 'goals' THEN v.text_ ELSE '' END) as goals,
      MAX(CASE WHEN v.name_ = 'request_category' THEN v.text_ ELSE '' END) as request_category,
      MAX(CASE WHEN v.name_ = 'ticket' THEN v.text_ ELSE '' END) as ticket,
      MAX(CASE WHEN v.name_ = 'unit' THEN v.text_ ELSE '' END) as unit,
      MAX(CASE WHEN v.name_ = 'status_submission' THEN v.text_ ELSE '' END) as status_submission,
      MAX(CASE WHEN v.name_ = 'product' THEN v.text_ ELSE '' END) as product,
      MAX(CASE WHEN v.name_ = 'type_apps' THEN v.text_ ELSE '' END) as type_apps,
      MAX(CASE WHEN v.name_ = 'date_initiative_product' THEN v.text_ ELSE '' END) as date_initiative_product,
      MAX(CASE WHEN v.name_ = 'worker' THEN v.text_ ELSE '' END) as id_worker
    FROM 
      act_ru_variable v
    GROUP BY 
      v.proc_inst_id_
  ), 
  business_key_parts AS (
    SELECT 
      pi.id_ as proc_inst_id,
      pi.business_key_,
      TRIM(SPLIT_PART(pi.business_key_, ':', 1)) as business_key1,
      TRIM(SPLIT_PART(pi.business_key_, ':', 2)) as business_key2,
      CASE
        WHEN POSITION(':' IN pi.business_key_) > 0 AND 
             LENGTH(pi.business_key_) - LENGTH(REPLACE(pi.business_key_, ':', '')) >= 2 
        THEN
          TRIM(SUBSTRING(
            pi.business_key_ 
            FROM (
              LENGTH(SPLIT_PART(pi.business_key_, ':', 1)) + 
              LENGTH(SPLIT_PART(pi.business_key_, ':', 2)) + 
              3
            )
          ))
        ELSE ''
      END as business_key3
    FROM act_ru_execution pi
  )
  SELECT 
    pi.id_ as process_instance_id,
    pi.business_key_ as business_key,
    bkp.business_key1,
    bkp.business_key2,
    bkp.business_key3,
    t.id_ as id,
    t.task_def_key_ as task_definition_key,
    t.name_ as name,
    t.assignee_ as assignee,
    t.create_time_ as created,
    COALESCE(vars.goals, '') as goals,
    COALESCE(vars.initiator, '') as initiator,
    COALESCE(vars.initiator_name, '') as initiator_name,
    COALESCE(vars.request_category, '') as request_category,
    COALESCE(vars.ticket, '') as ticket,
    COALESCE(vars.unit, '') as unit,
    COALESCE(vars.status_submission, '') as status_submission,
    COALESCE(vars.product, '') as product,
    COALESCE(vars.type_apps, '') as type_apps,
    COALESCE(vars.date_initiative_product, '') as date_initiative_product,
    COALESCE(vars.id_worker, '') as id_worker,
    'Active' as status
  FROM 
    public.act_ru_task t
  JOIN 
    act_ru_execution pi ON t.proc_inst_id_ = pi.proc_inst_id_
  JOIN 
    task_vars vars ON pi.proc_inst_id_ = vars.proc_inst_id_
  JOIN
    business_key_parts bkp ON pi.id_ = bkp.proc_inst_id
  WHERE 
    vars.initiator = $1 OR vars.id_worker = $1
`;

const getRejectedTasksQuery = `
  WITH task_vars AS (
    SELECT 
      v.proc_inst_id_,
      MAX(CASE WHEN v.name_ = 'initiator' THEN v.text_ ELSE '' END) as initiator,
      MAX(CASE WHEN v.name_ = 'initiator_name' THEN v.text_ ELSE '' END) as initiator_name,
      MAX(CASE WHEN v.name_ = 'goals' THEN v.text_ ELSE '' END) as goals,
      MAX(CASE WHEN v.name_ = 'request_category' THEN v.text_ ELSE '' END) as request_category,
      MAX(CASE WHEN v.name_ = 'ticket' THEN v.text_ ELSE '' END) as ticket,
      MAX(CASE WHEN v.name_ = 'unit' THEN v.text_ ELSE '' END) as unit,
      MAX(CASE WHEN v.name_ = 'status_submission' THEN v.text_ ELSE '' END) as status_submission,
      MAX(CASE WHEN v.name_ = 'product' THEN v.text_ ELSE '' END) as product,
      MAX(CASE WHEN v.name_ = 'type_apps' THEN v.text_ ELSE '' END) as type_apps,
      MAX(CASE WHEN v.name_ = 'date_initiative_product' THEN v.text_ ELSE '' END) as date_initiative_product,
      MAX(CASE WHEN v.name_ = 'worker' THEN v.text_ ELSE '' END) as id_worker,
      MAX(CASE WHEN v.name_ = 'reason' THEN v.text_ ELSE 'No reason provided' END) as reason,
      MAX(CASE WHEN v.name_ = 'validate' THEN v.text_ ELSE '' END) as validate
    FROM 
      act_hi_varinst v
    GROUP BY 
      v.proc_inst_id_
  ),
  business_key_parts AS (
    SELECT 
      pi.proc_inst_id_ as proc_inst_id,
      pi.business_key_,
      TRIM(SPLIT_PART(pi.business_key_, ':', 1)) as business_key1,
      TRIM(SPLIT_PART(pi.business_key_, ':', 2)) as business_key2,
      CASE
        WHEN POSITION(':' IN pi.business_key_) > 0 AND 
             LENGTH(pi.business_key_) - LENGTH(REPLACE(pi.business_key_, ':', '')) >= 2 
        THEN
          TRIM(SUBSTRING(
            pi.business_key_ 
            FROM (
              LENGTH(SPLIT_PART(pi.business_key_, ':', 1)) + 
              LENGTH(SPLIT_PART(pi.business_key_, ':', 2)) + 
              3
            )
          ))
        ELSE ''
      END as business_key3
    FROM act_hi_procinst pi
  )
  SELECT 
    pi.proc_inst_id_ as process_instance_id,
    pi.business_key_ as business_key,
    bkp.business_key1,
    bkp.business_key2,
    bkp.business_key3,
    t.id_ as id,
    t.task_def_key_ as task_definition_key,
    t.name_ as name,
    t.assignee_ as assignee,
    t.start_time_ as created,
    COALESCE(vars.goals, '') as goals,
    COALESCE(vars.initiator, '') as initiator,
    COALESCE(vars.initiator_name, '') as initiator_name,
    COALESCE(vars.request_category, '') as request_category,
    COALESCE(vars.ticket, '') as ticket,
    COALESCE(vars.unit, '') as unit,
    COALESCE(vars.status_submission, '') as status_submission,
    COALESCE(vars.product, '') as product,
    COALESCE(vars.type_apps, '') as type_apps,
    COALESCE(vars.date_initiative_product, '') as date_initiative_product,
    COALESCE(vars.reason, 'No reason provided') as reason,
    COALESCE(vars.id_worker, '') as id_worker,
    'Rejected' as status
  FROM 
    public.act_hi_taskinst t
  JOIN 
    act_hi_procinst pi ON t.proc_inst_id_ = pi.proc_inst_id_
  JOIN 
    task_vars vars ON pi.proc_inst_id_ = vars.proc_inst_id_
  JOIN
    business_key_parts bkp ON pi.proc_inst_id_ = bkp.proc_inst_id
  WHERE 
    (vars.initiator = $1 OR vars.id_worker = $1)
    AND pi.end_time_ IS NOT NULL
    AND vars.validate = 'rejected'
  ORDER BY 
    t.start_time_ DESC
`;

const getApprovedTasksQuery = `
  WITH task_vars AS (
    SELECT 
      v.proc_inst_id_,
      MAX(CASE WHEN v.name_ = 'initiator' THEN v.text_ ELSE '' END) as initiator,
      MAX(CASE WHEN v.name_ = 'initiator_name' THEN v.text_ ELSE '' END) as initiator_name,
      MAX(CASE WHEN v.name_ = 'goals' THEN v.text_ ELSE '' END) as goals,
      MAX(CASE WHEN v.name_ = 'request_category' THEN v.text_ ELSE '' END) as request_category,
      MAX(CASE WHEN v.name_ = 'ticket' THEN v.text_ ELSE '' END) as ticket,
      MAX(CASE WHEN v.name_ = 'unit' THEN v.text_ ELSE '' END) as unit,
      MAX(CASE WHEN v.name_ = 'status_submission' THEN v.text_ ELSE '' END) as status_submission,
      MAX(CASE WHEN v.name_ = 'product' THEN v.text_ ELSE '' END) as product,
      MAX(CASE WHEN v.name_ = 'type_apps' THEN v.text_ ELSE '' END) as type_apps,
      MAX(CASE WHEN v.name_ = 'date_initiative_product' THEN v.text_ ELSE '' END) as date_initiative_product,
      MAX(CASE WHEN v.name_ = 'worker' THEN v.text_ ELSE '' END) as id_worker,
      MAX(CASE WHEN v.name_ = 'validateInitiator' THEN v.text_ ELSE '' END) as validate_initiator
    FROM 
      act_hi_varinst v
    GROUP BY 
      v.proc_inst_id_
  ),
  business_key_parts AS (
    SELECT 
      pi.proc_inst_id_ as proc_inst_id,
      pi.business_key_,
      TRIM(SPLIT_PART(pi.business_key_, ':', 1)) as business_key1,
      TRIM(SPLIT_PART(pi.business_key_, ':', 2)) as business_key2,
      CASE
        WHEN POSITION(':' IN pi.business_key_) > 0 AND 
             LENGTH(pi.business_key_) - LENGTH(REPLACE(pi.business_key_, ':', '')) >= 2 
        THEN
          TRIM(SUBSTRING(
            pi.business_key_ 
            FROM (
              LENGTH(SPLIT_PART(pi.business_key_, ':', 1)) + 
              LENGTH(SPLIT_PART(pi.business_key_, ':', 2)) + 
              3
            )
          ))
        ELSE ''
      END as business_key3
    FROM act_hi_procinst pi
  )
  SELECT 
    pi.proc_inst_id_ as process_instance_id,
    pi.business_key_ as business_key,
    bkp.business_key1,
    bkp.business_key2,
    bkp.business_key3,
    t.id_ as id,
    t.task_def_key_ as task_definition_key,
    t.name_ as name,
    t.assignee_ as assignee,
    t.start_time_ as created,
    COALESCE(vars.goals, '') as goals,
    COALESCE(vars.initiator, '') as initiator,
    COALESCE(vars.initiator_name, '') as initiator_name,
    COALESCE(vars.request_category, '') as request_category,
    COALESCE(vars.ticket, '') as ticket,
    COALESCE(vars.unit, '') as unit,
    COALESCE(vars.status_submission, '') as status_submission,
    COALESCE(vars.product, '') as product,
    COALESCE(vars.type_apps, '') as type_apps,
    COALESCE(vars.date_initiative_product, '') as date_initiative_product,
    COALESCE(vars.id_worker, '') as id_worker,
    'Finished' as status
  FROM 
    public.act_hi_taskinst t
  JOIN 
    act_hi_procinst pi ON t.proc_inst_id_ = pi.proc_inst_id_
  JOIN 
    task_vars vars ON pi.proc_inst_id_ = vars.proc_inst_id_
  JOIN
    business_key_parts bkp ON pi.proc_inst_id_ = bkp.proc_inst_id
  WHERE 
    (vars.initiator = $1 OR vars.id_worker = $1) 
    AND t.name_ = 'Result Validation'
    AND pi.end_time_ IS NOT NULL
    AND vars.validate_initiator = 'Finished'
  ORDER BY 
    t.start_time_ DESC
`;

// Optimalkan proses pengolahan task tanpa perlu memproses business key lagi
const processTask = (task) => {
  return {
    id: task.id,
    taskDefinitionKey: task.task_definition_key,
    processInstanceId: task.process_instance_id,
    goals: task.goals || "",
    reason: task.reason || "",
    request_category: task.request_category,
    ticket: task.ticket,
    unit: task.unit,
    name: task.name,
    assignee: task.assignee,
    created: formatDate(task.created),
    status: task.status,
    status_submission: task.status_submission,
    product: task.product || "",
    type_apps: task.type_apps || "",
    date_initiative_product: task.date_initiative_product || "",
    businessKey1: task.business_key1 || "",
    businessKey2: task.business_key2 || "",
    businessKey3: task.business_key3 || "",
    initiator_name: task.initiator_name,
  };
};

// Optimasi grouping dengan pendekatan yang lebih efisien
const groupTasksByKey = (tasks) => {
  const grouped = {};
  
  for (const task of tasks) {
    if (!task.task_definition_key) continue;

    const levels = task.task_definition_key.split(".");
    let current = grouped;

    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      
      if (i === levels.length - 1) {
        if (!current[level]) current[level] = [];
        // Menggunakan ID sebagai Set untuk cek duplikat lebih cepat
        if (!current[level].find(t => t.id === task.id)) {
          current[level].push(processTask(task));
        }
      } else {
        if (!current[level]) current[level] = {};
        current = current[level];
      }
    }
  }

  return grouped;
};

module.exports.fetchAllReport = async (initiatorId) => {
  // Cek cache terlebih dahulu
  const cacheKey = `report_${initiatorId}`;
  const cachedResult = queryCache.get(cacheKey);
  if (cachedResult) {
    console.log('Using cached data');
    return cachedResult;
  }

  // Ambil koneksi client dari pool
  const client = await pool.connect();
  
  try {
    // Jalankan kueri secara paralel
    const [activeTasks, rejectedTasks, approvedTasks] = await Promise.all([
      client.query(getActiveTasksQuery, [initiatorId]),
      client.query(getRejectedTasksQuery, [initiatorId]),
      client.query(getApprovedTasksQuery, [initiatorId]),
    ]);

    const result = {
      groupedTasks: groupTasksByKey(activeTasks.rows),
      approvedTasks: approvedTasks.rows.map(processTask),
      rejectedTasks: rejectedTasks.rows.map(processTask),
    };
    
    // Simpan ke cache
    queryCache.set(cacheKey, result);
    
    return result;
  } catch (err) {
    console.error("Error fetching tasks:", err);
    throw new Error(`Failed to fetch tasks: ${err.message}`);
  } finally {
    // Lepaskan client kembali ke pool
    client.release();
  }
};

// Tutup pool saat shutdown
module.exports.closeConnection = async () => {
  try {
    await pool.end();
    console.log('Database connection pool closed');
  } catch (err) {
    console.error('Error closing database connection pool:', err);
  }
};