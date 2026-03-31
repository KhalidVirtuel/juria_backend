// src/routes/searchFiles.js
import express from 'express';
import { authMiddleware as authRequired } from '../middleware/auth.js';

export const searchRouter = express.Router();

const QDRANT_URL = process.env.QDRANT_URL || 'http://qdrant:6333';
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || 'company_knowledge_fr';

// util
function basename(p) {
  const norm = String(p || '').replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i >= 0 ? norm.slice(i + 1) : norm;
}

function makeSnippet(text, idx, len = 90) {
  const start = Math.max(0, idx - len);
  const end = Math.min(text.length, idx + len);
  return text.slice(start, end);
}

/** Scroll tous les points et filtre côté serveur (payload.text + payload.path) */
async function* scrollAllPoints({ withPayload = ['text', 'path'], pageSize = 2048 } = {}) {
  let next = null;
  for (;;) {
    const body = {
      limit: pageSize,
      with_vector: false,
      with_payload: withPayload,
    };
    if (next?.offset) body.offset = next.offset;
    if (next?.page) body.page = next.page;

    const r = await fetch(`${QDRANT_URL}/collections/${QDRANT_COLLECTION}/points/scroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(`[Qdrant scroll] ${r.status} ${r.statusText} ${txt}`);
    }
    const data = await r.json();
    const pts = data?.result?.points || [];
    for (const p of pts) yield p;

    const hasNext = data?.result?.next_page_offset || data?.result?.next_page;
    if (!hasNext) break;
    next = {
      offset: data?.result?.next_page_offset,
      page: data?.result?.next_page,
    };
  }
}

/**
 * POST /api/search/content
 * body: { q: string, mode?: 'phrase' | 'all' | 'any' }
 *  - 'phrase' (défaut) : substring exact insensible à la casse
 *  - 'all'             : tous les mots doivent être présents (AND)
 *  - 'any'             : au moins un mot (OR)
 *
 * retourne:
 * {
 *   liste_files: string[],                 // basenames (pour display)
 *   results: Array<{ filename, path, count, snippets: string[] }>
 * }
 */
searchRouter.post('/content', authRequired, async (req, res, next) => {
  try {
    const rawQ = (req.body?.q ?? req.body?.query ?? req.body?.content ?? '').trim();
    const mode = String(req.body?.mode || 'phrase').toLowerCase(); // 'phrase'|'all'|'any'
    if (!rawQ) return res.json({ liste_files: [], results: [] });

    const qLower = rawQ.toLowerCase();
    const words = qLower.split(/\s+/).filter(Boolean);

    const perFile = new Map(); // filename -> { path, count, snippets[] }

    for await (const p of scrollAllPoints()) {
      const path = p?.payload?.path;
      const text = p?.payload?.text;
      if (!path || !text) continue;

      const t = String(text).toLowerCase();

      let match = false;
      if (mode === 'phrase') {
        const idx = t.indexOf(qLower);
        if (idx !== -1) {
          match = true;
          const file = basename(path);
          const entry = perFile.get(file) || { path, count: 0, snippets: [] };
          entry.count += 1;
          if (entry.snippets.length < 3) entry.snippets.push(makeSnippet(text, idx));
          perFile.set(file, entry);
        }
      } else if (mode === 'all') {
        match = words.every(w => t.includes(w));
      } else {
        // 'any'
        match = words.some(w => t.includes(w));
      }

      if (match && mode !== 'phrase') {
        const file = basename(path);
        const idx = (() => {
          // Prend la première occurrence d’un des mots pour snippet
          for (const w of words) {
            const i = t.indexOf(w);
            if (i !== -1) return i;
          }
          return -1;
        })();

        const entry = perFile.get(file) || { path, count: 0, snippets: [] };
        entry.count += 1;
        if (idx >= 0 && entry.snippets.length < 3) entry.snippets.push(makeSnippet(text, idx));
        perFile.set(file, entry);
      }
    }

    const results = Array.from(perFile.entries())
      .map(([filename, v]) => ({ filename, path: v.path, count: v.count, snippets: v.snippets }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 100);
        //console.log(results)
    return res.json({
      liste_files: results.map(r => r.filename),
      results,
    });
  } catch (e) {
    next(e);
  }
});
