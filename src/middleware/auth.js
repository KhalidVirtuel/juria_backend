// src/middleware/auth.js
import jwt from 'jsonwebtoken';
import { cfg } from '../config.js';

export function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token' });
  }
  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, cfg.jwtSecret);
    req.user = payload; // { uid, email, iat, exp }
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Alias pour compatibilité avec les routes qui importent `authRequired`
export const authRequired = authMiddleware;

// (optionnel) utilitaire pour signer un token côté serveur
export function signToken(payload, opts = {}) {
  return jwt.sign(payload, cfg.jwtSecret, { expiresIn: '7d', ...opts });
}
