import express from "express";
import { verifyAzureToken } from "../middlewares/verifyAzureToken.js";
import {
  getDatosCartaNoMantenimiento,
  marcarNoMantenimientoSap,
} from "../services/cartaNoMantenimiento.service.js";

const router = express.Router();

/**
 * GET /api/carta-no-mantenimiento/datos/:orderid
 * Trae datos base para autollenar el formulario (SIN BD)
 */
router.get("/datos/:orderid", verifyAzureToken, async (req, res) => {
  try {
    const { orderid } = req.params;
    const data = await getDatosCartaNoMantenimiento({
      orderid,
      user: req.user, // lo que te deja verifyAzureToken
    });
    return res.json(data);
  } catch (error) {
    const status = error?.statusCode || error?.response?.status || 500;
    const detail = error?.response?.data || error?.message || String(error);
    return res.status(status).json({ error: "Error carta no mantenimiento", detail });
  }
});

/**
 * POST /api/carta-no-mantenimiento
 * "Guardar" SIN BD: manda status 0011 a SAP y responde OK
 */
router.post("/", verifyAzureToken, async (req, res) => {
  try {
    const result = await marcarNoMantenimientoSap({
      payload: req.body || {},
      user: req.user,
    });
    return res.json(result);
  } catch (error) {
    const status = error?.statusCode || error?.response?.status || 500;
    const detail = error?.response?.data || error?.message || String(error);
    return res.status(status).json({ error: "Error marcar no mantenimiento", detail });
  }
});

export default router;
