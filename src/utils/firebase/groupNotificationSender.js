const axios = require("axios");
const LdapClient = require("ldapjs-client");
const { sendFcmToClients } = require("./fcmSender");

const LDAP_URL = process.env.LDAP_API;
const LDAP_BASE = process.env.LDAP_BASE;
const HASURA_GRAPHQL_ENDPOINT = process.env.GRAPHQL_API;

// Fungsi untuk mendapatkan grup dari user ID
async function getUserGroups(userId) {
  try {
    const client = new LdapClient({ url: LDAP_URL });
    
    // Cari user berdasarkan uid untuk mendapatkan DN lengkap
    const userSearch = await client.search(`ou=users,${LDAP_BASE}`, {
      scope: "sub",
      filter: `(&(objectClass=inetOrgPerson)(uid=${userId}))`,
      attributes: ["uid", "cn", "dn"],
    });

    let userDN = null;
    for await (const entry of userSearch) {
      userDN = entry.dn;
      break;
    }

    if (!userDN) {
      throw new Error(`User with ID ${userId} not found in LDAP`);
    }

    console.log(`✅ Found user DN: ${userDN}`);

    // Cari semua grup yang memiliki user ini sebagai member
    const groupSearch = await client.search(`ou=groups,${LDAP_BASE}`, {
      scope: "sub",
      filter: `(&(objectClass=posixGroup)(memberUid=${userDN}))`,
      attributes: ["cn", "memberUid"],
    });

    const userGroups = [];
    for await (const entry of groupSearch) {
      userGroups.push(entry.cn);
    }

    console.log(`✅ User ${userId} is in groups:`, userGroups);
    return userGroups;

  } catch (error) {
    console.error("❌ Error getting user groups:", error);
    throw error;
  }
}

// Fungsi untuk mendapatkan semua anggota dari grup-grup tertentu
async function getGroupMembers(groupNames) {
  try {
    const client = new LdapClient({ url: LDAP_URL });
    const groups = Array.isArray(groupNames) ? groupNames : [groupNames];
    
    let allGroupMembers = [];
    
    for (const groupName of groups) {
      const groupSearch = await client.search(`ou=groups,${LDAP_BASE}`, {
        scope: "sub",
        filter: `(&(objectClass=posixGroup)(cn=${groupName}))`,
        attributes: ["cn", "memberUid"],
      });

      for await (const entry of groupSearch) {
        const members = entry.memberUid || [];
        // Pastikan members adalah array
        const memberArray = Array.isArray(members) ? members : [members];
        allGroupMembers = [...allGroupMembers, ...memberArray];
      }
    }

    // Remove duplicates dan extract uid dari DN
    const uniqueMembers = [...new Set(allGroupMembers)];
    const memberUids = uniqueMembers
      .filter(member => member && typeof member === 'string') // Filter out invalid entries
      .map(member => {
        // Jika member adalah DN lengkap, extract uid-nya
        const uidMatch = member.match(/^uid=([^,]+)/);
        return uidMatch ? uidMatch[1] : member;
      })
      .filter(uid => uid && uid.length > 1); // Filter out single characters atau empty strings

    console.log(`✅ Found ${memberUids.length} unique members in groups:`, groups);
    console.log(`📋 Member UIDs:`, memberUids);
    return memberUids;

  } catch (error) {
    console.error("❌ Error getting group members:", error);
    throw error;
  }
}

// Fungsi untuk mendapatkan FCM token dari GraphQL berdasarkan user IDs
async function getFcmTokens(userIds) {
  try {
    if (!userIds || userIds.length === 0) {
      console.log("⚠️ No user IDs provided for FCM token query");
      return [];
    }

    const query = `
      query GetKaryawanTokens($userIds: [String!]!) {
        karyawan(where: {id_karyawan: {_in: $userIds}}) {
          id_karyawan
          token
        }
      }
    `;

    const variables = { userIds };

    const response = await axios.post(HASURA_GRAPHQL_ENDPOINT, {
      query,
      variables,
    });

    if (response.data.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(response.data.errors)}`);
    }

    const karyawanData = response.data.data.karyawan || [];
    const validTokens = karyawanData
      .filter(k => k.token && k.token.trim() !== "")
      .map(k => ({
        id_karyawan: k.id_karyawan,
        token: k.token
      }));

    console.log(`✅ Found ${validTokens.length} valid FCM tokens from ${userIds.length} users`);
    return validTokens;

  } catch (error) {
    console.error("❌ Error getting FCM tokens:", error);
    throw error;
  }
}

// Fungsi utama untuk mengirim push notification ke grup berdasarkan user ID
async function sendNotificationToUserGroup(userId, notification, data = {}) {
  try {
    console.log(`🚀 Starting group notification for user: ${userId}`);

    // Step 1: Dapatkan grup dari user
    const userGroups = await getUserGroups(userId);
    if (!userGroups || userGroups.length === 0) {
      throw new Error(`User ${userId} is not a member of any groups`);
    }

    // Step 2: Dapatkan semua anggota dari grup-grup tersebut
    const groupMembers = await getGroupMembers(userGroups);
    if (!groupMembers || groupMembers.length === 0) {
      throw new Error(`No members found in user groups: ${userGroups.join(', ')}`);
    }

    // Step 3: Exclude user yang mengirim notifikasi (opsional)
    const targetUsers = groupMembers.filter(uid => uid !== userId);
    console.log(`📋 Target users for notification:`, targetUsers);

    // Step 4: Ambil FCM token dari GraphQL
    const tokenData = await getFcmTokens(targetUsers);
    if (!tokenData || tokenData.length === 0) {
      console.log("⚠️ No valid FCM tokens found for target users");
      return { success: false, message: "No valid FCM tokens found" };
    }

    const tokens = tokenData.map(t => t.token);
    console.log(`📱 Sending notification to ${tokens.length} devices`);

    // Step 5: Kirim FCM notification
    const fcmPayload = {
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: {
        ...data,
        sender: userId,
        groups: userGroups.join(','),
      }
    };

    const fcmResponse = await sendFcmToClients(tokens, fcmPayload);
    console.log('response fcm',fcmResponse);

    return {
      success: true,
      message: `Notification sent successfully`,
      details: {
        userGroups,
        targetUsers: targetUsers.length,
        tokensFound: tokens.length,
        successCount: fcmResponse.successCount,
        failureCount: fcmResponse.failureCount,
        recipients: tokenData.map(t => ({ id: t.id_karyawan }))
      }
    };

  } catch (error) {
    console.error("❌ Error sending group notification:", error);
    return {
      success: false,
      message: error.message,
      error: error
    };
  }
}
async function sendNotificationToGroup(userGroups, notification, data = {}) {
  try {
    // Step 2: Dapatkan semua anggota dari grup-grup tersebut
    const groupMembers = await getGroupMembers(userGroups);
    if (!groupMembers || groupMembers.length === 0) {
      throw new Error(`No members found in user groups: ${userGroups.join(', ')}`);
    }

    // Step 3: Exclude user yang mengirim notifikasi (opsional)
    // const targetUsers = groupMembers.filter(uid => uid !== userId);
    const targetUsers = groupMembers;
    console.log(`📋 Target users for notification:`, targetUsers);

    // Step 4: Ambil FCM token dari GraphQL
    const tokenData = await getFcmTokens(targetUsers);
    if (!tokenData || tokenData.length === 0) {
      console.log("⚠️ No valid FCM tokens found for target users");
      return { success: false, message: "No valid FCM tokens found" };
    }

    const tokens = tokenData.map(t => t.token);
    console.log(`📱 Sending notification to ${tokens.length} devices`);

    // Step 5: Kirim FCM notification
    const fcmPayload = {
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: {
        ...data,
        sender: userGroups,
        groups: userGroups,
      }
    };

    const fcmResponse = await sendFcmToClients(tokens, fcmPayload);
    console.log('response fcm',fcmResponse);

    return {
      success: true,
      message: `Notification sent successfully`,
      details: {
        userGroups,
        targetUsers: targetUsers.length,
        tokensFound: tokens.length,
        successCount: fcmResponse.successCount,
        failureCount: fcmResponse.failureCount,
        recipients: tokenData.map(t => ({ id: t.id_karyawan }))
      }
    };

  } catch (error) {
    console.error("❌ Error sending group notification:", error);
    return {
      success: false,
      message: error.message,
      error: error
    };
  }
}
module.exports = {
  sendNotificationToGroup,
  sendNotificationToUserGroup,
  getUserGroups,
  getGroupMembers,
  getFcmTokens
};
