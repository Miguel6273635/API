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
 * GET /api/ordenes/sap/list?start=YYYY-MM-DD&end=YYYY-MM-DD&mode=eq|range
 * ✅ Supervisor ya NO manda user en query.
 * ✅ Se toma del token: req.user.email / req.user.correo / req.user.preferred_username
 */
router.get("/sap/list", verifyAzureToken, async (req, res) => {
  try {
    const { start, end, mode } = req.query;

    // ✅ correo desde token (prioridad)
    const tokenEmail =
      req.user?.correo ||
      req.user?.email ||
      req.user?.preferred_username ||
      null;

    // ✅ aún permitimos user por query por compatibilidad (si lo usas en otro lado)
    const user = req.query?.user || tokenEmail;

    if (!user) {
      return res.status(400).json({
        error: "Falta user (correo). No se pudo determinar desde el token.",
        detail: { tokenKeys: Object.keys(req.user || {}) },
      });
    }

    const data = await listOrdenesSap({ start, end, user, mode });
    return res.json(data);
  } catch (error) {
    const status = error?.statusCode || error?.response?.status || 500;
    const body = error?.response?.data || error?.message || String(error);
    console.error("[ORDENES][sap/list] error:", body);
    return res.status(status).json({ error: "Error SAP", detail: body });
  }
});

/**
 * GET /api/ordenes/sap/:orderid
 */
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

/**
 * GET /api/ordenes/sap/:orderid/addresses
 * -> regresa results de ToAddresses
 */
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


/**
 * POST /api/ordenes/sap/checkin
 */
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
