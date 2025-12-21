/* eslint-disable no-console */
(async () => {
  try {
    await import('../server/scripts/worker_selfcheck.js');
  } catch (err) {
    console.error('[worker-selfcheck] error', err?.stack || err);
    process.exit(1);
  }
})();
