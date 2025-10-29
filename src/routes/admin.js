import express from "express";
import { qdrant } from "../services/qdrant.js";
import { cfg } from "../config.js";

export const adminRouter = express.Router();

// Middleware simple : vérifie qu'on a un JWT valide + email "admin"
adminRouter.use((req, res, next) => {
  const user = req.user; // injecté par le middleware JWT
  if (!user) return res.status(401).json({ error: "Non authentifié" });
  // tu peux adapter ici ta logique (ex: role dans la DB)
  if (!user.email?.includes("admin"))
    return res.status(403).json({ error: "Accès réservé aux admins" });
  next();
});

/**
 * DELETE /api/admin/qdrant/reset
 * Supprime et recrée la collection vectorielle.
 */
adminRouter.delete("/qdrant/reset", async (req, res) => {
  try {
    const name = cfg.qdrantCollection;
    console.log(`[Admin] Reset de la collection Qdrant: ${name}...`);

    // Supprime si existe
    try {
      await qdrant.deleteCollection(name);
      console.log("→ Collection supprimée");
    } catch (e) {
      console.warn("→ Collection absente ou déjà supprimée");
    }

    // Recréation propre
    await qdrant.createCollection(name, {
      vectors: { size: 1536, distance: "Cosine" },
    });
    console.log("→ Nouvelle collection créée");

    res.json({
      ok: true,
      message: `Collection "${name}" recréée avec succès`,
    });
  } catch (err) {
    console.error("[Admin Reset Error]", err);
    res.status(500).json({ error: "Erreur interne", details: err.message });
  }
});
