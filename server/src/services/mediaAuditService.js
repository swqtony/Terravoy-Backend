export async function logMediaAudit({
  pool,
  userId,
  ip,
  action,
  objectKey = null,
  reason = null,
}) {
  if (!pool) return;
  const sql = `insert into media_audit_logs (user_id, ip, action, object_key, reason)
    values ($1, $2, $3, $4, $5)`;
  const values = [userId || null, ip || null, action, objectKey, reason];
  try {
    await pool.query(sql, values);
  } catch (_err) {
    // Avoid blocking uploads if audit table is unavailable.
  }
}
