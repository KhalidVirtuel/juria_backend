import { Router } from "express";
import { synthesizeSpeech } from "../services/openai.js";
import { authRequired } from "../middleware/auth.js";

export const ttsRouter = Router();
ttsRouter.use(authRequired);

// POST /api/tts/speak  { text }
ttsRouter.post("/speak", async (req, res, next) => {
  try {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: "Paramètre 'text' requis" });
    const buf = await synthesizeSpeech(text);
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(buf);
  } catch (e) {
    next(e);
  }
});

export default ttsRouter;
