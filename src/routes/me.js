// src/routes/me.js
import express from 'express';
import { prisma } from '../services/db.js';
import { authRequired } from '../middleware/auth.js';

export const meRouter = express.Router();

meRouter.get('/', authRequired, async (req, res, next) => {
  try {
    const userId = req.user?.id ?? req.user?.uid ?? null; // compat uid/id
    const email = req.user?.email ?? null;

    if (!userId && !email) {
      return res.status(401).json({ error: 'Invalid token payload (no id/email)' });
    }

    const where = userId ? { id: Number(userId) } : { email };
    const user = await prisma.user.findUnique({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        firm: true,
        specialty: true,
        email: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found for token' });
    }

    res.json(user);
  } catch (err) {
    next(err);
  }
});
