import { ok, error } from '../utils/responses.js';
import { requireAuth, respondAuthError } from '../services/authService.js';

/**
 * Simple KYC verification routes.
 * In development mode, clicking verify just sets kyc_verified = true.
 * In production, this will integrate with a third-party KYC provider.
 */
export default async function kycRoutes(app) {
    const pool = app.pg.pool;

    // Get current KYC status
    app.get('/v1/kyc/status', async (req, reply) => {
        let auth = null;
        try {
            auth = await requireAuth(req, reply);
        } catch (err) {
            if (respondAuthError(err, reply)) return;
            throw err;
        }
        if (!auth) return;

        try {
            const { rows } = await pool.query(
                'SELECT kyc_verified FROM auth_users WHERE id = $1',
                [auth.userId]
            );
            const user = rows[0];
            return ok(reply, {
                verified: user?.kyc_verified === true,
            });
        } catch (err) {
            req.log.error(err);
            return error(reply, 'SERVER_ERROR', 'Failed to fetch KYC status', 500);
        }
    });

    // Simple verify endpoint (mock for development)
    app.post('/v1/kyc/verify', async (req, reply) => {
        let auth = null;
        try {
            auth = await requireAuth(req, reply);
        } catch (err) {
            if (respondAuthError(err, reply)) return;
            throw err;
        }
        if (!auth) return;

        try {
            await pool.query(
                'UPDATE auth_users SET kyc_verified = true WHERE id = $1',
                [auth.userId]
            );

            req.log.info({
                actor: auth.userId,
                event: 'kyc.verified',
                method: 'mock',
            });

            return ok(reply, {
                verified: true,
                message: 'KYC verification completed successfully',
            });
        } catch (err) {
            req.log.error(err);
            return error(reply, 'SERVER_ERROR', 'Failed to verify KYC', 500);
        }
    });
}
