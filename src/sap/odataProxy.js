// src/sap/odataProxy.js
import { executeHttpRequest } from "@sap-cloud-sdk/http-client";
import {
  SAP_CLIENT,
  SAP_LANG,
  READ_ONLY_SERVICES,
  WRITE_SERVICES,
  log,
} from "../config/env.js";
import { getSapDestination } from "./destination.js";
import { fetchCsrfAndCookies, forwardWrite } from "./csrf.js";

export function buildQs(obj = {}) {
  const p = new URLSearchParams(obj);
  return p.toString() ? `?${p.toString()}` : "";
}

export function isAllowedService(service) {
  return [...READ_ONLY_SERVICES, ...WRITE_SERVICES].includes(service);
}

export function isWritableService(service) {
  return WRITE_SERVICES.includes(service);
}

export function servicesListPayload() {
  return {
    readOnly: READ_ONLY_SERVICES,
    writable: WRITE_SERVICES,
    readExamples: [
      "/api/odata/ZCS_GET_WORKORDER_SRV",
      "/api/odata/ZCS_GET_WORKORDER_SRV/$metadata",
      "/api/odata/ZCS_GET_WORKORDER_SRV/WorkOrderHeaderSet?$top=5",
      "/api/odata/ZSD_CATALOGOS_SRV/StatusWorkOrderSet?",
      "/api/odata/ZCS_GET_NOTIFICATION_SRV/NotificationHeaderSet?$top=5",
      "/api/odata/ZCS_GET_BOM_MATERIAL_SRV/BomHeaderSet?$top=5",
    ],
    writeExamples: [
      "POST /api/odata/ZCS_CREATE_CONFIRMATION_SRV/ConfirmationHeaderSet",
    ],
  };
}

/**
 * Proxy GET.
 * Cada lectura es independiente, por lo que se solicita a SAP terminar la
 * sesión al concluir la petición. Esto evita acumular sesiones soft-state en
 * SM05 sin desactivar el pooling interno que requiere Cloud Connector.
 */
export async function proxyOdataRead({ service, extraPath = "", query = {} }) {
  if (!isAllowedService(service)) {
    const e = new Error(`Servicio no permitido: ${service}`);
    e.statusCode = 400;
    throw e;
  }

  const d = await getSapDestination();
  if (!d) {
    const e = new Error("Destination no encontrado");
    e.statusCode = 404;
    throw e;
  }

  const isMetadata = String(extraPath || "").endsWith("$metadata");
  let path = `/sap/opu/odata/sap/${encodeURIComponent(service)}/`;

  if (extraPath) {
    const clean = String(extraPath).replace(/^\/+/, "");
    path += clean;
  }

  const headers = {
    "sap-terminate": "session",
  };

  if (isMetadata) {
    headers.Accept = "application/xml";
    const qp = new URLSearchParams();
    qp.set("sap-client", SAP_CLIENT);
    qp.set("sap-language", SAP_LANG);
    path += (path.includes("?") ? "&" : "?") + qp.toString();
  } else {
    const qp = new URLSearchParams(query);
    if (!qp.has("$format")) qp.set("$format", "json");
    if (!qp.has("sap-client")) qp.set("sap-client", SAP_CLIENT);
    if (!qp.has("sap-language")) qp.set("sap-language", SAP_LANG);
    path += (path.includes("?") ? "&" : "?") + qp.toString();
    headers.Accept = "application/json";
  }

  log("GET", d.url + path);

  const r = await executeHttpRequest(d, {
    method: "GET",
    url: path,
    headers,
  });

  return {
    status: r.status || 200,
    data: r.data,
    isMetadata,
  };
}

export async function proxyOdataWrite({
  service,
  extraPath = "",
  query = {},
  verb,
  body,
  contentType,
}) {
  if (!isWritableService(service)) {
    const e = new Error(`Servicio no permitido para escritura: ${service}`);
    e.statusCode = 400;
    e.payload = { allowed: WRITE_SERVICES };
    throw e;
  }

  const d = await getSapDestination();
  if (!d) {
    const e = new Error("Destination no encontrado");
    e.statusCode = 404;
    throw e;
  }

  let path = `/sap/opu/odata/sap/${encodeURIComponent(service)}/`;

  if (extraPath) {
    const clean = String(extraPath).replace(/^\/+/, "");
    path += clean;
  }

  const qp = new URLSearchParams(query);
  if (!qp.has("sap-client")) qp.set("sap-client", SAP_CLIENT);
  if (!qp.has("sap-language")) qp.set("sap-language", SAP_LANG);
  path += (path.includes("?") ? "&" : "?") + qp.toString();

  const { csrfToken, cookies } = await fetchCsrfAndCookies(d, service);

  const ct =
    (contentType || "").includes("application/atom+xml")
      ? "application/atom+xml"
      : "application/json";

  log(`WRITE ${verb}`, d.url + path);

  const r = await forwardWrite({
    destination: d,
    method: verb,
    path,
    body,
    csrfToken,
    cookies,
    contentType: ct,
    terminateSession: true,
  });

  return { status: r.status || 200, data: r.data };
}
