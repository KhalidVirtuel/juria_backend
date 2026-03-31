import express from 'express';
import multer from 'multer';
import { authMiddleware } from '../middleware/auth.js';

export const sttRouter = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

sttRouter.post('/transcribe', authMiddleware, upload.single('audio'), async (_req,res)=>{
  res.json({ text: 'Transcription indisponible en mode stub.' });
});
