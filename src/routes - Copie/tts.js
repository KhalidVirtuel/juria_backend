import express from 'express';
import { authMiddleware } from '../middleware/auth.js';

export const ttsRouter = express.Router();

function silentMp3(){
  // placeholder tiny buffer
  return Buffer.from([0,1,2,3,4,5,6,7,8,9]);
}

ttsRouter.post('/speak', authMiddleware, async (req,res)=>{
  const buf = silentMp3();
  res.setHeader('Content-Type', 'audio/mpeg');
  res.send(buf);
});
