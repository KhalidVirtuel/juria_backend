import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { prisma } from '../services/db.js';

export const meRouter = express.Router();

meRouter.get('/', authMiddleware, async (req,res,next)=>{
  try{
    const u = await prisma.user.findUnique({
      where: { id: req.user.uid },
      select: { id:true, email:true, firstName:true, lastName:true, firm:true, specialty:true, createdAt:true }
    });
    res.json(u);
  }catch(e){ next(e); }
});
