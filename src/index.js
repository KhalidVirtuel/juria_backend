// src/index.js
import express from 'express';
import path from 'node:path';

import cors from 'cors';
import { cfg } from './config.js';
import { connectWithRetry } from './services/db.js';
import { errorHandler } from './middleware/error.js';

import { authRouter } from './routes/auth.js';
import { meRouter } from './routes/me.js';
import { adminRouter } from './routes/admin.js';
import { foldersRouter } from './routes/folders.js';
import { docsRouter } from './routes/documents.js';
import { sttRouter } from './routes/stt.js';
import { ttsRouter } from './routes/tts.js';
import { clientsRouter } from './routes/clients.js';
import { casesRouter } from './routes/cases.js';
import { aiRouter } from './routes/ai.js';
import { authMiddleware } from './middleware/auth.js';

// *** AJOUTE CECI ***
import { chatRouter } from './routes/chat.js';
/*import { ragRouter } from './routes/ragdata.js'; // <── NEW*/
import { ragStatsRouter } from './routes/ragstats.js';
import { ragRebuildRouter } from './routes/ragrebuild.js';
import { ragDataRouter } from './routes/ragdata.js';
import { catalogueRagStatsRouter } from './routes/catalogueragstats.js';
import { catalogueDataRouter } from './routes/cataloguedatanew.js';
import { catalogueRebuildRouter } from './routes/cataloguerebuild.js';

import { searchRouter } from './routes/searchFiles.js';
import { attachmentsRouter } from './routes/attachments.js';

import { templatesRouter } from './routes/Templates.js';


await connectWithRetry();

const app = express();
app.use('/uploads', express.static(path.join(process.cwd(), 'data/uploads/user_knowledge_fr')));

app.use(cors());
app.use(express.json({ limit: '20mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', authRouter);
app.use('/api/me', meRouter);
app.use('/api/admin', authMiddleware, adminRouter);
app.use('/api/folders', foldersRouter);
app.use('/api/documents', docsRouter);
app.use('/api/stt', sttRouter);
app.use('/api/tts', ttsRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/cases', casesRouter);
app.use('/api/ai', aiRouter);


app.use('/api/chat', chatRouter);

app.use('/api/ragstat', ragStatsRouter);
app.use('/api/rag', ragDataRouter);
app.use('/api/rag', ragRebuildRouter);

app.use('/api/cataloguestat', catalogueRagStatsRouter);
app.use('/api/cataloguedata', catalogueDataRouter);
app.use('/api/catalogue', catalogueRebuildRouter);

app.use('/api/search', searchRouter);
app.use('/api/attachments', attachmentsRouter);

app.use('/api/templates', templatesRouter);

app.use(errorHandler);
app.listen(cfg.port, () => console.log(`Juria server on http://localhost:${cfg.port}`));
