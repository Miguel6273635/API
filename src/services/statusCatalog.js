// src/services/statusCatalog.js
import { executeHttpRequest } from "@sap-cloud-sdk/http-client";
import { SAP_CLIENT, SAP_LANG, log } from "../config/env.js";

let STATUS_CACHE = {
  map: {},
  fetchedAt: 0,
  ttlMs: 10 * 60 * 1000,
};

function normalizeCode(code) {
  if (code === null || code === undefined) return "";

  const s = String(code).trim();
  if (!s) return "";

  const n = parseInt(s, 10);
  if (Number.isNaN(n)) return s;

  return String(n).padStart(4, "0");
}

export async function fetchStatusCatalog(destination) {
  const now = Date.now();

  if (
    STATUS_CACHE.fetchedAt &&
    now - STATUS_CACHE.fetchedAt < STATUS_CACHE.ttlMs
  ) {
    return STATUS_CACHE.map;
  }

  const qp = new URLSearchParams();
  qp.set("$filter", "Stsma eq 'CS000001'");
  qp.set("$format", "json");
  qp.set("sap-client", SAP_CLIENT);
  qp.set("sap-language", SAP_LANG);

  const path = `/sap/opu/odata/sap/ZSD_CATALOGOS_SRV/StatusWorkOrderSet?${qp.toString()}`;

  log("GET", destination.url + path);

  const r = await executeHttpRequest(destination, {
    method: "GET",
    url: path,
    headers: {
      Accept: "application/json",
      "sap-terminate": "session",
    },
  });

  const results = r?.data?.d?.results || [];
  const map = {};

  for (const row of results) {
    const code = normalizeCode(row?.Status1);
    const label = String(row?.Status2 || "").trim();

    if (code) map[code] = label;
  }

  STATUS_CACHE = {
    ...STATUS_CACHE,
    map,
    fetchedAt: now,
  };

  return map;
}

export function mapUserstatusToUi(userstatusRaw, catalogMap = {}) {
  const code = normalizeCode(userstatusRaw);

  if (!code) {
    return {
      estatus_code: "",
      userstatus: "",
      estatus_label: "Sin empezar",
      estatus_tipo: "SIN_EMPEZAR",
      canCheckin: true,
      canTBMKY: false,
      canNoMantto: false,
      isFinal: false,
    };
  }

  if (code === "0100") {
    return {
      estatus_code: "0100",
      userstatus: "0100",
      estatus_label: "PENDIENTE",
      estatus_tipo: "NORMAL",
      canCheckin: false,
      canTBMKY: true,
      canNoMantto: true,
      isFinal: false,
    };
  }

  if (code === "0200") {
    return {
      estatus_code: "0200",
      userstatus: "0200",
      estatus_label: "EN PROCESO",
      estatus_tipo: "NORMAL",
      canCheckin: false,
      canTBMKY: true,
      canNoMantto: true,
      isFinal: false,
    };
  }

  if (code === "0300") {
    return {
      estatus_code: "0300",
      userstatus: "0300",
      estatus_label: "FINALIZADA",
      estatus_tipo: "NORMAL",
      canCheckin: false,
      canTBMKY: false,
      canNoMantto: false,
      isFinal: true,
    };
  }

  if (code === "0400") {
    return {
      estatus_code: "0400",
      userstatus: "0400",
      estatus_label: "PENDIENTE DE FIRMA",
      estatus_tipo: "NORMAL",
      canCheckin: false,
      canTBMKY: false,
      canNoMantto: false,
      isFinal: false,
    };
  }

  if (code === "0600") {
    return {
      estatus_code: "0600",
      userstatus: "0600",
      estatus_label: "Carta No Mantto",
      estatus_tipo: "NO_MANTENIMIENTO",
      canCheckin: false,
      canTBMKY: false,
      canNoMantto: false,
      isFinal: true,
    };
  }

  return {
    estatus_code: code,
    userstatus: code,
    estatus_label: catalogMap?.[code] || `Estatus ${code}`,
    estatus_tipo: "DESCONOCIDO",
    canCheckin: false,
    canTBMKY: false,
    canNoMantto: false,
    isFinal: false,
  };
}
