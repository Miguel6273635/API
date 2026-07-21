// src/routes/ordenes.routes.js
import express from "express";
import { verifyAzureToken } from "../middlewares/verifyAzureToken.js";
import {
  listOrdenesSap,
  checkinOrdenSap,
  getOrdenSapById,
  getOrdenAddressesSap,
} from "../services/ordersSap.service.js";

const router = express.Router();

/**
 * GET /api/ordenes/sap/list
 * Query:
 * - start=YYYY-MM-DD
 * - end=YYYY-MM-DD
 * - mode=eq|range
 * - enterDate=YYYY-MM-DD (opcional)
 *
 * El correo se toma prioritariamente del token Azure. Cuando EnterDate no es
 * filtrable todavía en SAP, el servicio reintenta sin esa condición y aplica
 * el filtro localmente como compatibilidad temporal.
 */
router.get("/sap/list", verifyAzureToken, async (req, res) => {
  try {
    const { start, end, mode } = req.query;
    const enterDate = req.query?.enterDate || req.query?.enter_date || null;

    const tokenEmail =
      req.user?.correo ||
      req.user?.email ||
      req.user?.preferred_username ||
      null;

    const user = req.query?.user || tokenEmail;

    if (!user) {
      return res.status(400).json({
        error: "Falta user (correo). No se pudo determinar desde el token.",
        detail: { tokenKeys: Object.keys(req.user || {}) },
      });
    }

    const data = await listOrdenesSap({
      start,
      end,
      user,
      mode,
      enterDate,
    });

    return res.json(data);
  } catch (error) {
    const status = error?.statusCode || error?.response?.status || 500;
    const body = error?.response?.data || error?.message || String(error);
    console.error("[ORDENES][sap/list] error:", body);
    return res.status(status).json({ error: "Error SAP", detail: body });
  }
});

router.get("/sap/:orderid", verifyAzureToken, async (req, res) => {
  try {
    const { orderid } = req.params;
    const data = await getOrdenSapById(orderid);
    return res.json(data);
  } catch (error) {
    const status = error?.statusCode || error?.response?.status || 500;
    const body = error?.response?.data || error?.message || String(error);
    console.error("[ORDENES][sap/:orderid] error:", body);
    return res.status(status).json({ error: "Error SAP", detail: body });
  }
});

router.get("/sap/:orderid/addresses", verifyAzureToken, async (req, res) => {
  try {
    const { orderid } = req.params;
    const results = await getOrdenAddressesSap(orderid);
    return res.json({ results });
  } catch (error) {
    const status = error?.statusCode || error?.response?.status || 500;
    const body = error?.response?.data || error?.message || String(error);
    console.error("[ORDENES][sap/:orderid/addresses] error:", body);
    return res.status(status).json({ error: "Error SAP", detail: body });
  }
});

router.post("/sap/checkin", verifyAzureToken, async (req, res) => {
  try {
    const data = await checkinOrdenSap(req.body || {});
    return res.json(data);
  } catch (error) {
    const status = error?.statusCode || error?.response?.status || 500;
    const body = error?.response?.data || error?.message || String(error);
    console.error("[ORDENES][sap/checkin] error:", body);
    return res.status(status).json({ error: "Error check-in SAP", detail: body });
  }
});

export default router;
