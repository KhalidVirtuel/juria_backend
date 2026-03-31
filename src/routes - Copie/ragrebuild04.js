// src/routes/ragrebuild.js
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { authMiddleware as authRequired } from '../middleware/auth.js';

export const ragRebuildRouter = express.Router();

// On garde en mémoire le dernier run pour pouvoir exposer un statut simple
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
  // scripts/rag-ingest.mjs à la racine du projet (même endroit que package.json / dockerfile)
  const p = path.resolve(process.cwd(), 'scripts', 'rag-ingest.mjs');
  if (!fs.existsSync(p)) {
    throw new Error(`Script introuvable: ${p}`);
  }
  return p;
}

/**
 * Lance le script d'ingestion en sous-processus.
 * - dedupe: bool (par défaut true) -> ajoute l’argument --dedupe
 * Retourne immédiatement avec pid + startedAt.
 */
ragRebuildRouter.post('/rebuild', authRequired, async (req, res) => {
  try {
    const dedupe = String(req.query.dedupe ?? 'true').toLowerCase() !== 'false';
    const scriptPath = resolveScript();

    // reset lastRun
    lastRun = {
      pid: null, startedAt: new Date().toISOString(), endedAt: null,
      code: null, ok: null, stdout: '', stderr: '',
    };

    const args = [scriptPath, ...(dedupe ? ['--dedupe'] : [])];
    const child = spawn('node', args, {
      env: process.env,
      // stdio: 'inherit' pour voir dans les logs serveur,
      // mais ici on capture pour pouvoir exposer via /status :
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    lastRun.pid = child.pid;

    child.stdout.on('data', (chunk) => {
      const s = chunk.toString();
      lastRun.stdout += s;
      // Log visible dans les logs Node:
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

    // Réponse immédiate (évite les timeouts côté frontend)
    return res.status(202).json({
      ok: true,
      message: 'Ingestion lancée',
      pid: child.pid,
      startedAt: lastRun.startedAt,
      dedupe,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * Statut du dernier rebuild
 * GET /api/rag/rebuild/status
 */
ragRebuildRouter.get('/rebuild/status', authRequired, (req, res) => {
  return res.json(lastRun);
});
