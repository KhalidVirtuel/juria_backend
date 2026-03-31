// src/routes/attachments.js
import { Router } from 'express';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { authRequired } from '../middleware/auth.js';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

const UPLOAD_DIR = path.join(process.cwd(), 'upload_pieces');

/**
 * GET /api/attachments/:folderId/:attachmentId/download
 * Télécharger une pièce jointe
 */
router.get(
  '/:folderId/:attachmentId/download',
  authRequired,
  async (req, res, next) => {
    console.log('🔽 [DOWNLOAD] Attachment download requested');
    console.log('Request params:', req.params);
    try {
      const { folderId, attachmentId } = req.params;
      const userId = req.user.uid;

      console.log(`📥 [DOWNLOAD] User: ${userId}, Folder: ${folderId}, Attachment: ${attachmentId}`);

      // 1. Récupérer l'attachment (Document) avec vérification de propriété
      const attachment = await prisma.document.findFirst({
        where: {
          id: Number(attachmentId),
          folderId: Number(folderId),
          userId: userId,
        },
        include: {
          folder: {
            select: {
              userId: true,
            },
          },
        },
      });

      if (!attachment) {
        console.error('❌ [DOWNLOAD] Attachment not found or unauthorized');
        return res.status(404).json({ error: 'Pièce jointe introuvable' });
      }

      console.log(`📄 [DOWNLOAD] Attachment found:`, {
        id: attachment.id,
        title: attachment.title,
        path: attachment.path,
        size: attachment.size,
        mimeType: attachment.mimeType,
      });

      // 2. Construire le chemin complet du fichier
      const filePath = path.join(UPLOAD_DIR, attachment.path);

      console.log(`📁 [DOWNLOAD] File path: ${filePath}`);

      // 3. Vérifier que le fichier existe
      try {
        await fs.access(filePath);
      } catch (error) {
        console.error('❌ [DOWNLOAD] File not found on disk:', filePath);
        console.error('Error details:', error.message);
        
        return res.status(404).json({
          error: 'Fichier introuvable sur le serveur',
          path: filePath,
        });
      }

      // 4. Lire les stats du fichier
      const stats = await fs.stat(filePath);
      console.log(`📊 [DOWNLOAD] File size: ${stats.size} bytes`);

      // 5. Déterminer le type MIME
      const mimeType = attachment.mimeType || 'application/octet-stream';
      
      let finalMimeType = mimeType;
      if (!finalMimeType || finalMimeType === 'application/octet-stream') {
        const ext = path.extname(attachment.title).toLowerCase();
        const mimeTypes = {
          '.pdf': 'application/pdf',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.webp': 'image/webp',
          '.doc': 'application/msword',
          '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          '.xls': 'application/vnd.ms-excel',
          '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          '.txt': 'text/plain',
        };
        finalMimeType = mimeTypes[ext] || 'application/octet-stream';
      }

      // 6. Configurer les headers de réponse
      res.setHeader('Content-Type', finalMimeType);
      res.setHeader('Content-Length', stats.size.toString());
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.title)}"`);
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

      // 7. Lire et envoyer le fichier
      const fileBuffer = await fs.readFile(filePath);

      console.log(`✅ [DOWNLOAD] File sent successfully: ${attachment.title} (${fileBuffer.length} bytes)`);

      res.send(fileBuffer);

    } catch (error) {
      console.error('❌ [DOWNLOAD] Error:', error);
      next(error);
    }
  }
);

/**
 * GET /api/attachments/:folderId/:attachmentId/preview
 * Prévisualiser une pièce jointe (même logique que download)
 */
router.get(
  '/:folderId/:attachmentId/preview',
  authRequired,
  async (req, res, next) => {
    try {
      const { folderId, attachmentId } = req.params;
      const userId = req.user.uid;

      console.log(`👁️ [PREVIEW] User: ${userId}, Folder: ${folderId}, Attachment: ${attachmentId}`);

      const attachment = await prisma.document.findFirst({
        where: {
          id: Number(attachmentId),
          folderId: Number(folderId),
          userId: userId,
        },
      });

      if (!attachment) {
        console.error('❌ [PREVIEW] Attachment not found or unauthorized');
        return res.status(404).json({ error: 'Pièce jointe introuvable' });
      }

      const filePath = path.join(UPLOAD_DIR, attachment.path);

      try {
        await fs.access(filePath);
      } catch (error) {
        console.error('❌ [PREVIEW] File not found on disk:', filePath);
        return res.status(404).json({
          error: 'Fichier introuvable sur le serveur',
        });
      }

      const stats = await fs.stat(filePath);

      const mimeType = attachment.mimeType || 'application/octet-stream';
      let finalMimeType = mimeType;
      if (!finalMimeType || finalMimeType === 'application/octet-stream') {
        const ext = path.extname(attachment.title).toLowerCase();
        const mimeTypes = {
          '.pdf': 'application/pdf',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.webp': 'image/webp',
          '.doc': 'application/msword',
          '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          '.xls': 'application/vnd.ms-excel',
          '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          '.txt': 'text/plain',
        };
        finalMimeType = mimeTypes[ext] || 'application/octet-stream';
      }

      res.setHeader('Content-Type', finalMimeType);
      res.setHeader('Content-Length', stats.size.toString());
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.title)}"`);
      res.setHeader('Cache-Control', 'public, max-age=31536000');

      const fileBuffer = await fs.readFile(filePath);
      
      console.log(`✅ [PREVIEW] File sent successfully: ${attachment.title} (${fileBuffer.length} bytes)`);

      res.send(fileBuffer);

    } catch (error) {
      console.error('❌ [PREVIEW] Error:', error);
      next(error);
    }
  }
);

export { router as attachmentsRouter };