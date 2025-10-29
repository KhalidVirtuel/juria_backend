import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { prisma } from '../services/db.js';
export const foldersRouter = Router(); foldersRouter.use(authRequired);
foldersRouter.get('/', async (req,res)=>{ const rows = await prisma.folder.findMany({ where:{ userId:req.user.id }, orderBy:{ id:'desc' } }); res.json(rows); });
foldersRouter.post('/', async (req,res)=>{ const { name } = req.body; const r = await prisma.folder.create({ data:{ userId:req.user.id, name } }); res.status(201).json({ id: r.id }); });
foldersRouter.patch('/:id', async (req,res)=>{ const { name } = req.body; await prisma.folder.update({ where:{ id: Number(req.params.id) }, data:{ name } }); res.json({ ok:true }); });
foldersRouter.delete('/:id', async (req,res)=>{ await prisma.folder.delete({ where:{ id: Number(req.params.id) } }); res.json({ ok:true }); });
