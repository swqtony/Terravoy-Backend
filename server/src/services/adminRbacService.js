export async function loadAdminPermissions(pool, adminUserId) {
  const { rows } = await pool.query(
    `select r.key as role_key, p.key as permission_key
     from admin_user_roles ur
     join admin_roles r on r.id = ur.role_id
     left join admin_role_permissions rp on rp.role_id = r.id
     left join admin_permissions p on p.id = rp.permission_id
     where ur.admin_user_id = $1`,
    [adminUserId]
  );

  const permissions = new Set();
  let isSuperAdmin = false;

  for (const row of rows) {
    if (row.role_key === 'super_admin') {
      isSuperAdmin = true;
    }
    if (row.permission_key) {
      permissions.add(row.permission_key);
    }
  }

  return { permissions, isSuperAdmin };
}
