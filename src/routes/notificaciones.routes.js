// src/routes/notificaciones.routes.js

import express from "express";
import { verifyAzureToken } from "../middlewares/verifyAzureToken.js";
import {
  upsertPushTokenForUser,
  getPushUserByEmail,
  dumpPushStore,
} from "../store/pushTokens.store.js";
import {
  isValidExpoPushToken,
  sendTestPushToUser,
} from "../services/notificacionesPush.service.js";

const router = express.Router();

function pickCorreoFromReq(req) {
  return (
    req?.user?.correo ||
    req?.user?.email ||
    req?.user?.preferred_username ||
    null
  );
}

function pickNombreFromReq(req) {
  return req?.user?.name || null;
}

function pickRolIdFromReq(req) {
  const roles = Array.isArray(req?.user?.roles) ? req.user.roles : [];
  const normalized = roles.map((r) => String(r).trim().toLowerCase());

  if (normalized.includes("admin") || normalized.includes("administrador")) {
    return 1;
  }
  if (normalized.includes("supervisor")) {
    return 2;
  }
  return 3;
}

/**
 * POST /api/notificaciones/register-token
 * Body:
 * {
 *   expoPushToken: "ExponentPushToken[...]",
 *   platform: "android" | "ios",
 *   app: "melmex-qas"
 * }
 */
router.post("/register-token", verifyAzureToken, async (req, res) => {
  try {
    const email = pickCorreoFromReq(req);
    const name = pickNombreFromReq(req);
    const rol_id = pickRolIdFromReq(req);
    const azureRoles = Array.isArray(req?.user?.roles) ? req.user.roles : [];

    const expoPushToken = String(req.body?.expoPushToken || "").trim();
    const platform = String(req.body?.platform || "").trim() || null;
    const app = String(req.body?.app || "").trim() || null;

    if (!email) {
      return res.status(400).json({
        ok: false,
        error: "No se pudo determinar el correo desde el token",
      });
    }

    if (!expoPushToken) {
      return res.status(400).json({
        ok: false,
        error: "Falta expoPushToken",
      });
    }

    if (!isValidExpoPushToken(expoPushToken)) {
      return res.status(400).json({
        ok: false,
        error: "expoPushToken inválido",
      });
    }

    const saved = upsertPushTokenForUser({
      email,
      name,
      rol_id,
      azureRoles,
      expoPushToken,
      platform,
      app,
    });

    return res.json({
      ok: true,
      message: "Push token registrado",
      user: {
        email: saved.email,
        name: saved.name,
        rol_id: saved.rol_id,
        totalTokens: Array.isArray(saved.tokens) ? saved.tokens.length : 0,
      },
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Error registrando push token",
      detail: error?.message || String(error),
    });
  }
});

/**
 * POST /api/notificaciones/test-me
 * Manda una notificación de prueba al usuario autenticado
 */
router.post("/test-me", verifyAzureToken, async (req, res) => {
  try {
    const email = pickCorreoFromReq(req);
    const name = pickNombreFromReq(req);

    if (!email) {
      return res.status(400).json({
        ok: false,
        error: "No se pudo determinar el correo desde el token",
      });
    }

    const result = await sendTestPushToUser({ email, name });

    return res.json({
      ok: true,
      email,
      result,
    });
  } catch (error) {
    const status = error?.statusCode || 500;
    return res.status(status).json({
      ok: false,
      error: "Error enviando push de prueba",
      detail: error?.payload || error?.message || String(error),
    });
  }
});

/**
 * GET /api/notificaciones/me
 * Ver cómo quedó registrado el usuario actual
 */
router.get("/me", verifyAzureToken, async (req, res) => {
  try {
    const email = pickCorreoFromReq(req);
    if (!email) {
      return res.status(400).json({
        ok: false,
        error: "No se pudo determinar el correo desde el token",
      });
    }

    const user = getPushUserByEmail(email);

    return res.json({
      ok: true,
      email,
      registered: !!user,
      user,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Error consultando registro push",
      detail: error?.message || String(error),
    });
  }
});

/**
 * GET /api/notificaciones/debug/all
 * Solo para depurar internamente
 */
router.get("/debug/all", verifyAzureToken, async (_req, res) => {
  try {
    return res.json({
      ok: true,
      ...dumpPushStore(),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Error dump push store",
      detail: error?.message || String(error),
    });
  }
});

export default router;