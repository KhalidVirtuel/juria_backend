//import { embedTexts, chatOpenAI } from './openai.js';
import { embedTexts } from './openai.js';
import { chatCompletion } from './llm.js';
import { upsertPoints, searchSimilar } from './qdrant.js';
import { v4 as uuid } from 'uuid';
import pdfParse from 'pdf-parse';
import fs from 'node:fs';

function chunkText(text, maxTokens=800, overlap=100){
  const words = text.split(/\s+/);
  const chunks = [];
  for(let i=0;i<words.length;i+=(maxTokens-overlap)){
    const c = words.slice(i, i+maxTokens).join(' ');
    if(c.trim()) chunks.push(c);
  }
  return chunks;
}

export async function extractTextFromFile(path, mime){
  if(mime==='application/pdf' || path.toLowerCase().endsWith('.pdf')){
    const data = await pdfParse(fs.readFileSync(path));
    return data.text || '';
  }
  return fs.readFileSync(path, 'utf-8');
}

export async function ingestDocument({ filePath, mime, meta }){
  const raw = await extractTextFromFile(filePath, mime);
  const chunks = chunkText(raw);
  const embeddings = await embedTexts(chunks);
  const points = embeddings.map((v,i)=>({
    id: uuid(), vector: v, payload: { ...meta, chunk_index:i, text: chunks[i] }
  }));
  await upsertPoints(points);
  return { text_length: raw.length, chunks: chunks.length };
}

export async function ragAnswer({ question, metaFilter = {} }){
  const [qVec] = await embedTexts([question]);
  const filter = Object.keys(metaFilter).length
    ? { must: Object.entries(metaFilter).map(([k,v])=>({ key:k, match:{ value:v } })) }
    : null;
  const results = await searchSimilar(qVec, 6, filter);
  const context = results.map(r=>`• ${r.payload.text}`).join('\n');

  const system = { role:'system', content:'Tu es un assistant juridique. Réponds de façon concise et fiable en t’appuyant sur le contexte.' };
  const user = { role:'user', content:`Question:\n${question}\n\nContexte pertinent:\n${context}` };

  //const answer = await chatOpenAI([system, user]);
  const answer = await chatCompletion([system, user]);

  return { answer, context };
}
