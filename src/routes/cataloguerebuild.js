// src/routes/ragrebuild.js
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { authMiddleware as authRequired } from '../middleware/auth.js';

export const catalogueRebuildRouter = express.Router();

// Dossiers à ingérer
const USER_KB_DIR = path.resolve(process.cwd(), 'data/uploads/catalogue_fr');
const USER_KB_DIR_DOC = path.resolve(process.cwd(), 'data/uploads/document_fr');

// 🆕 Mémoire séparée pour chaque type d'ingestion
let lastRunCatalogue = {
  pid: null,
  startedAt: null,
  endedAt: null,
  code: null,
  ok: null,
  stdout: '',
  stderr: '',
};

let lastRunDocument = {
  pid: null,
  startedAt: null,
  endedAt: null,
  code: null,
  ok: null,
  stdout: '',
  stderr: '',
};

// 🆕 Sémaphore pour éviter les exécutions concurrentes
let isRunningCatalogue = false;
let isRunningDocument = false;

function resolveScript() {
  const p = path.resolve(process.cwd(), 'scripts', 'rag-ingest.mjs');
  if (!fs.existsSync(p)) {
    throw new Error(`Script introuvable: ${p}`);
  }
  return p;
}

/**
 * POST /api/catalogue/rebuildcat
 * Lance l'ingestion du catalogue en arrière-plan
 */
catalogueRebuildRouter.post('/rebuildcat', authRequired, async (req, res) => {
  try {
    // 🆕 Vérifier qu'aucune ingestion catalogue n'est en cours
    if (isRunningCatalogue) {
      return res.status(409).json({
        ok: false,
        error: 'Une ingestion du catalogue est déjà en cours',
        currentRun: {
          pid: lastRunCatalogue.pid,
          startedAt: lastRunCatalogue.startedAt,
        }
      });
    }

    // Créer le dossier si nécessaire
    if (!fs.existsSync(USER_KB_DIR)) {
      fs.mkdirSync(USER_KB_DIR, { recursive: true });
    }

    const dedupe = String(req.query.dedupe ?? 'true').toLowerCase() !== 'false';
    const scriptPath = resolveScript();

    // Reset statut
    lastRunCatalogue = {
      pid: null,
      startedAt: new Date().toISOString(),
      endedAt: null,
      code: null,
      ok: null,
      stdout: '',
      stderr: '',
    };

    isRunningCatalogue = true;  // 🆕 Marquer comme en cours

    // Lancer le script avec le dossier en argument
    const args = [scriptPath, USER_KB_DIR, ...(dedupe ? ['--dedupe'] : [])];
    const child = spawn('node', args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    lastRunCatalogue.pid = child.pid;

    // Capturer stdout
    child.stdout.on('data', (chunk) => {
      const s = chunk.toString();
      lastRunCatalogue.stdout += s;
      process.stdout.write(`[RAG-CATALOGUE:${child.pid}] ${s}`);
    });

    // Capturer stderr
    child.stderr.on('data', (chunk) => {
      const s = chunk.toString();
      lastRunCatalogue.stderr += s;
      process.stderr.write(`[RAG-CATALOGUE:${child.pid}][ERR] ${s}`);
    });

    // Gérer la fin du processus
    child.on('close', (code) => {
      lastRunCatalogue.code = code;
      lastRunCatalogue.ok = code === 0;
      lastRunCatalogue.endedAt = new Date().toISOString();
      isRunningCatalogue = false;  // 🆕 Libérer le sémaphore
      
      console.log(`✅ [RAG-CATALOGUE] Terminé avec code ${code}`);
    });

    // 🆕 Gérer les erreurs du processus
    child.on('error', (err) => {
      lastRunCatalogue.stderr += `\nErreur spawn: ${err.message}`;
      lastRunCatalogue.ok = false;
      lastRunCatalogue.endedAt = new Date().toISOString();
      isRunningCatalogue = false;
      
      console.error(`❌ [RAG-CATALOGUE] Erreur: ${err.message}`);
    });

    return res.status(202).json({
      ok: true,
      message: 'Ingestion du catalogue lancée en arrière-plan',
      pid: child.pid,
      startedAt: lastRunCatalogue.startedAt,
      dedupe,
      dir: USER_KB_DIR,
    });

  } catch (e) {
    isRunningCatalogue = false;  // 🆕 Libérer en cas d'erreur
    return res.status(500).json({ 
      ok: false, 
      error: String(e?.message || e) 
    });
  }
});

/**
 * POST /api/catalogue/rebuildDoc
 * Lance l'ingestion des documents utilisateur en arrière-plan
 */
catalogueRebuildRouter.post('/rebuildDoc', authRequired, async (req, res) => {
  try {
    // 🆕 Vérifier qu'aucune ingestion document n'est en cours
    if (isRunningDocument) {
      return res.status(409).json({
        ok: false,
        error: 'Une ingestion de documents est déjà en cours',
        currentRun: {
          pid: lastRunDocument.pid,
          startedAt: lastRunDocument.startedAt,
        }
      });
    }

    // Créer le dossier si nécessaire
    if (!fs.existsSync(USER_KB_DIR_DOC)) {
      fs.mkdirSync(USER_KB_DIR_DOC, { recursive: true });
    }

    const dedupe = String(req.query.dedupe ?? 'true').toLowerCase() !== 'false';
    const scriptPath = resolveScript();

    // Reset statut
    lastRunDocument = {
      pid: null,
      startedAt: new Date().toISOString(),
      endedAt: null,
      code: null,
      ok: null,
      stdout: '',
      stderr: '',
    };

    isRunningDocument = true;  // 🆕 Marquer comme en cours

    // Lancer le script avec le dossier en argument
    const args = [scriptPath, USER_KB_DIR_DOC, ...(dedupe ? ['--dedupe'] : [])];
    const child = spawn('node', args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    lastRunDocument.pid = child.pid;

    // Capturer stdout
    child.stdout.on('data', (chunk) => {
      const s = chunk.toString();
      lastRunDocument.stdout += s;
      process.stdout.write(`[RAG-DOCUMENT:${child.pid}] ${s}`);
    });

    // Capturer stderr
    child.stderr.on('data', (chunk) => {
      const s = chunk.toString();
      lastRunDocument.stderr += s;
      process.stderr.write(`[RAG-DOCUMENT:${child.pid}][ERR] ${s}`);
    });

    // Gérer la fin du processus
    child.on('close', (code) => {
      lastRunDocument.code = code;
      lastRunDocument.ok = code === 0;
      lastRunDocument.endedAt = new Date().toISOString();
      isRunningDocument = false;  // 🆕 Libérer le sémaphore
      
      console.log(`✅ [RAG-DOCUMENT] Terminé avec code ${code}`);
    });

    // 🆕 Gérer les erreurs du processus
    child.on('error', (err) => {
      lastRunDocument.stderr += `\nErreur spawn: ${err.message}`;
      lastRunDocument.ok = false;
      lastRunDocument.endedAt = new Date().toISOString();
      isRunningDocument = false;
      
      console.error(`❌ [RAG-DOCUMENT] Erreur: ${err.message}`);
    });

    return res.status(202).json({
      ok: true,
      message: 'Ingestion des documents lancée en arrière-plan',
      pid: child.pid,
      startedAt: lastRunDocument.startedAt,
      dedupe,
      dir: USER_KB_DIR_DOC,
    });

  } catch (e) {
    isRunningDocument = false;  // 🆕 Libérer en cas d'erreur
    return res.status(500).json({ 
      ok: false, 
      error: String(e?.message || e) 
    });
  }
});

/**
 * GET /api/catalogue/rebuild/status
 * Récupère le statut des ingestions
 */
catalogueRebuildRouter.get('/rebuildStatus', authRequired, (req, res) => {
  // 🆕 Retourner les deux statuts
  const type = req.query.type; // 'catalogue' | 'document' | undefined
  
  if (type === 'catalogue') {
    return res.json({
      type: 'catalogue',
      isRunning: isRunningCatalogue,
      ...lastRunCatalogue,
    });
  }
  
  if (type === 'document') {
    return res.json({
      type: 'document',
      isRunning: isRunningDocument,
      ...lastRunDocument,
    });
  }
  
  // Retourner les deux si pas de type spécifié
  console.log('Returning status for both catalogue and document ingestions');
  console.log('Catalogue status:', { isRunning: isRunningCatalogue, ...lastRunCatalogue });
  console.log('Document status:', { isRunning: isRunningDocument, ...lastRunDocument });
  return res.json({
    catalogue: {
      isRunning: isRunningCatalogue,
      ...lastRunCatalogue,
    },
    document: {
      isRunning: isRunningDocument,
      ...lastRunDocument,
    },
  });
});






/**
 * GET /api/catalogue/status
 * Retourne le statut de l'ingestion en cours
 */
catalogueRebuildRouter.get('/status', authRequired, async (req, res) => {
  try {
    return res.status(200).json({
      ok: true,
      isRunning: isRunningCatalogue,
      lastRun: {
        pid: lastRunCatalogue.pid,
        startedAt: lastRunCatalogue.startedAt,
        endedAt: lastRunCatalogue.endedAt,
        code: lastRunCatalogue.code,
        success: lastRunCatalogue.ok,
        stdout: lastRunCatalogue.stdout,
        stderr: lastRunCatalogue.stderr,
      }
    });
  } catch (e) {
    return res.status(500).json({ 
      ok: false, 
      error: String(e?.message || e) 
    });
  }
});