// routes/formularioRiesgos.routes.js
import express from "express";
import { verifyAzureToken } from "../middlewares/verifyAzureToken.js";
import {
  setStatusEnProceso,
  attachPdfToWorkOrder,
} from "../services/tbmkySap.service.js";

const router = express.Router();

/**
 * POST /api/formulario-riesgos/submit
 * Recibe:
 *  - orderId (string)
 *  - pdfBase64 (string base64 del PDF, SIN data:... prefijo)
 *  - fileName (opcional)
 *
 * ✅ Blindado: acepta llaves alternativas por compatibilidad:
 *  - orderid / Orderid
 *  - base64Pdf / Base64
 */
router.post("/submit", verifyAzureToken, async (req, res) => {
  try {
    // ✅ Toma el orderId aunque venga con otra llave
    const orderIdRaw =
      req.body?.orderId ?? req.body?.orderid ?? req.body?.Orderid ?? null;

    // ✅ Toma el base64 aunque venga con otra llave
    const pdfBase64Raw =
      req.body?.pdfBase64 ?? req.body?.base64Pdf ?? req.body?.Base64 ?? null;

    const fileNameRaw = req.body?.fileName ?? null;

    const orderId = String(orderIdRaw || "").trim();
    const pdfBase64 = String(pdfBase64Raw || "").trim();
    const fileName = String(fileNameRaw || `TBMKY_${orderId}.pdf`).trim();

    if (!orderId) return res.status(400).json({ error: "Falta orderId" });
    if (!pdfBase64) return res.status(400).json({ error: "Falta pdfBase64" });

    // (Opcional) logs para debug
    // console.log("[TBMKY] orderId:", orderId);
    // console.log("[TBMKY] pdfBase64 length:", pdfBase64.length);
    // console.log("[TBMKY] fileName:", fileName);

    // 1) Cambiar estatus a 0200 (inactiva 0100)
    const rStatus = await setStatusEnProceso({ orderId });

    // 2) Adjuntar PDF base64
    const rAttach = await attachPdfToWorkOrder({
      orderId,
      pdfBase64,
      fileName,
    });

    return res.json({
      ok: true,
      orderId,
      statusChange: rStatus?.data || null,
      attachment: rAttach?.data || null,
    });
  } catch (error) {
    const status = error?.statusCode || error?.response?.status || 500;
    const body = error?.response?.data || error?.message || String(error);
    return res.status(status).json({ error: "Error TBM/KY", detail: body });
  }
});

export default router;
