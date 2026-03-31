import { cfg } from '../config.js';

let _openai = null;
let _groq = null;

async function ensureOpenAI(){
  if(!_openai){
    const OpenAI = (await import('openai')).default;
    _openai = new OpenAI({ apiKey: cfg.openaiApiKey });
  }
  return _openai;
}

async function ensureGroq(){
  if(!_groq){
    const { Groq } = await import('groq-sdk');
    _groq = new Groq({ apiKey: cfg.groqApiKey });
  }
  return _groq;
}

export async function embedTexts(texts){
  const openai = await ensureOpenAI();
  const resp = await openai.embeddings.create({
    model: cfg.embeddingModel,
    input: texts,
  });
  return resp.data.map(d => d.embedding);
}

export async function chatCompletion(messages){
 /* if(cfg.llmModel){
    const groq = await ensureGroq();
    const r = await groq.chat.completions.create({
      model: cfg.llmModel,
      messages,
      temperature: 0.2,
    });
    return { content: r.choices?.[0]?.message?.content || "" };
  }*/
  const openai = await ensureOpenAI();
  const r = await openai.chat.completions.create({
    model: cfg.openaiChatModel,
    messages,
    temperature: 0.7,
  });
  return { content: r.choices?.[0]?.message?.content || "" };
}
