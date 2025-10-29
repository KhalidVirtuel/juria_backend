import { cfg } from '../config.js';
import { chatOpenAI } from './openai.js';
import { chatGroq } from './groq.js';

export async function chatCompletion(messages){
  if (cfg.openaiApiKey) {
    console.log("Utilisation de OpenAi comme LLM.");
    return chatOpenAI(messages);
  }
  if (cfg.groqApiKey) {
    console.log("Utilisation de GROQ comme LLM.");
    return chatGroq(messages); 
  }
  throw new Error('Aucune clé LLM configurée. Définis OPENAI_API_KEY ou GROQ_API_KEY.');
}
