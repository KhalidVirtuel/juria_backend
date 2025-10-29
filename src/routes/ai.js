import { Router } from "express";
import { authRequired } from "../middleware/auth.js";
//import { chatOpenAI } from "../services/openai.js";
import { chatCompletion } from '../services/llm.js'
export const aiRouter = Router();
aiRouter.use(authRequired);

// POST /api/ai/contract/draft { details }
aiRouter.post("/contract/draft", async (req, res, next) => {
  try {
    const { details } = req.body || {};
    if (!details) return res.status(400).json({ error: "details requis" });
    const system = { role: "system", content: "Tu es un juriste expert. Rédige un contrat clair en français." };
    const user = { role: "user", content: `Rédige un projet de contrat avec ces éléments:\n${details}` };
    //const draft = await chatOpenAI([system, user]);
    const draft = await chatCompletion([system,user]);
    res.json({ draft });
  } catch (e) { next(e); }
});

// POST /api/ai/contract/review { contractText, focus? }
aiRouter.post("/contract/review", async (req, res, next) => {
  try {
    const { contractText, focus } = req.body || {};
    if (!contractText) return res.status(400).json({ error: "contractText requis" });
    const system = { role: "system", content: "Tu es un juriste expert. Analyse contractuelle en français." };
    const user = { role: "user", content: `Analyse ce contrat et propose des améliorations.\nPoints d'attention: ${focus||"tous"}\n---\n${contractText}` };
    //const review = await chatOpenAI([system, user]);
    const review = await chatCompletion([system,user]);
    res.json({ review });
  } catch (e) { next(e); }
});

export default aiRouter;
