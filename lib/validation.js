function isBoundedString(value, maxChars, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || value.length > maxChars) return false;
  return allowEmpty || value.trim().length > 0;
}

function isBcryptPassword(value) {
  return typeof value === 'string'
    && value.length >= 6
    && Buffer.byteLength(value, 'utf8') <= 72;
}

module.exports = { isBoundedString, isBcryptPassword };
