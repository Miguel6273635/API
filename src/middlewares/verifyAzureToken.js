// src/middlewares/verifyAzureToken.js
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import {
  AZURE_CLIENT_ID,
  AZURE_TENANT_ID,
  AZURE_EXPECTED_SCOPE,
  log,
} from "../config/env.js";

/**
 * Verifica Access Token de Azure AD (v2 endpoints).
 * ✅ Soporta aud:
 *   - "<CLIENT_ID>"
 *   - "api://<CLIENT_ID>"
 *   - "api://<CLIENT_ID>/access_as_user"
 *   - y cualquier "api://<CLIENT_ID>/*"
 */
export function verifyAzureToken(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) return res.status(401).json({ error: "Token ausente" });

  if (!AZURE_TENANT_ID || !AZURE_CLIENT_ID) {
    return res.status(500).json({
      error: "Faltan AZURE_TENANT_ID/AZURE_CLIENT_ID en variables de entorno",
      detail: {
        AZURE_TENANT_ID: AZURE_TENANT_ID ? "OK" : "MISSING",
        AZURE_CLIENT_ID: AZURE_CLIENT_ID ? "OK" : "MISSING",
      },
    });
  }

  // ✅ Llaves públicas de Azure
  const client = jwksClient({
    jwksUri: `https://login.microsoftonline.com/${AZURE_TENANT_ID}/discovery/v2.0/keys`,
    cache: true,
    cacheMaxEntries: 10,
    cacheMaxAge: 10 * 60 * 1000,
    rateLimit: true,
    jwksRequestsPerMinute: 10,
  });

  function getKey(header, callback) {
    client.getSigningKey(header.kid, (err, key) => {
      if (err) return callback(err);
      callback(null, key.getPublicKey());
    });
  }

  // ✅ issuer válidos (Azure a veces varía)
  const validIssuers = new Set([
    `https://login.microsoftonline.com/${AZURE_TENANT_ID}/v2.0`,
    `https://login.microsoftonline.com/${AZURE_TENANT_ID}/`,
    `https://sts.windows.net/${AZURE_TENANT_ID}/`,
  ]);

  // ✅ audiencia válida
  const exactAudiences = new Set([
    AZURE_CLIENT_ID,
    `api://${AZURE_CLIENT_ID}`,
    `api://${AZURE_CLIENT_ID}/access_as_user`,
  ]);

  const audOk = (aud) => {
    if (!aud) return false;
    const list = Array.isArray(aud) ? aud : [aud];

    return list.some((a) => {
      if (exactAudiences.has(a)) return true;
      // ✅ acepta "api://<clientId>/*" (por si el token trae algo como api://id/scope)
      if (typeof a === "string" && a.startsWith(`api://${AZURE_CLIENT_ID}/`)) return true;
      return false;
    });
  };

  jwt.verify(token, getKey, { algorithms: ["RS256"] }, (err, decoded) => {
    if (err) {
      log("[AZURE VERIFY] signature/format invalid:", err.message);
      return res.status(401).json({
        error: "Token Azure inválido",
        detail: err.message,
      });
    }

    // ==== logs útiles (sin token) ====
    try {
      console.log("[AZURE] tid:", decoded?.tid);
      console.log("[AZURE] iss:", decoded?.iss);
      console.log("[AZURE] aud:", decoded?.aud);
      console.log("[AZURE] scp:", decoded?.scp);
      console.log("[AZURE] roles:", decoded?.roles);
      console.log("[AZURE] preferred_username:", decoded?.preferred_username);
    } catch {}

    // ==== tenant ====
    const tid = decoded?.tid;
    if (!tid || tid !== AZURE_TENANT_ID) {
      return res.status(401).json({
        error: "Token Azure inválido",
        detail: `tenant invalid. tid=${tid} expected=${AZURE_TENANT_ID}`,
      });
    }

    // ==== issuer ====
    const iss = decoded?.iss;
    if (iss && !validIssuers.has(iss)) {
      return res.status(401).json({
        error: "Token Azure inválido",
        detail: `jwt issuer invalid. iss=${iss} expected=${JSON.stringify(
          Array.from(validIssuers)
        )}`,
      });
    }

    // ==== audience ====
    const aud = decoded?.aud;
    if (!audOk(aud)) {
      return res.status(401).json({
        error: "Token Azure inválido",
        detail: `jwt audience invalid. aud=${JSON.stringify(aud)} expected=${JSON.stringify(
          Array.from(exactAudiences)
        )} or api://${AZURE_CLIENT_ID}/*`,
      });
    }

    // ==== (opcional) scope requerido ====
    // Si defines AZURE_EXPECTED_SCOPE="access_as_user" (solo el nombre),
    // el token trae scp="access_as_user ..." (para tokens delegated)
    if (AZURE_EXPECTED_SCOPE) {
      const scp = String(decoded?.scp || "");
      const scopes = scp.split(" ").filter(Boolean);

      if (!scopes.includes(AZURE_EXPECTED_SCOPE)) {
        return res.status(403).json({
          error: "Scope insuficiente",
          detail: { scp, required: AZURE_EXPECTED_SCOPE },
        });
      }
    }

    // ✅ dejamos todo como ya lo usabas
    req.azure = decoded;

    // ✅ user para tus rutas
    const email =
      decoded?.preferred_username ||
      decoded?.email ||
      decoded?.upn ||
      decoded?.unique_name ||
      (Array.isArray(decoded?.emails) ? decoded.emails[0] : null) ||
      null;

    req.user = {
      correo: email,
      email,
      preferred_username: decoded?.preferred_username || null,
      name: decoded?.name || null,
      oid: decoded?.oid || null,
      tid: decoded?.tid || null,
      iss: decoded?.iss || null,
      aud: decoded?.aud || null,
      scp: decoded?.scp || null,
      roles: decoded?.roles || [],
    };

    next();
  });
}
