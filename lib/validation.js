function isBoundedString(value, maxChars, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || value.length > maxChars) return false;
  return allowEmpty || value.trim().length > 0;
}

function isBcryptPassword(value) {
  return typeof value === 'string'
    && value.length >= 6
    && Buffer.byteLength(value, 'utf8') <= 72;
}

function readIntegerEnv(name, defaultValue, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? defaultValue : Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

module.exports = { isBoundedString, isBcryptPassword, readIntegerEnv };
