import { requireAdminAuth } from './adminAuth.js';
import { loadAdminPermissions } from '../services/adminRbacService.js';

export function requirePermission(permissionKey, pool) {
  return async (req, reply) => {
    const decoded = requireAdminAuth(req, reply);
    if (!decoded) return null;

    const { permissions, isSuperAdmin } = await loadAdminPermissions(pool, decoded.sub);
    if (!isSuperAdmin && !permissions.has(permissionKey)) {
      reply.code(403).send({ success: false, code: 'FORBIDDEN', message: 'Permission denied' });
      return null;
    }

    req.admin = { id: decoded.sub, permissions, isSuperAdmin };
    return decoded;
  };
}
