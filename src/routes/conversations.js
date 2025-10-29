import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { prisma } from '../services/db.js';
import { ragAnswer } from '../services/rag.js';

export const convRouter = Router();
convRouter.use(authRequired);

convRouter.post('/', async (req,res)=>{
  const { title, folder_id } = req.body;
  const conv = await prisma.conversation.create({ data:{ userId:req.user.id, title: title || 'Nouvelle conversation' } });
  if(folder_id){
    await prisma.folderItem.create({ data:{ folderId: Number(folder_id), conversationId: conv.id } });
  }
  res.status(201).json({ id: conv.id });
});

convRouter.get('/', async (req,res)=>{
  const rows = await prisma.conversation.findMany({ where:{ userId: req.user.id }, orderBy:{ id:'desc' } });
  res.json(rows);
});

convRouter.patch('/:id', async (req,res)=>{
  const { title } = req.body;
  await prisma.conversation.update({ where:{ id: Number(req.params.id) }, data:{ title } });
  res.json({ ok:true });
});

convRouter.delete('/:id', async (req,res)=>{
  await prisma.conversation.delete({ where:{ id: Number(req.params.id) } });
  res.json({ ok:true });
});

convRouter.get('/:id/messages', async (req,res)=>{
  const rows = await prisma.message.findMany({ where:{ conversationId: Number(req.params.id) }, orderBy:{ id:'asc' } });
  res.json(rows);
});

convRouter.post('/:id/message', async (req,res,next)=>{
  try{
    const { role, content } = req.body;
    const convId = Number(req.params.id);
    await prisma.message.create({ data:{ conversationId: convId, role, content } });
    if(role === 'user'){
      const { answer } = await ragAnswer({ question: content, metaFilter:{} });
      await prisma.message.create({ data:{ conversationId: convId, role:'assistant', content: answer } });
      return res.json({ reply: answer, answer });
    }
    res.json({ ok:true });
  }catch(e){ next(e); }
});
