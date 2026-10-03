const MIN_PASSWORD_CHARS = 8;

function isBoundedString(value, maxChars, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || value.length > maxChars) return false;
  return allowEmpty || value.trim().length > 0;
}

function isBcryptPassword(value) {
  return typeof value === 'string'
    && value.length >= MIN_PASSWORD_CHARS
    && Buffer.byteLength(value, 'utf8') <= 72;
}

// Usernames may not contain "@" (login treats such input as an email address)
// or invisible control/format characters that make look-alike names.
function isValidUsername(value) {
  return typeof value === 'string'
    && value.length >= 2
    && value.length <= 30
    && !/[@\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function readIntegerEnv(name, defaultValue, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? defaultValue : Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function readChoiceEnv(name, defaultValue, choices) {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? defaultValue : raw.trim().toLowerCase();
  if (!choices.includes(value)) {
    throw new Error(`${name} must be one of: ${choices.join(', ')}`);
  }
  return value;
}

module.exports = {
  MIN_PASSWORD_CHARS,
  isBoundedString,
  isBcryptPassword,
  isValidUsername,
  normalizeEmail,
  readChoiceEnv,
  readIntegerEnv,
};
