import express from 'express';
import { prisma } from '../services/db.js';
import { authMiddleware } from '../middleware/auth.js';

export const clientsRouter = express.Router();

clientsRouter.post('/', authMiddleware, async (req,res,next)=>{
  try{
    const { name, email } = req.body || {};
    const c = await prisma.client.create({ data: { userId: req.user.uid, name, email } });
    res.json(c);
  }catch(e){ next(e); }
});
