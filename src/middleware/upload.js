import multer from 'multer';
import fs from 'node:fs';
import { cfg } from '../config.js';
fs.mkdirSync(cfg.paths.uploads, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req,_file,cb)=>cb(null,cfg.paths.uploads),
  filename: (_req,file,cb)=>{ const u=Date.now()+'-'+Math.round(Math.random()*1e9); cb(null, u+'-'+file.originalname.replace(/\s+/g,'_')); }
});
export const upload = multer({ storage });
