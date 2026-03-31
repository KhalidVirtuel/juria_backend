// src/services/storage.js
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';

const ROOT = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const UPLOADS_DIR = path.join(ROOT, 'uploads');

export async function ensureUploads() {
  await fsp.mkdir(UPLOADS_DIR, { recursive: true });
}

export async function saveBuffer(filename, buffer) {
  await ensureUploads();
  // slug simple + horodatage
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const finalName = `${Date.now()}_${safe}`;
  const abs = path.join(UPLOADS_DIR, finalName);
  await fsp.writeFile(abs, buffer);
  // on retourne un chemin **relatif** (ex: uploads/123_name.txt)
  return path.relative(ROOT, abs).replace(/\\/g, '/');
}
