import express from 'express';
import { deleteCollection } from '../services/qdrant.js';

export const adminRouter = express.Router();

adminRouter.post('/qdrant/reset', async (_req,res,next)=>{
  try{
    await deleteCollection();
    res.json({ ok:true });
  }catch(e){ next(e); }
});
