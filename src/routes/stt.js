import { Router } from "express";
import { upload } from "../middleware/upload.js";
import { transcribeAudio } from "../services/openai.js";
import { authRequired } from "../middleware/auth.js";

export const sttRouter = Router();
sttRouter.use(authRequired);

// POST /api/stt/transcribe  (multipart/form-data, champ "audio")
sttRouter.post("/transcribe", upload.single("audio"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Aucun fichier audio" });
    const text = await transcribeAudio(req.file.path);
    res.json({ text });
  } catch (e) {
    next(e);
  }
});

export default sttRouter;
