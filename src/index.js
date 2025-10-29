import express from 'express';
import cors from 'cors';
import { cfg } from './config.js';
import { connectWithRetry } from './services/db.js';
import { errorHandler } from './middleware/error.js';

import { authMiddleware } from './middleware/auth.js';

import { authRouter } from './routes/auth.js';
import { meRouter } from './routes/me.js';
import { adminRouter } from "./routes/admin.js";
import { foldersRouter } from './routes/folders.js';
import { convRouter } from './routes/conversations.js';
import { docsRouter } from './routes/documents.js';
import { sttRouter } from './routes/stt.js';
import { ttsRouter } from './routes/tts.js';
import { clientsRouter } from './routes/clients.js';
import { casesRouter } from './routes/cases.js';
import { aiRouter } from './routes/ai.js';

await connectWithRetry();

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', authRouter);
app.use('/api/me', meRouter);
app.use("/api/admin", authMiddleware, adminRouter);
app.use('/api/folders', foldersRouter);
app.use('/api/conversations', convRouter);
app.use('/api/documents', docsRouter);
app.use('/api/stt', sttRouter);
app.use('/api/tts', ttsRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/cases', casesRouter);
app.use('/api/ai', aiRouter);

app.use(errorHandler);

app.listen(cfg.port, () =>
  console.log(`Juria server on http://localhost:${cfg.port}`)
);
