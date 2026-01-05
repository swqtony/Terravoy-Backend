export async function logAdminAudit({
  pool,
  adminUserId,
  action,
  resourceType,
  resourceId,
  before,
  after,
  reason,
  ip,
  ua,
}) {
  if (!reason) {
    const err = new Error('reason_required');
    err.code = 'REASON_REQUIRED';
    err.statusCode = 400;
    throw err;
  }

  await pool.query(
    `insert into admin_audit_logs
     (admin_user_id, action, resource_type, resource_id, before_json, after_json, reason, ip, ua)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      adminUserId,
      action,
      resourceType,
      resourceId || null,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      reason,
      ip || null,
      ua || null,
    ]
  );
}
