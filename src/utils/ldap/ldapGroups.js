const Fastify = require("fastify");
const LdapClient = require("ldapjs-client");

// Mengambil URL LDAP dari environment variable
const LDAP_URL = process.env.LDAP_API;
const LDAP_BASE = process.env.LDAP_BASE;
const client = new LdapClient({ url: LDAP_URL });

// Fungsi untuk mengambil semua user dalam grup tertentu
async function getUsersByGroup(fastify, groupNames) {
  try {
    if (!groupNames) {
      return { status: 400, message: "Group name is required" };
    }

    // Convert single group name to array for consistent processing
    const groups = Array.isArray(groupNames) ? groupNames : [groupNames];
    
    let allGroupMembers = [];
    
    // Iterate through each group
    for (const groupName of groups) {
      // Mencari grup spesifik dan mendapatkan memberUid-nya
      const groupSearch = await client.search(`ou=groups,${LDAP_BASE}`, {
        scope: "sub",
        filter: `(&(objectClass=posixGroup)(cn=${groupName}))`,
        attributes: ["cn", "memberUid"],
      });

      for await (const entry of groupSearch) {
        const members = entry.memberUid || [];
        allGroupMembers = [...allGroupMembers, ...members];
      }
    }

    if (allGroupMembers.length === 0) {
      return { status: 404, message: `No members found in specified groups: ${groups.join(', ')}` };
    }

    // Remove duplicates from allGroupMembers
    allGroupMembers = [...new Set(allGroupMembers)];

    // Membuat filter untuk mencari user berdasarkan uid dari grup
    const userFilter = allGroupMembers.map(member => {
      // Mengekstrak uid pertama dari DN string
      const uidMatch = member.match(/^uid=([^,]+)/);
      const uid = uidMatch ? uidMatch[1] : member;
      return `(uid=${uid})`;
    }).join('');

    const finalFilter = `(&(objectClass=inetOrgPerson)(|${userFilter}))`;

    // Mencari informasi lengkap untuk setiap user dalam grup
    const userSearch = await client.search(`ou=users,${LDAP_BASE}`, {
      scope: "sub",
      filter: finalFilter,
      attributes: ["uid", "cn", "sn", "mail"],
    });

    const users = [];
    for await (const entry of userSearch) {
      users.push({
        uid: entry.uid || "",
        cn: entry.cn || "",
        sn: entry.sn || "",
        mail: entry.mail || "",
        groups: groups // Menyimpan semua grup yang diakses
      });
    }

    if (users.length === 0) {
      console.warn(`No users found in groups: ${groups.join(', ')}`);
      return [];
    }

    return users;

  } catch (error) {
    console.error("Error during LDAP group search:", error);
    return { status: 500, message: "Error fetching users from groups" };
  }
}

// Fungsi untuk mendapatkan daftar semua grup yang tersedia
async function getAllGroups(fastify) {
  try {
    const groupSearch = await client.search(`ou=groups,${LDAP_BASE}`, {
      scope: "sub",
      filter: "(objectClass=posixGroup)",
      attributes: ["cn", "memberUid"],
    });

    const groups = [];
    for await (const entry of groupSearch) {
      groups.push({
        name: entry.cn,
        memberCount: (entry.memberUid || []).length,
      });
    }

    if (groups.length === 0) {
      return { status: 404, message: "No groups found" };
    }

    return groups;

  } catch (error) {
    console.error("Error during LDAP groups search:", error);
    return { status: 500, message: "Error fetching groups" };
  }
}

module.exports = { getUsersByGroup, getAllGroups };
