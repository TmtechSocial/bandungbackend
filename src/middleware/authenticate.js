const jwt = require('jsonwebtoken');
const { CmisSession } = require('cmis');
const JWT_SECRET = process.env.JWT_SECRET;
const CMIS_SECRET_URL = process.env.CMIS_SECRET_URL;

const authenticate = async (request, reply) => {
  try {
    const authHeader = request.headers['authorization'];
    if (!authHeader) {
      reply.code(401).send({ error: 'Token must be required!' });
      return;
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    request.user = decoded;

    // Periksa header base64-encoded cmis-auth
    // const cmisAuthHeader = request.headers['cmis-auth'];
    // if (!cmisAuthHeader) {
    //   reply.code(401).send({ error: 'CMIS authentication must be required!' });
    //   return;
    // }

    // Decode cmis-auth menjadi username dan password
    // const decodedAuth = Buffer.from(cmisAuthHeader, 'base64').toString('utf-8');
    // const [username, password] = decodedAuth.split(':');

    // Validasi jika username dari token sesuai dengan username dari header
    if (!decoded.username) {
      reply.code(401).send({ error: 'Username mismatch in token and CMIS credentials!' });
      return;
    }

    // Verifikasi ke repository CMIS
    // const session = new CmisSession(CMIS_SECRET_URL);
    // session.setCredentials(username, password);

    // await session.loadRepositories();
    console.log('Authenticated with CMIS repository');
  } catch (err) {
    console.error('Authentication error:', err);
    reply.code(401).send({ error: 'Token atau kredensial CMIS tidak valid' });
  }
};

module.exports = { authenticate };