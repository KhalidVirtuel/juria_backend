// src/routes/ragrebuild.js
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { authMiddleware as authRequired } from '../middleware/auth.js';

export const catalogueRebuildRouter = express.Router();

// Dossier à ingérer (spécifique user knowledge)
const USER_KB_DIR = path.resolve(process.cwd(), 'data/uploads/catalogue_fr');
const USER_KB_DIR_doc = path.resolve(process.cwd(), 'data/uploads/document_fr');
// Mémoire du dernier run
let lastRun = {
  pid: null,
  startedAt: null,
  endedAt: null,
  code: null,
  ok: null,
  stdout: '',
  stderr: '',
};

function resolveScript() {
  const p = path.resolve(process.cwd(), 'scripts', 'rag-ingest.mjs');
  if (!fs.existsSync(p)) {
    throw new Error(`Script introuvable: ${p}`);
  }
  return p;
}

/**
 * POST /api/rag/rebuild
 * Lance l’ingestion en arrière-plan, en passant le dossier user_knowledge_fr au script.
 * Query optionnelle: ?dedupe=false pour désactiver la purge par fichier.
 */
catalogueRebuildRouter.post('/rebuildcat', authRequired, async (req, res) => {
  try {
    if (!fs.existsSync(USER_KB_DIR)) {
      fs.mkdirSync(USER_KB_DIR, { recursive: true });
    }

    const dedupe = String(req.query.dedupe ?? 'true').toLowerCase() !== 'false';
    const scriptPath = resolveScript();

    // reset statut
    lastRun = {
      pid: null, startedAt: new Date().toISOString(), endedAt: null,
      code: null, ok: null, stdout: '', stderr: '',
    };

    // On passe le dossier en premier argument + flag --dedupe si demandé
    const args = [scriptPath, USER_KB_DIR, ...(dedupe ? ['--dedupe'] : [])];
    const child = spawn('node', args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    lastRun.pid = child.pid;

    child.stdout.on('data', (chunk) => {
      const s = chunk.toString();
      lastRun.stdout += s;
      process.stdout.write(`[RAG-INGEST:${child.pid}] ${s}`);
    });

    child.stderr.on('data', (chunk) => {
      const s = chunk.toString();
      lastRun.stderr += s;
      process.stderr.write(`[RAG-INGEST:${child.pid}][ERR] ${s}`);
    });

    child.on('close', (code) => {
      lastRun.code = code;
      lastRun.ok = code === 0;
      lastRun.endedAt = new Date().toISOString();
    });
    console.log({
      ok: true,
      message: 'Ingestion lancée catalogue en arrière-plan',
      pid: child.pid,
      startedAt: lastRun.startedAt,
      dedupe,
      dir: USER_KB_DIR,
    });
    return res.status(202).json({
      ok: true,
      message: 'Ingestion lancée catalogue en arrière-plan',
      pid: child.pid,
      startedAt: lastRun.startedAt,
      dedupe,
      dir: USER_KB_DIR,
    });


  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});


catalogueRebuildRouter.post('/rebuildDoc', authRequired, async (req, res) => {
  try {
    if (!fs.existsSync(USER_KB_DIR_doc)) {
      fs.mkdirSync(USER_KB_DIR_doc, { recursive: true });
    }

    const dedupe = String(req.query.dedupe ?? 'true').toLowerCase() !== 'false';
    const scriptPath = resolveScript();

    // reset statut
    lastRun = {
      pid: null, startedAt: new Date().toISOString(), endedAt: null,
      code: null, ok: null, stdout: '', stderr: '',
    };

    // On passe le dossier en premier argument + flag --dedupe si demandé
    const args = [scriptPath, USER_KB_DIR_doc, ...(dedupe ? ['--dedupe'] : [])];
    const child = spawn('node', args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    lastRun.pid = child.pid;

    child.stdout.on('data', (chunk) => {
      const s = chunk.toString();
      lastRun.stdout += s;
      process.stdout.write(`[RAG-INGEST:${child.pid}] ${s}`);
    });

    child.stderr.on('data', (chunk) => {
      const s = chunk.toString();
      lastRun.stderr += s;
      process.stderr.write(`[RAG-INGEST:${child.pid}][ERR] ${s}`);
    });

    child.on('close', (code) => {
      lastRun.code = code;
      lastRun.ok = code === 0;
      lastRun.endedAt = new Date().toISOString();
    });

    return res.status(202).json({
      ok: true,
      message: 'Ingestion lancée USER_KB_DIR_doc en arrière-plan',
      pid: child.pid,
      startedAt: lastRun.startedAt,
      dedupe,
      dir: USER_KB_DIR_doc,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/** GET /api/rag/rebuild/status : récupère le statut du dernier run */
catalogueRebuildRouter.get('/rebuild/status', authRequired, (_req, res) => {
  return res.json(lastRun);
});
