const express = require('express');

module.exports = function createMemoryModule() {
  const router = express.Router();

  // The production branch intentionally keeps memory storage and retrieval
  // unavailable. Preserve a deterministic denial for existing clients.
  router.use('/', (req, res) => {
    res.status(403).json({ error: 'Memory features are unavailable on the server build.' });
  });

  return {
    router,
    service: {
      async buildUserMemoryContext() {
        return { context: '', count: 0, queryChars: 0, disabled: true };
      },
    },
  };
};
