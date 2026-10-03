const jwt = require('jsonwebtoken');
const { userQueries } = require('./db');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// `tv` mirrors users.token_version. Tokens issued before the column existed
// carry no `tv` and are treated as version 0.
function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, tv: user.token_version || 0 },
    SECRET,
    { algorithm: 'HS256', expiresIn: '30d' },
  );
}

function verifyToken(token) {
  return jwt.verify(token, SECRET, { algorithms: ['HS256'] });
}

// Express middleware
function authRequired(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = verifyToken(header.slice(7));
    const row = userQueries.findAuthById.get(payload.id);
    if (!row) return res.status(401).json({ error: 'User not found' });
    const { token_version: tokenVersion, ...user } = row;
    if ((payload.tv || 0) !== tokenVersion) {
      return res.status(401).json({ error: 'Session has been signed out' });
    }
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { signToken, verifyToken, authRequired };
