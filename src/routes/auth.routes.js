// src/routes/auth.routes.js
import express from "express";
import { verifyAzureToken } from "../middlewares/verifyAzureToken.js";

const router = express.Router();

function normalizeRoleNames(roles = []) {
  return roles.map((r) => String(r).trim().toLowerCase());
}

function pickRolIdFromAzureRoles(rawRoles = []) {
  const roles = normalizeRoleNames(rawRoles);
  if (roles.includes("admin") || roles.includes("administrador")) return 1;
  if (roles.includes("supervisor")) return 2;
  return 3;
}

function getCorreoFromAzureClaims(az = {}) {
  return (
    az.preferred_username ||
    az.upn ||
    az.email ||
    (Array.isArray(az.emails) ? az.emails[0] : null) ||
    ""
  );
}

// ✅ MISMA RUTA
router.get("/me", verifyAzureToken, (req, res) => {
  const az = req.azure || {};
  const correo = getCorreoFromAzureClaims(az);
  const nombre = az.name || az.given_name || "Usuario";
  const azureRoles = Array.isArray(az.roles) ? az.roles : [];
  const rol_id = pickRolIdFromAzureRoles(azureRoles);

  return res.json({
    user: {
      id: az.oid || az.sub || correo || "azure-user",
      nombre,
      correo,
      rol_id,
      azure_roles: azureRoles,
      tid: az.tid,
      iss: az.iss,
      aud: az.aud,
    },
  });
});

export default router;
