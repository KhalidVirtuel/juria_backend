// Backend API pour la gestion des templates
// backend/src/routes/templates.js

import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authRequired } from '../middleware/auth.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';


console.log('✅ Templates router loaded');


export const templatesRouter = express.Router();
const prisma = new PrismaClient();

// Configuration multer pour l'upload
const UPLOAD_DIR = path.join(process.cwd(), 'upload_templates');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const timestamp = Date.now();
    const safeName = file.originalname.replace(/\s+/g, '_');
    cb(null, `${timestamp}_${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.docx') {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers .docx sont acceptés'));
    }
  }
});

// DTO Helper
const toTemplateDTO = (template) => ({
  id: String(template.id),
  name: template.name,
  description: template.description || '',
  type: template.type,
  subtype: template.subtype,
  filename: template.filename,
  fileUrl: `/api/templates/file/${template.filename}`,
  isDefault: template.isDefault,
  uploadedAt: template.createdAt.toISOString(),
  uploadedBy: template.userId ? String(template.userId) : ''
});

// ============================================
// GET /api/templates - Liste tous les templates
// ============================================
templatesRouter.get('/', authRequired, async (req, res, next) => {
    console.log('📥 GET /api/templates called');

  try {
    const userId = req.user.uid;
    
    const templates = await prisma.documentTemplate.findMany({
      where: { userId },
      orderBy: [
        { isDefault: 'desc' },
        { createdAt: 'desc' }
      ]
    });
    
    res.json({
      templates: templates.map(toTemplateDTO)
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// GET /api/templates/:id - Récupérer un template
// ============================================
templatesRouter.get('/:id', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const templateId = Number(req.params.id);
    
    const template = await prisma.documentTemplate.findFirst({
      where: { 
        id: templateId,
        userId 
      }
    });
    
    if (!template) {
      return res.status(404).json({ error: 'Template non trouvé' });
    }
    
    res.json({
      template: toTemplateDTO(template)
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// GET /api/templates/file/:filename - Télécharger un fichier
// ============================================
templatesRouter.get('/file/:filename', authRequired, async (req, res, next) => {
  try {
    const { filename } = req.params;
    const userId = req.user.uid;
    
    // Vérifier que l'utilisateur a accès à ce fichier
    const template = await prisma.documentTemplate.findFirst({
      where: { 
        filename,
        userId 
      }
    });
    
    if (!template) {
      return res.status(404).json({ error: 'Fichier non trouvé' });
    }
    
    const filePath = path.join(UPLOAD_DIR, filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Fichier introuvable sur le serveur' });
    }
    
    res.sendFile(filePath);
  } catch (error) {
    next(error);
  }
});

// ============================================
// POST /api/templates/upload - Upload un template
// ============================================
templatesRouter.post('/upload', authRequired, upload.single('file'), async (req, res, next) => {
  try {
    const userId = req.user.uid;
    
    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier uploadé' });
    }
    
    const { name, description, type, subtype, isDefault } = req.body;
    
    if (!name || !type || !subtype) {
      // Supprimer le fichier uploadé
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ 
        error: 'Nom, type et sous-type requis' 
      });
    }
    
    // Si isDefault = true, désactiver les autres templates par défaut de ce type
    if (isDefault === 'true' || isDefault === true) {
      await prisma.documentTemplate.updateMany({
        where: {
          userId,
          type
        },
        data: {
          isDefault: false
        }
      });
    }
    
    // Créer le template
    const template = await prisma.documentTemplate.create({
      data: {
        userId,
        name,
        description: description || '',
        type,
        subtype,
        filename: req.file.filename,
        isDefault: isDefault === 'true' || isDefault === true
      }
    });
    
    res.json({
      template: toTemplateDTO(template),
      message: 'Template uploadé avec succès'
    });
  } catch (error) {
    // En cas d'erreur, supprimer le fichier uploadé
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    next(error);
  }
});

// ============================================
// PUT /api/templates/:id - Modifier un template
// ============================================
templatesRouter.put('/:id', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const templateId = Number(req.params.id);
    const { name, description, type, subtype } = req.body;
    
    const template = await prisma.documentTemplate.findFirst({
      where: { 
        id: templateId,
        userId 
      }
    });
    
    if (!template) {
      return res.status(404).json({ error: 'Template non trouvé' });
    }
    
    const updated = await prisma.documentTemplate.update({
      where: { id: templateId },
      data: {
        name: name || template.name,
        description: description !== undefined ? description : template.description,
        type: type || template.type,
        subtype: subtype || template.subtype
      }
    });
    
    res.json({
      template: toTemplateDTO(updated),
      message: 'Template mis à jour'
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// PUT /api/templates/:id/set-default - Définir comme défaut
// ============================================
templatesRouter.put('/:id/set-default', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const templateId = Number(req.params.id);
    const { type } = req.body;
    
    const template = await prisma.documentTemplate.findFirst({
      where: { 
        id: templateId,
        userId 
      }
    });
    
    if (!template) {
      return res.status(404).json({ error: 'Template non trouvé' });
    }
    
    // Désactiver tous les templates par défaut de ce type
    await prisma.documentTemplate.updateMany({
      where: {
        userId,
        type: type || template.type
      },
      data: {
        isDefault: false
      }
    });
    
    // Activer celui-ci
    const updated = await prisma.documentTemplate.update({
      where: { id: templateId },
      data: {
        isDefault: true
      }
    });
    
    res.json({
      template: toTemplateDTO(updated),
      message: 'Template défini par défaut'
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// DELETE /api/templates/:id - Supprimer un template
// ============================================
templatesRouter.delete('/:id', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const templateId = Number(req.params.id);
    
    const template = await prisma.documentTemplate.findFirst({
      where: { 
        id: templateId,
        userId 
      }
    });
    
    if (!template) {
      return res.status(404).json({ error: 'Template non trouvé' });
    }
    
    // Supprimer le fichier
    const filePath = path.join(UPLOAD_DIR, template.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    // Supprimer de la base
    await prisma.documentTemplate.delete({
      where: { id: templateId }
    });
    
    res.json({
      message: 'Template supprimé'
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// GET /api/templates/by-type/:type - Templates par type
// ============================================
templatesRouter.get('/by-type/:type', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const { type } = req.params;
    
    const templates = await prisma.documentTemplate.findMany({
      where: { 
        userId,
        type 
      },
      orderBy: [
        { isDefault: 'desc' },
        { subtype: 'asc' }
      ]
    });
    
    res.json({
      templates: templates.map(toTemplateDTO)
    });
  } catch (error) {
    next(error);
  }
});