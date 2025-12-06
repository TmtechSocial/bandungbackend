const config = require('../../config');
const logger = require('../logger');

// Lazy LDAP client initialization to avoid throwing during startup when envs missing
let client = null;
function getLdapClient() {
  if (client) return client;

  const ldapConfig = config.get('api.ldap') || {};
  const LDAP_URL = ldapConfig.url || process.env.LDAP_API;

  if (!LDAP_URL) {
    throw new Error('LDAP is not configured (LDAP_API missing)');
  }

  const LdapClient = require('ldapjs-client');
  client = new LdapClient({ url: LDAP_URL });
  return client;
}

// Fungsi untuk mendapatkan employee berdasarkan manager
async function getMember(fastify, session) {
  try {
    // Initialize client lazily (may throw if LDAP not configured)
    try {
      client = getLdapClient();
    } catch (initErr) {
      logger.warn('LDAP client not initialized: ' + initErr.message, { component: 'ldap' });
      return { status: 503, message: 'LDAP not configured' };
    }

    // Menggunakan baseDn dari session untuk mencari informasi manager
    const managerSearch = await client.search(
      session.baseDn, // Menggunakan baseDn dari session
      {
        scope: 'sub',
        filter: '(objectClass=inetOrgPerson)', // Filter untuk mencari manager
        attributes: ['cn', 'sn', 'mail', 'manager'], // Atribut manager untuk dicari
      }
    );

    //console.log("managerSearch", managerSearch);

    let managerDn;
    for await (const entry of managerSearch) {
      managerDn = entry.dn;
      break; // Ambil hanya manager pertama yang ditemukan
    }

    // Jika manager tidak ditemukan
    if (!managerDn) {
      return { status: 404, message: "Manager not found" };
    }

    // Mencari employee yang memiliki referensi ke manager ini
    const employeeSearch = await client.search(session.baseDn, { // Menggunakan baseDn dari session
      scope: "sub",
      filter: `(manager=${session.baseDn})`, // Filter untuk mencari employee yang berada di bawah manager
      attributes: ["uid", "cn"], // Hanya atribut uid yang ingin diambil dari employee
    });

    const employees = [];
    for await (const entry of employeeSearch) {
      employees.push({ cn: entry.cn, uid: entry.uid }); // Mengambil uid
    }

    // Jika tidak ada employee ditemukan, beri pesan bahwa employee tidak ada
    if (employees.length === 0) {
      return { status: 404, message: "No employees found for the manager" };
    }

    return employees; // Mengembalikan array dengan hanya atribut uid

  } catch (error) {
    // Menangani error jika ada masalah saat pencarian LDAP
    fastify.log.error("Error during LDAP search:", error); // Logging error untuk debugging
    return { status: 500, message: "Error fetching employees" };
  }
}

// Mengekspor fungsi agar dapat digunakan di file lain
module.exports = { getMember };
