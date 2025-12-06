const config = require('../../config');
const logger = require('../logger');

// Lazy LDAP client initialization
let client = null;
function getLdapClient() {
  if (client) return client;

  const ldapConfig = config.get('api.ldap') || {};
  const LDAP_URL = ldapConfig.url || process.env.LDAP_API;
  const LDAP_BASE = ldapConfig.base || process.env.LDAP_BASE;

  if (!LDAP_URL) {
    throw new Error('LDAP is not configured (LDAP_API missing)');
  }

  const LdapClient = require('ldapjs-client');
  client = new LdapClient({ url: LDAP_URL });
  client.__LDAP_BASE = LDAP_BASE;
  return client;
}

// Fungsi untuk mengambil uid, cn, sn, dan group dari LDAP
async function getUsers(fastify, { uid, cn, sn, group } = {}) {
  try {
    // Ensure LDAP client
    try {
      client = getLdapClient();
    } catch (initErr) {
      logger.warn('LDAP client not initialized: ' + initErr.message, { component: 'ldap' });
      return { status: 503, message: 'LDAP not configured' };
    }

    const LDAP_BASE = client.__LDAP_BASE || process.env.LDAP_BASE;
    // Membentuk filter berdasarkan parameter yang diberikan atau mengambil semua jika kosong
    let filter = "(&(objectClass=inetOrgPerson)";
    if (uid) filter += `(uid=${uid})`;
    if (cn) filter += `(cn=${cn})`;
    if (sn) filter += `(sn=${sn})`;
    filter += ")";
    if (!uid && !cn && !sn) filter = "(objectClass=inetOrgPerson)";

    // Mencari pengguna berdasarkan filter yang telah dibuat
    const userSearch = await client.search(`ou=users,${LDAP_BASE}`, {
      scope: "sub",
      filter,
      attributes: ["uid", "cn", "sn"],
    });

    const users = [];
    for await (const entry of userSearch) {
      users.push({
        uid: entry.uid || "",
        cn: entry.cn || "",
        sn: entry.sn || "",
      });
    }

    if (users.length === 0) {
      return { status: 404, message: "No users found" };
    }

    // Mengambil semua grup jika tidak ada filter
    let groupMembersMap = {};
    const groupSearch = await client.search(`ou=groups,${LDAP_BASE}`, {
      scope: "sub",
      filter: "(objectClass=posixGroup)",
      attributes: ["cn", "memberUid"],
    });

    for await (const entry of groupSearch) {
      const groupName = entry.cn;
      const members = entry.memberUid || [];  // Ensure it's an array
      groupMembersMap[groupName] = members;
    }

    // Menambahkan grup ke setiap pengguna berdasarkan pencocokan dengan memberUid
    users.forEach(user => {
      // Format pencocokan uid pengguna dengan anggota grup
      user.groups = Object.keys(groupMembersMap).filter(groupName =>
        groupMembersMap[groupName].includes(`uid=${user.uid}`)
      );
    });

    return users;
  } catch (error) {
    logger.error('Error during LDAP search', { component: 'ldap', error: error.stack || error.message });
    return { status: 500, message: 'Error fetching users' };
  }
}

module.exports = { getUsers };
