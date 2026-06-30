// src/sap/csrf.js
import { executeHttpRequest } from "@sap-cloud-sdk/http-client";
import { SAP_CLIENT, SAP_LANG, log } from "../config/env.js";

/**
 * ✅ Compatible:
 * - fetchCsrfAndCookies(destination, "ZCS_CHANGE_WORKORDER_SRV")  (como hoy)
 * - fetchCsrfAndCookies(destination, "/sap/opu/odata/sap/ZCS_CHANGE_WORKORDER_SRV/?sap-client=400&sap-language=ES")
 */
export async function fetchCsrfAndCookies(destination, serviceNameOrPath) {
  if (!destination?.url) {
    throw new Error(
      "Destination inválida: falta destination.url (revisa DEST_NAME y bindings)."
    );
  }
  if (!serviceNameOrPath) throw new Error("serviceName requerido para CSRF.");

  // ✅ Si ya viene un path completo (/sap/opu/odata/...), lo usamos tal cual
  const isFullPath =
    typeof serviceNameOrPath === "string" &&
    serviceNameOrPath.trim().startsWith("/sap/opu/odata/");

  let path;

  if (isFullPath) {
    // ✅ Respetamos EXACTO el path que nos mandan (incluye sap-client/lang)
    path = serviceNameOrPath.trim();
  } else {
    // ✅ Modo antiguo: construir desde el serviceName (como ya lo hacías)
    const serviceName = serviceNameOrPath;

    const basePath = `/sap/opu/odata/sap/${encodeURIComponent(serviceName)}/`;
    const qp = new URLSearchParams();
    qp.set("sap-client", SAP_CLIENT);
    qp.set("sap-language", SAP_LANG || "ES");
    qp.set("$format", "json");

    path = basePath + "?" + qp.toString();
  }

  log("GET (CSRF)", destination.url + path);

  const r = await executeHttpRequest(destination, {
    method: "GET",
    url: path,
    headers: { "X-CSRF-Token": "Fetch", Accept: "application/json" },
  });

  // ✅ Headers pueden venir con diferente casing
  const h = r?.headers || {};
  const csrfToken = h["x-csrf-token"] || h["X-CSRF-Token"];

  const setCookie = h["set-cookie"] || h["Set-Cookie"];
  const cookies = Array.isArray(setCookie)
    ? setCookie.map((c) => c.split(";")[0]).join("; ")
    : (setCookie || "");

  if (!csrfToken) throw new Error("No se pudo obtener X-CSRF-Token de SAP.");
  if (!cookies) throw new Error("No se pudieron obtener cookies (set-cookie) de SAP.");

  return { csrfToken, cookies };
}

export async function forwardWrite({
  destination,
  method,
  path,
  body,
  csrfToken,
  cookies,
  contentType,
}) {
  if (!destination?.url) throw new Error("Destination inválida en forwardWrite (falta url).");

  const headers = {
    "X-CSRF-Token": csrfToken,
    Cookie: cookies,
    Accept: "application/json",
    "Content-Type": contentType || "application/json",
    // ✅ a veces ayuda en Gateway (no rompe nada si no lo usa)
    "X-Requested-With": "XMLHttpRequest",
  };

  log(method, destination.url + path);

  return executeHttpRequest(destination, {
    method,
    url: path,
    headers,
    data: body,
  });
}
