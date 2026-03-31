// src/routes/auth.js
import express from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs'; // npm i bcryptjs
import { cfg } from '../config.js';
import { authRequired } from '../middleware/auth.js';

export const authRouter = express.Router();
const prisma = new PrismaClient();

// --- helper: map DB -> DTO attendu par le front
function toUserDTO(u) {
  return {
    id: String(u.id),
    email: u.email,
    firstName: u.firstName || '',
    lastName: u.lastName || '',
    lawFirm: u.firm || '',
    legalSpecialty: u.specialty || '',
    createdAt: (u.createdAt ?? new Date()).toISOString(),
    // Ton schéma n'a pas updatedAt -> on renvoie createdAt pour rester compatible front
    updatedAt: (u.createdAt ?? new Date()).toISOString(),
  };
}

authRouter.post('/register', async (req, res, next) => {
  try {
    // Accepte snake_case ET camelCase depuis le front
    const {
      email,
      password,
      first_name,
      last_name,
      firstName: firstNameCamel,
      lastName: lastNameCamel,
      lawFirm,
      legalSpecialty,
    } = req.body || {};

    const firstName = first_name ?? firstNameCamel ?? null;
    const lastName  = last_name ?? lastNameCamel ?? null;

    console.log(req.body)
    console.log('Registering user:', email, firstName, lastName, lawFirm, legalSpecialty);

    if (!email || !password) {
      return res.status(400).json({ error: 'email & password required' });
    }

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return res.status(409).json({ error: 'Email already exists' });

    const passwordHash = await bcrypt.hash(String(password), 10);

    // crée l’utilisateur
    const created = await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName,
        lastName,
        // si ton modèle a bien ces champs:
        firm: lawFirm ?? null,
        specialty: legalSpecialty ?? null,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        firm: true,
        specialty: true,
        createdAt: true,
        // PAS updatedAt (il n'existe pas dans ton schéma actuel)
      },
    });

    const token = jwt.sign({ uid: created.id, email: created.email }, cfg.jwtSecret, { expiresIn: '7d' });

    return res.json({
      message: 'Registered successfully',
      token,
      user: toUserDTO(created),
    });
  } catch (e) { next(e); }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email & password required' });
    }

    // on récupère passwordHash pour comparer
    const u = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        firm: true,
        specialty: true,
        createdAt: true,
        passwordHash: true,
      },
    });

    if (!u?.passwordHash) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(String(password || ''), u.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ uid: u.id, email: u.email }, cfg.jwtSecret, { expiresIn: '7d' });

    // retire passwordHash du DTO public
    const { passwordHash, ...pub } = u;

    return res.json({
      message: 'Logged in successfully',
      token,
      user: toUserDTO(pub),
    });
  } catch (e) { next(e); }
});

// profil
authRouter.get('/profile', authRequired, async (req, res, next) => {
  try {
    const u = await prisma.user.findUnique({
      where: { id: req.user.uid },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        firm: true,
        specialty: true,
        createdAt: true,
      },
    });
    if (!u) return res.status(404).json({ error: 'User not found' });
    return res.json({ user: toUserDTO(u) });
  } catch (e) { next(e); }
});

authRouter.put('/profile', authRequired, async (req, res, next) => {
  try {
    const { firstName, lastName, lawFirm, legalSpecialty } = req.body || {};
    const u = await prisma.user.update({
      where: { id: req.user.uid },
      data: {
        firstName: firstName ?? undefined,
        lastName: lastName ?? undefined,
        firm: lawFirm ?? undefined,
        specialty: legalSpecialty ?? undefined,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        firm: true,
        specialty: true,
        createdAt: true,
      },
    });
    return res.json({ user: toUserDTO(u) });
  } catch (e) { next(e); }
});
