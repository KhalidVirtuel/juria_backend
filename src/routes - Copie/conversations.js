import express from 'express';
import { prisma } from '../services/db.js';
import { authMiddleware } from '../middleware/auth.js';
import { ragAnswer } from '../services/rag.js';

export const convRouter = express.Router();

convRouter.post('/', authMiddleware, async (req,res,next)=>{
  try{
    const { title } = req.body || {};
    const c = await prisma.conversation.create({ data: { userId: req.user.uid, title: title || 'Nouvelle conversation' } });
    console.log("conversation")
    console.log(c)
    res.json(c);
  }catch(e){ next(e); }
});

convRouter.get('/:id/messages', authMiddleware, async (req,res,next)=>{
  try{
    const conversationId = Number(req.params.id);
    const items = await prisma.message.findMany({ where: { conversationId }, orderBy:{ id:'asc' } });
    res.json({ items });
  }catch(e){ next(e); }
});

convRouter.post('/:id/messages', authMiddleware, async (req,res,next)=>{
  try{
    const conversationId = Number(req.params.id);
    const { role='user', content } = req.body || {};
    const userMsg = await prisma.message.create({
      data: { conversationId, role, content }
    });
    const { answer } = await ragAnswer({ question: content, metaFilter: {} });
    const assistant = await prisma.message.create({
      data: { conversationId, role:'assistant', content: answer || '' }
    });
    res.json({ user: userMsg, assistant });
  }catch(e){ next(e); }
});

// backward compat
convRouter.post('/:id/message', authMiddleware, async (req,res,next)=>{
  req.url = `/${req.params.id}/messages`;
  convRouter.handle(req,res,next);
});
