import { Router } from "express";
import { authRequired } from "../middleware/auth.js";
import { prisma } from "../services/db.js";

export const casesRouter = Router();
casesRouter.use(authRequired);

// GET /api/cases
casesRouter.get("/", async (req, res, next) => {
  try {
    const rows = await prisma.case.findMany({
      where: { userId: req.user.id },
      orderBy: { id: "desc" }
    });
    res.json(rows);
  } catch (e) { next(e); }
});

// POST /api/cases  { client_id, title, description?, status? }
casesRouter.post("/", async (req, res, next) => {
  try {
    const { client_id, title, description, status } = req.body || {};
    if (!client_id || !title) return res.status(400).json({ error: "client_id et title requis" });
    const r = await prisma.case.create({
      data: {
        userId: req.user.id,
        clientId: Number(client_id),
        title,
        description: description || "",
        status: status || "open"
      }
    });
    res.status(201).json({ id: r.id });
  } catch (e) { next(e); }
});

export default casesRouter;
