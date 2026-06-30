// routes/avisoAveria.routes.js
import express from "express";
import { verifyAzureToken } from "../middlewares/verifyAzureToken.js";
import {
  obtenerMetaAvisoAveria,
  listarCircunstanciaPorCatalogo,
  crearAvisoAveriaSap,
} from "../services/avisoAveriaSap.service.js";

const router = express.Router();

// GET /api/aviso-averia/meta/:orderid
router.get("/meta/:orderid", verifyAzureToken, async (req, res) => {
  try {
    const orderid = req.params.orderid;
    if (!orderid || orderid === "undefined" || orderid === "null") {
      return res.status(400).json({ error: "Falta orderid" });
    }
    const data = await obtenerMetaAvisoAveria({ orderid });
    return res.json(data);
  } catch (error) {
    const status = error?.statusCode || error?.response?.status || 500;
    const detail = error?.response?.data || error?.message || String(error);
    return res.status(status).json({ error: "Error meta aviso", detail });
  }
});

// GET /api/aviso-averia/catalogos/circunstancia?catalogo=R|S|T|P
router.get("/catalogos/circunstancia", verifyAzureToken, async (req, res) => {
  try {
    const { catalogo } = req.query;
    if (!catalogo) {
      return res.status(400).json({ error: "Debes enviar ?catalogo=P|R|S|T" });
    }
    const data = await listarCircunstanciaPorCatalogo({ catalogo });
    return res.json(data);
  } catch (error) {
    const status = error?.statusCode || error?.response?.status || 500;
    const detail = error?.response?.data || error?.message || String(error);
    return res.status(status).json({ error: "Error catálogo", detail });
  }
});

// POST /api/aviso-averia/create
router.post("/create", verifyAzureToken, async (req, res) => {
  try {
    const emailFromToken =
    req?.user?.email || req?.user?.correo || req?.user?.preferred_username || null;

  const out = await crearAvisoAveriaSap({
    ...req.body,
    email: emailFromToken || req.body?.email,
  });

    return res.json(out);
  } catch (error) {
    const status = error?.statusCode || error?.response?.status || 500;
    const detail = error?.response?.data || error?.message || String(error);
    return res.status(status).json({ ok: false, error: "Error crear aviso", detail });
  }
});

export default router;
