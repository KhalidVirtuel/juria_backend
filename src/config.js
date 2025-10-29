import dotenv from 'dotenv';
dotenv.config();

export const cfg = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '8787', 10),
  jwtSecret: process.env.JWT_SECRET || 'dev_secret',
  mysql: {
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'jure_ai'
  },
  databaseUrl: process.env.DATABASE_URL,
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiChatModel: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
  embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
  groqApiKey: process.env.GROQ_API_KEY || '',
  modelLLM: process.env.LLM_MODEL || '',
  sttLanguage: process.env.STT_LANGUAGE || 'fr',
  whisperModel: process.env.WHISPER_MODEL || 'whisper-1',
  ttsModel: process.env.TTS_MODEL || 'tts-1',
  ttsVoice: process.env.TTS_VOICE || 'alloy',
  qdrantUrl: process.env.QDRANT_URL || 'http://localhost:6333',
  qdrantApiKey: process.env.QDRANT_API_KEY || '',
  qdrantCollection: process.env.QDRANT_COLLECTION || 'company_knowledge_fr',
  paths: { uploads: '/app/data/uploads' }
};
