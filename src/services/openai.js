import OpenAI from 'openai';
import { cfg } from '../config.js';
export const openai = new OpenAI({ apiKey: cfg.openaiApiKey });
export async function embedTexts(texts){ const r = await openai.embeddings.create({ model: cfg.embeddingModel, input: texts }); return r.data.map(d => d.embedding); }
export async function chatOpenAI(messages){ 
    if(!cfg.openaiApiKey) {
    throw new Error('OPENAI_API_KEY manquante');
  }
const r = await openai.chat.completions.create({ model: cfg.openaiChatModel, messages, temperature: 0.2 }); return r.choices[0].message?.content || ''; }
export async function transcribeAudio(filePath){ const fs = await import('node:fs'); const r = await openai.audio.transcriptions.create({ file: fs.createReadStream(filePath), model: cfg.whisperModel, language: cfg.sttLanguage }); return r.text; }
export async function synthesizeSpeech(text){ const r = await openai.audio.speech.create({ model: cfg.ttsModel, voice: cfg.ttsVoice, input: text, format:'mp3' }); const ab = await r.arrayBuffer(); return Buffer.from(ab); }
