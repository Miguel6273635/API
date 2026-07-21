// src/services/operaciones/operacionesSap.service.js
import { executeHttpRequest } from "@sap-cloud-sdk/http-client";
import { SAP_CLIENT, SAP_LANG } from "../../config/env.js";
import { getSapDestination } from "../../sap/destination.js";

const BASE = "/sap/opu/odata/sap/ZCS_GET_WORKORDER_SRV";
const NAV_FROM_HEADER = "ToOperations";
const LOG_OPS = true;

function odataList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.d?.results)) return data.d.results;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function parseUserStatus(fieldUserStatusRaw) {
  const value = String(fieldUserStatusRaw || "").trim().toUpperCase();
  const tokens = value ? value.split(/\s+/).filter(Boolean) : [];

  return {
    isFinal: tokens.includes("FINA"),
    isPaused: tokens.includes("PAUS"),
    tokens,
  };
}

function normalizeOps(rows = []) {
  return rows.map((row) => {
    const Activity = String(row.Activity ?? row.Vornr ?? "").trim();
    const SubActivity = String(row.SubActivity ?? row.Uvorn ?? "").trim();
    const Description = String(
      row.Description ?? row.Ltxa1 ?? row.ShortText ?? ""
    ).trim();
    const StandardTextKey = String(
      row.StandardTextKey ?? row.Standardtextkey ?? ""
    ).trim();
    const Usr00 = String(row.Usr00 ?? row.USR00 ?? row.usr00 ?? "").trim();
    const Usr01 = String(row.Usr01 ?? row.USR01 ?? row.usr01 ?? "").trim();
    const Usr02 = String(
      row.Usr02 ??
        row.USR02 ??
        row.usr02 ??
        row["Usr_02"] ??
        row["USR_02"] ??
        row["usr_02"] ??
        ""
    ).trim();

    const fieldUserStatus =
      row.FieldUserStatus ??
      row.Fielduserstatus ??
      row.FIELDUSERSTATUS ??
      "";

    const { isFinal, isPaused, tokens } = parseUserStatus(fieldUserStatus);

    return {
      Activity,
      SubActivity,
      Description,
      StandardTextKey,
      DurationNormal: row.DurationNormal ?? row.Dauno ?? null,
      DurationNormalUnit: row.DurationNormalUnit ?? row.Daune ?? null,
      Usr00,
      Usr01,
      Usr02,
      FieldUserStatus: String(fieldUserStatus || "").trim(),
      FieldUserStatusTokens: tokens,
      isFinalizadaSap: isFinal,
      isPausadaSap: isPaused,
      estatus: isFinal ? "finalizada" : isPaused ? "pausada" : "pendiente",
      raw: row,
    };
  });
}

function sortOps(operations = []) {
  return [...operations].sort((a, b) => {
    const byUsr00 = String(a.Usr00 || "").localeCompare(String(b.Usr00 || ""));
    if (byUsr00 !== 0) return byUsr00;

    const byUsr01 = String(a.Usr01 || "").localeCompare(String(b.Usr01 || ""));
    if (byUsr01 !== 0) return byUsr01;

    const byUsr02 = String(a.Usr02 || "").localeCompare(String(b.Usr02 || ""));
    if (byUsr02 !== 0) return byUsr02;

    return String(a.Activity || "").localeCompare(String(b.Activity || ""));
  });
}

async function getJson(destination, url, meta = {}) {
  if (LOG_OPS) {
    console.log("[OPS][GET]", {
      url,
      sapClient: SAP_CLIENT,
      sapLang: SAP_LANG || "ES",
      ...meta,
    });
  }

  const response = await executeHttpRequest(destination, {
    method: "GET",
    url,
    headers: {
      Accept: "application/json",
      "sap-terminate": "session",
    },
  });

  const rows = odataList(response?.data);

  if (LOG_OPS) {
    console.log("[OPS][OK]", {
      orderid: meta?.orderid || null,
      modo: meta?.modo || null,
      filas: rows.length,
    });
  }

  return response?.data;
}

export async function fetchOperacionesSap(orderidRaw) {
  const destination = await getSapDestination();
  const orderid = String(orderidRaw || "").trim();

  if (!orderid) return [];

  try {
    const url =
      `${BASE}/WorkOrderHeaderSet('${encodeURIComponent(
        orderid
      )}')/${NAV_FROM_HEADER}` +
      `?$format=json` +
      `&sap-client=${encodeURIComponent(SAP_CLIENT)}` +
      `&sap-language=${encodeURIComponent(SAP_LANG || "ES")}`;

    const data = await getJson(destination, url, {
      modo: "NAV_FROM_HEADER",
      orderid,
    });

    return sortOps(normalizeOps(odataList(data)));
  } catch (error) {
    const wrapped = new Error("SAP no devolvió operaciones por navegación.");
    wrapped.statusCode = error?.response?.status || 500;
    wrapped.cause = error;
    wrapped.response = error?.response;

    console.error(
      "[OPS][NAV_FAIL]",
      error?.response?.data || error?.message || error
    );

    throw wrapped;
  }
}
