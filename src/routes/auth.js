// src/routes/auth.js
import express from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../services/db.js';
import { cfg } from '../config.js';
import jwt from 'jsonwebtoken';

export const authRouter = express.Router();

function signToken(user) {
  // standardise le payload sur "id" (pas "uid")
  return jwt.sign(
    { id: user.id, email: user.email },
    cfg.jwtSecret,
    { expiresIn: '7d' }
  );
}

authRouter.post('/register', async (req, res, next) => {
  try {
    const { first_name, last_name, email, password, firm, specialty } = req.body;

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        firstName: first_name || null,
        lastName:  last_name  || null,
        firm:      firm       || null,
        specialty: specialty  || null,
        email,
        passwordHash,
      },
    });

    const token = signToken(user);
    res.json({ token });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(user);
    res.json({ token });
  } catch (err) {
    next(err);
  }
});



export function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token' });
  }
  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, cfg.jwtSecret);
    // payload attendu: { id, email, iat, exp }
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export const authRequired = authMiddleware;