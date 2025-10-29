import { Router } from "express";
import { authRequired } from "../middleware/auth.js";
import { prisma } from "../services/db.js";

export const clientsRouter = Router();
clientsRouter.use(authRequired);

// GET /api/clients
clientsRouter.get("/", async (req, res, next) => {
  try {
    const rows = await prisma.client.findMany({
      where: { userId: req.user.id },
      orderBy: { id: "desc" }
    });
    res.json(rows);
  } catch (e) { next(e); }
});

// POST /api/clients  { name, email?, phone? }
clientsRouter.post("/", async (req, res, next) => {
  try {
    const { name, email, phone } = req.body || {};
    if (!name) return res.status(400).json({ error: "name requis" });
    const c = await prisma.client.create({
      data: { userId: req.user.id, name, email, phone }
    });
    res.status(201).json({ id: c.id });
  } catch (e) { next(e); }
});

export default clientsRouter;
