// src/routes/rutas.routes.js
import express from "express";
import { verifyAzureToken } from "../middlewares/verifyAzureToken.js";
import { getRutasAsignadasSap } from "../services/rutaSap.service.js";

const router = express.Router();

// GET /api/rutas-asignadas?start=YYYY-MM-DD&end=YYYY-MM-DD&mode=eq|range
router.get("/", verifyAzureToken, async (req, res) => {
  try {
    const { start, end, mode = "eq" } = req.query;

    const user =
      req.user?.correo ||
      req.user?.email ||
      req.user?.preferred_username ||
      null;

    if (!user) {
      return res.status(400).json({ error: "No se pudo determinar el correo desde el token." });
    }
    if (!start || !end) {
      return res.status(400).json({ error: "Faltan parámetros start/end (YYYY-MM-DD)" });
    }

    const data = await getRutasAsignadasSap({ start, end, user, mode });
    return res.json(data);
  } catch (error) {
    const status = error?.statusCode || error?.response?.status || 500;
    const detail = error?.response?.data || error?.message || String(error);
    return res.status(status).json({ error: "Error rutas asignadas", detail });
  }
});

export default router;
