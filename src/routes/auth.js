// src/routes/auth.js
import express from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs'; // npm i bcryptjs
import nodemailer from 'nodemailer';
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
    const { firstName, lastName, email, password, lawFirm, legalSpecialty } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email & password required' });

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return res.status(409).json({ error: 'Email already exists' });

    const passwordHash = await bcrypt.hash(String(password), 10);
    const u = await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: firstName || null,
        lastName: lastName || null,
        firm: lawFirm || null,
        specialty: legalSpecialty || null,
        // nouvelle préférence par défaut
        // locale: 'fr',  <-- seulement si tu ajoutes ce champ dans Prisma (optionnel, voir plus bas)
      },
      select: { id: true, email: true, firstName: true, lastName: true, firm: true, specialty: true, createdAt: true },
    });

    const token = jwt.sign({ uid: u.id, email: u.email }, cfg.jwtSecret, { expiresIn: '7d' });
    return res.json({ message: 'Registered successfully', token, user: toUserDTO(u) });
  } catch (e) { next(e); }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const u = await prisma.user.findUnique({ where: { email } });
    if (!u) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(String(password || ''), u.passwordHash || '');
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ uid: u.id, email: u.email }, cfg.jwtSecret, { expiresIn: '7d' });
    const slim = await prisma.user.findUnique({
      where: { id: u.id },
      select: { id: true, email: true, firstName: true, lastName: true, firm: true, specialty: true, createdAt: true },
    });
    return res.json({ token, user: toUserDTO(slim) });
  } catch (e) { next(e); }
});


authRouter.get('/profile', authRequired, async (req, res, next) => {
  try {
    const u = await prisma.user.findUnique({
      where: { id: req.user.uid },
      select: { id: true, email: true, firstName: true, lastName: true, firm: true, specialty: true, createdAt: true },
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
        lastName:  lastName ?? undefined,
        firm:      lawFirm ?? undefined,
        specialty: legalSpecialty ?? undefined,
      },
      select: { id: true, email: true, firstName: true, lastName: true, firm: true, specialty: true, createdAt: true },
    });
    return res.json({ user: toUserDTO(u) });
  } catch (e) { next(e); }
});



authRouter.get('/preferences', authRequired, async (req, res, next) => {
  try {
    const u = await prisma.user.findUnique({
      where: { id: req.user.uid },
      select: { /* si ajouté */ locale: true },
    });
    return res.json({
      preferences: {
        language: u?.locale || 'fr', // défaut
      }
    });
  } catch (e) { next(e); }
});

authRouter.put('/preferences', authRequired, async (req, res, next) => {
  try {
    const { language } = req.body || {};
    // si tu as ajouté `locale` dans Prisma:
    const u = await prisma.user.update({
      where: { id: req.user.uid },
      data: { locale: language ?? undefined },
      select: { /* si ajouté */ locale: true },
    });
    return res.json({ preferences: { language: u?.locale || language || 'fr' }});
  } catch (e) { next(e); }
});



authRouter.post('/waitlist', async (req, res, next) => {
  try {
    const { first_name, last_name, email } = req.body || {};
    if (!first_name || !last_name || !email) {
      return res.status(400).json({ message: 'first_name, last_name and email are required' });
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: 'khalid.serdani@gmail.com',
      subject: 'Nouvelle inscription liste d\'attente – Juria',
      text: `Nouvelle inscription :\n\nPrénom : ${first_name}\nNom : ${last_name}\nEmail : ${email}`,
      html: `<h2>Nouvelle inscription liste d'attente</h2>
             <p><strong>Prénom :</strong> ${first_name}</p>
             <p><strong>Nom :</strong> ${last_name}</p>
             <p><strong>Email :</strong> ${email}</p>`,
    });

    return res.json({ message: 'Inscription enregistrée. Merci !' });
  } catch (e) { next(e); }
});

authRouter.put('/password', authRequired, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword) return res.status(400).json({ error: 'newPassword required' });

    const u = await prisma.user.findUnique({ where: { id: req.user.uid } });
    if (!u) return res.status(404).json({ error: 'User not found' });

    if (u.passwordHash) {
      const ok = await bcrypt.compare(String(currentPassword || ''), u.passwordHash);
      if (!ok) return res.status(401).json({ error: 'Invalid current password' });
    }
    const passwordHash = await bcrypt.hash(String(newPassword), 10);
    await prisma.user.update({ where: { id: u.id }, data: { passwordHash } });
    return res.json({ message: 'Password updated' });
  } catch (e) { next(e); }
});
