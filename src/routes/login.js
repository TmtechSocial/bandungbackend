const jwt = require("jsonwebtoken");
const LdapClient = require("ldapjs-client");
const { CmisSession } = require("cmis");


const JWT_SECRET = process.env.JWT_SECRET;
const LDAP_URL = process.env.LDAP_API;
const CMIS_SECRET_URL = process.env.CMIS_SECRET_URL;
const LDAP_BASE = process.env.LDAP_BASE;

// Helper function to search for user DN recursively
async function findUserDN(client, username, baseDN = `ou=users,${LDAP_BASE}`) {
  const searchOptions = {
    filter: `(uid=${username})`,
    scope: "sub", // Search the entire subtree
    attributes: ["dn"], // We only need the DN for authentication
  };

  try {
    const users = await client.search(baseDN, searchOptions);
    if (users.length > 0) {
      return users[0].dn;
    }
    return null;
  } catch (err) {
    console.error("Error searching for user DN:", err);
    throw new Error("Failed to search for user");
  }
}

async function getUserDetails(client, username, userDN) {
  const searchOptions = {
    filter: `(uid=${username})`,
    scope: "sub",
    attributes: [
      "uid",
      "cn",
      "mail",
      "givenName",
      "sn",
      "memberUid",
      "description",
      "telephoneNumber",
    ],
  };

  // Use the found DN's parent as the search base
  const searchBase = userDN.substring(userDN.indexOf(',') + 1);
  
  const users = await client.search(searchBase, searchOptions);

  if (users.length > 0) {
    const userInfo = users[0];
    return {
      username: userInfo.uid,
      fullName: userInfo.cn,
      email: userInfo.mail,
      firstName: userInfo.givenName,
      lastName: userInfo.sn,
      description: userInfo.description,
      phoneNumber: userInfo.telephoneNumber,
      groups: userInfo.memberUid || [],
      dn: userDN, // Include the full DN in user details
    };
  }

  throw new Error("User not found");
}

async function getUserGroups(client, userDN) {
  const groupSearchOptions = {
    filter: `(memberUid=${userDN})`,
    scope: "sub",
    attributes: [
      "cn",
      "description",
      "memberUid",
    ],
  };

  const groups = await client.search(
    `ou=groups,${LDAP_BASE}`,
    groupSearchOptions
  );

  return groups.map((group) => ({
    name: group.cn,
    description: group.description || "No description",
    memberCount: group.memberUid ? group.memberUid.length : 0,
    fullGroupDN: group.dn,
  }));
}

async function connectToCmis(cmisUrl, username, password) {
  const cmisClient = new CmisSession(cmisUrl);
  cmisClient.setCredentials(username, password);

  try {
    const repositories = await cmisClient.loadRepositories();
    //console.log("Connected to CMIS repository");
    return repositories;
  } catch (err) {
    console.error("Failed to connect to CMIS repository:", err);
    throw new Error("Unable to connect to CMIS");
  }
}

async function loginRoutes(fastify, options) {
  fastify.post("/login", async (request, reply) => {
    const { username, password } = request.body;
    const client = new LdapClient({ url: LDAP_URL });
    let cmisRepository = null;
    let cmisAuth = null;

    try {
      // First, find the user's full DN
      const userDN = await findUserDN(client, username);
      if (!userDN) {
        throw new Error("User not found");
      }

      // Attempt to bind with the found DN
      await client.bind(userDN, password);

      // Get user details and groups using the found DN
      const userDetails = await getUserDetails(client, username, userDN);
      const userGroups = await getUserGroups(client, userDN);

      // Check admin group
      const isAdmin = userGroups.some(
        (group) => group.name === "camunda-admin"
      );

      // Determine CMIS credentials
      const cmisUser = isAdmin
        ? { username: "admin", password: "admin" }
        : { username: "employee", password: "employee" };

      try {
        // Attempt CMIS connection
        cmisRepository = await connectToCmis(
          CMIS_SECRET_URL,
          cmisUser.username,
          cmisUser.password
        );
        
        cmisAuth = Buffer.from(
          `${cmisUser.username}:${cmisUser.password}`
        ).toString("base64");
      } catch (cmisError) {
        console.error("CMIS Connection failed:", cmisError);
        // Continue with login process even if CMIS fails
      }

      // Generate JWT token with full DN
      const token = jwt.sign(
        {
          username,
          dn: userDN,
          role: isAdmin ? "admin" : "employee",
          groups: userGroups.map((group) => group.name),
        },
        JWT_SECRET,
        { expiresIn: "3d" }
      );

      // Set cookies with secure options
      reply.setCookie("token", token, {
        path: "/",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 3 * 24 * 60 * 60,
      });

      // Only set CMIS cookies if CMIS connection was successful
      if (cmisAuth) {
        reply.setCookie("cmis-auth", cmisAuth, {
          path: "/",
          httpOnly: false,
          secure: process.env.NODE_ENV === "production",
          sameSite: "strict",
          maxAge: 3 * 24 * 60 * 60,
        });
      }

      reply.setCookie("user", JSON.stringify(userDetails), {
        path: "/",
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 3 * 24 * 60 * 60,
      });

      reply.setCookie("groups", JSON.stringify(userGroups), {
        path: "/",
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 3 * 24 * 60 * 60,
      });

      // Return response with CMIS status
      return reply.send({
        token,
        "cmis-auth": cmisAuth,
        user: {
          ...userDetails,
          groups: userGroups,
        },
        repository: cmisRepository,
        isAdmin,
        cmisStatus: cmisRepository ? "connected" : "unavailable"
      });
    } catch (err) {
      console.error("Authentication failed:", err.message);
      return reply.code(401).send({
        error: "Authentication failed",
        message: err.message,
      });
    } finally {
      await client.unbind();
    }
  });
}

module.exports = loginRoutes;
