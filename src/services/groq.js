import Groq from 'groq-sdk';
import { cfg } from '../config.js';
export const groq = cfg.groqApiKey ? new Groq({ apiKey: cfg.groqApiKey }) : null;
const DEFAULT_MODEL = cfg.modelLLM || 'llama-3.1-8b-instant';
//export async function chatGroq(messages, model='llama-3.1-70b-versatile'){ if(!groq) throw new Error('GROQ_API_KEY not set'); const r = await groq.chat.completions.create({ model, messages, temperature: 0.2 }); return r.choices?.[0]?.message?.content || ''; }
export async function chatGroq(messages, model=DEFAULT_MODEL){ if(!groq) throw new Error('GROQ_API_KEY not set'); const r = await groq.chat.completions.create({ model, messages, temperature: 0.2 }); return r.choices?.[0]?.message?.content || ''; }
