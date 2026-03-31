export const cfg = {
  port: Number(process.env.PORT || 8787),
  jwtSecret: process.env.JWT_SECRET || "change_me",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiChatModel: process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
  embeddingModel: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
  groqApiKey: process.env.GROQ_API_KEY || "",
  llmModel: process.env.LLM_MODEL || "", // when set use Groq
  qdrantUrl: process.env.QDRANT_URL || "http://qdrant:6333",
  qdrantCollection: process.env.QDRANT_COLLECTION || "company_knowledge_fr",
};
