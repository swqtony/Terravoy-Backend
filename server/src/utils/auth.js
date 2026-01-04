import jwt from 'jsonwebtoken';
import { config } from '../config.js';

const DEFAULT_TERRA_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function issueTerraToken({ userId, role, phone = null, expiresInSeconds }) {
  const ttl = expiresInSeconds ?? DEFAULT_TERRA_TTL_SECONDS;
  const iat = nowSeconds();
  const exp = iat + ttl;
  const payload = {
    sub: userId,
    role,
    phone: phone ?? undefined,
    iat,
    exp,
  };
  const token = jwt.sign(payload, config.terra.jwtSecret);
  return { token, expiresIn: ttl, issuedAt: iat };
}
