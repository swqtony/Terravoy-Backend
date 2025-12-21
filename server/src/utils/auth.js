import jwt from 'jsonwebtoken';
import { config } from '../config.js';

const DEFAULT_TERRA_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function issueTerraToken({ leancloudUserId, role, phone = null, expiresInSeconds }) {
  const ttl = expiresInSeconds ?? DEFAULT_TERRA_TTL_SECONDS;
  const iat = nowSeconds();
  const exp = iat + ttl;
  const payload = {
    sub: leancloudUserId,
    role,
    phone: phone ?? undefined,
    iat,
    exp,
  };
  const token = jwt.sign(payload, config.terra.jwtSecret);
  return { token, expiresIn: ttl, issuedAt: iat };
}

export function isDevTerraToken(token) {
  return token && token === config.terra.devToken;
}

export function verifyBearerToken(token) {
  if (!token) return null;
  if (isDevTerraToken(token)) {
    return { sub: 'dev', role: 'traveler', phone: null };
  }
  try {
    return jwt.verify(token, config.terra.jwtSecret);
  } catch (_err) {
    return null;
  }
}

export function parseActor(req) {
  const headers = req.headers || {};
  const leancloudUserId =
    headers['x-leancloud-user-id'] ||
    headers['x-leancloud-userid'] ||
    null;
  const sessionToken =
    headers['x-leancloud-sessiontoken'] ||
    headers['x-leancloud-session-token'] ||
    headers['x-lc-session'] ||
    null;
  const terraToken =
    headers['x-terra-token'] ||
    headers['x-terrra-token'] ||
    (headers.authorization && headers.authorization.split(' ')[1]) ||
    null;
  const roleHeader = (headers['x-terra-role'] || '').toString().toLowerCase();
  const role = roleHeader === 'host' ? 'host' : 'traveler';
  return {
    leancloudUserId,
    sessionToken,
    terraToken,
    role,
  };
}
