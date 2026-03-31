import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { chatCompletion } from '../services/llm.js';

export const aiRouter = express.Router();

aiRouter.post('/contract/draft', authMiddleware, async (req,res,next)=>{
  try{
    const { details='' } = req.body || {};
    const sys = { role:'system', content:'Tu génères un projet de contrat en markdown concis.' };
    const usr = { role:'user', content:`Rédige un brouillon de contrat basé sur: ${details}` };
    const r = await chatCompletion([sys, usr]);
    res.json({ draft: r.content || '---' });
  }catch(e){ next(e); }
});
