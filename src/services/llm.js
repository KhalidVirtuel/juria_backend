import { cfg } from '../config.js';

let _openai = null;
let _groq = null;

async function ensureOpenAI(){
  if(!_openai){
    const OpenAI = (await import('openai')).default;
    _openai = new OpenAI({ apiKey: cfg.openaiApiKey });
  }
  console.log("OpenAI client initialized");
  console.log("Using OpenAI API Key:", cfg.openaiApiKey );
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
    temperature: 0.2,  // ✅ CHANGÉ DE 0.7 À 0.2
  });
  return { content: r.choices?.[0]?.message?.content || "" };
}




/**********************
 * 
 * export async function chatCompletion(messages) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2000,
      temperature: 0.2,
      messages: messages
    })
  });
  
  const data = await response.json();
  return { content: data.content[0].text };
}



export async function chatCompletion(messages) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-opus-4-6',
      max_tokens: 2000,
      temperature: 0.2,
      messages: messages
    })
  });

  const data = await response.json();
  return { content: data.content[0].text };
}
 */