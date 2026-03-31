import express from 'express';
import { prisma } from '../services/db.js';
import { authMiddleware } from '../middleware/auth.js';

export const casesRouter = express.Router();

casesRouter.post('/', authMiddleware, async (req,res,next)=>{
  try{
    const { client_id, title, description } = req.body || {};
    const c = await prisma.case.create({ data: { userId: req.user.uid, clientId: client_id, title, description } });
    res.json(c);
  }catch(e){ next(e); }
});
