// src/sap/csrf.js
import { executeHttpRequest } from "@sap-cloud-sdk/http-client";
import { SAP_CLIENT, SAP_LANG, log } from "../config/env.js";

/**
 * Obtiene un token CSRF y las cookies de la sesión temporal de SAP.
 *
 * Importante: esta petición NO termina la sesión porque las cookies se
 * reutilizan inmediatamente en la escritura posterior.
 */
export async function fetchCsrfAndCookies(destination, serviceNameOrPath) {
  if (!destination?.url) {
    throw new Error(
      "Destination inválida: falta destination.url (revisa DEST_NAME y bindings)."
    );
  }
  if (!serviceNameOrPath) throw new Error("serviceName requerido para CSRF.");

  const isFullPath =
    typeof serviceNameOrPath === "string" &&
    serviceNameOrPath.trim().startsWith("/sap/opu/odata/");

  let path;

  if (isFullPath) {
    path = serviceNameOrPath.trim();
  } else {
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
    headers: {
      "X-CSRF-Token": "Fetch",
      Accept: "application/json",
    },
  });

  const h = r?.headers || {};
  const csrfToken = h["x-csrf-token"] || h["X-CSRF-Token"];
  const setCookie = h["set-cookie"] || h["Set-Cookie"];
  const cookies = Array.isArray(setCookie)
    ? setCookie.map((c) => c.split(";")[0]).join("; ")
    : setCookie || "";

  if (!csrfToken) throw new Error("No se pudo obtener X-CSRF-Token de SAP.");
  if (!cookies) throw new Error("No se pudieron obtener cookies (set-cookie) de SAP.");

  return { csrfToken, cookies };
}

/**
 * Reenvía una escritura a SAP.
 *
 * Por defecto marca esta petición como la última de la sesión mediante
 * `sap-terminate: session`. SAP Gateway elimina la sesión ICF/soft-state al
 * finalizar la petición, en lugar de conservarla hasta el timeout de SM05.
 *
 * En flujos de varias escrituras con el mismo CSRF se puede usar
 * terminateSession=false en las escrituras intermedias y dejar true en la
 * última.
 */
export async function forwardWrite({
  destination,
  method,
  path,
  body,
  csrfToken,
  cookies,
  contentType,
  terminateSession = true,
}) {
  if (!destination?.url) {
    throw new Error("Destination inválida en forwardWrite (falta url).");
  }

  const headers = {
    "X-CSRF-Token": csrfToken,
    Cookie: cookies,
    Accept: "application/json",
    "Content-Type": contentType || "application/json",
    "X-Requested-With": "XMLHttpRequest",
  };

  if (terminateSession) {
    headers["sap-terminate"] = "session";
  }

  log(method, destination.url + path);

  return executeHttpRequest(destination, {
    method,
    url: path,
    headers,
    data: body,
  });
}
