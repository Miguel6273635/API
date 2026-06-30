// src/services/operaciones/operacionesSap.service.js
import { executeHttpRequest } from "@sap-cloud-sdk/http-client";
import { SAP_CLIENT, SAP_LANG } from "../../config/env.js";
import { getSapDestination } from "../../sap/destination.js";

const BASE = "/sap/opu/odata/sap/ZCS_GET_WORKORDER_SRV";

// Navegación desde la orden hacia operaciones.
// Si en $metadata aparece otro nombre, cámbialo aquí.
const NAV_FROM_HEADER = "ToOperations";

// Logging
const LOG_OPS = true;
const LOG_RAW_DATA = false;

function safeJson(x) {
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

function odataList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.d?.results)) return data.d.results;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function parseUserStatus(fieldUserStatusRaw) {
  const s = String(fieldUserStatusRaw || "").trim().toUpperCase();

  if (!s) {
    return {
      isFinal: false,
      isPaused: false,
      tokens: [],
    };
  }

  const tokens = s.split(/\s+/).filter(Boolean);

  const isFinal = tokens.includes("FINA");
  const isPaused = tokens.includes("PAUS");

  return {
    isFinal,
    isPaused,
    tokens,
  };
}

/**
 * Normaliza operaciones y agrega Usr02.
 */
function normalizeOps(rows = []) {
  return rows.map((r) => {
    const Activity = String(r.Activity ?? r.Vornr ?? "").trim();

    const SubActivity = String(r.SubActivity ?? r.Uvorn ?? "").trim();

    const Description = String(
      r.Description ?? r.Ltxa1 ?? r.ShortText ?? "",
    ).trim();

    const StandardTextKey = String(
      r.StandardTextKey ?? r.Standardtextkey ?? "",
    ).trim();

    const Usr00 = String(r.Usr00 ?? r.USR00 ?? r.usr00 ?? "").trim();

    const Usr01 = String(r.Usr01 ?? r.USR01 ?? r.usr01 ?? "").trim();

    const Usr02 = String(
      r.Usr02 ??
        r.USR02 ??
        r.usr02 ??
        r["Usr_02"] ??
        r["USR_02"] ??
        r["usr_02"] ??
        "",
    ).trim();

    const fieldUserStatus =
      r.FieldUserStatus ?? r.Fielduserstatus ?? r.FIELDUSERSTATUS ?? "";

    const { isFinal, isPaused, tokens } = parseUserStatus(fieldUserStatus);

    const estatus = isFinal ? "finalizada" : isPaused ? "pausada" : "pendiente";

    return {
      Activity,
      SubActivity,
      Description,
      StandardTextKey,

      DurationNormal: r.DurationNormal ?? r.Dauno ?? null,
      DurationNormalUnit: r.DurationNormalUnit ?? r.Daune ?? null,

      Usr00,
      Usr01,
      Usr02,

      FieldUserStatus: String(fieldUserStatus || "").trim(),
      FieldUserStatusTokens: tokens,
      isFinalizadaSap: isFinal,
      isPausadaSap: isPaused,

      estatus,

      raw: r,
    };
  });
}

function sortOps(ops = []) {
  return [...ops].sort((a, b) => {
    const c0 = String(a.Usr00 || "").localeCompare(String(b.Usr00 || ""));
    if (c0 !== 0) return c0;

    const c1 = String(a.Usr01 || "").localeCompare(String(b.Usr01 || ""));
    if (c1 !== 0) return c1;

    const c2 = String(a.Usr02 || "").localeCompare(String(b.Usr02 || ""));
    if (c2 !== 0) return c2;

    return String(a.Activity || "").localeCompare(String(b.Activity || ""));
  });
}

async function getJson(destination, url, meta = {}) {
  if (LOG_OPS) {
    console.log(
      `\n🟦 [OPS][GET] ${url}\n🟦 [OPS][meta] ${safeJson({
        sapClient: SAP_CLIENT,
        sapLang: SAP_LANG || "ES",
        ...meta,
      })}\n`,
    );
  }

  const resp = await executeHttpRequest(destination, {
    method: "GET",
    url,
    headers: {
      accept: "application/json",
    },
  });

  const data = resp?.data;

  if (LOG_OPS) {
    const rows = odataList(data);

    console.log(
      `🟩 [OPS][OK] filas=${rows.length} ${
        meta?.modo ? `modo=${meta.modo}` : ""
      }`,
    );

    if (rows.length) {
      const first = rows[0] || {};

      console.log(`[OPS][FIRST_KEYS] ${safeJson(Object.keys(first))}`);

      console.log(
        `[OPS][FIRST_Usr02_CANDIDATES] ${safeJson({
          Usr02: first?.Usr02,
          USR02: first?.USR02,
          usr02: first?.usr02,
          Usr_02: first?.["Usr_02"],
          USR_02: first?.["USR_02"],
          usr_02: first?.["usr_02"],
        })}`,
      );

      const pairs = rows.slice(0, 50).map((r) => ({
        Usr00: String(r.Usr00 ?? r.USR00 ?? r.usr00 ?? "").trim(),
        Usr01: String(r.Usr01 ?? r.USR01 ?? r.usr01 ?? "").trim(),
        Usr02: String(
          r.Usr02 ??
            r.USR02 ??
            r.usr02 ??
            r["Usr_02"] ??
            r["USR_02"] ??
            r["usr_02"] ??
            "",
        ).trim(),
        Activity: String(r.Activity ?? r.Vornr ?? "").trim(),
        Desc: String(r.Description ?? r.Ltxa1 ?? r.ShortText ?? "").trim(),
      }));

      const unique = [];
      const seen = new Set();

      for (const p of pairs) {
        const key = `${p.Usr00}||${p.Usr01}||${p.Usr02}`;

        if (!seen.has(key)) {
          seen.add(key);
          unique.push({
            Usr00: p.Usr00,
            Usr01: p.Usr01,
            Usr02: p.Usr02,
          });
        }

        if (unique.length >= 12) break;
      }

      console.log(
        `🟩 [OPS][PREVIEW] combos Usr00/Usr01/Usr02 (máx 12): ${safeJson(
          unique,
        )}`,
      );

      if (LOG_RAW_DATA) {
        console.log(`🟨 [OPS][RAW_DATA] ${safeJson(data)}`);
      }
    }
  }

  return data;
}

export async function fetchOperacionesSap(orderidRaw) {
  const destination = await getSapDestination();
  const orderid = String(orderidRaw || "").trim();

  if (!orderid) return [];

  /**
   * Antes se intentaba:
   * WorkOrderOperationSet?$filter=Orderid eq '...'
   *
   * Pero SAP respondió:
   * "Property Orderid not found in type WorkOrderOperation"
   *
   * Por eso ahora usamos directamente la navegación:
   * WorkOrderHeaderSet('...')/ToOperations
   */
  try {
    const url =
      `${BASE}/WorkOrderHeaderSet('${encodeURIComponent(
        orderid,
      )}')/${NAV_FROM_HEADER}` +
      `?$format=json` +
      `&sap-client=${encodeURIComponent(SAP_CLIENT)}` +
      `&sap-language=${encodeURIComponent(SAP_LANG || "ES")}`;

    const data = await getJson(destination, url, {
      modo: "NAV_FROM_HEADER",
      orderid,
    });

    const rows = odataList(data);
    const ops = sortOps(normalizeOps(rows));

    if (LOG_OPS) {
      console.log(`🟩 [OPS][NORMALIZED] ops=${ops.length} (NAV)`);
    }

    return ops;
  } catch (e) {
    const err = new Error("SAP no devolvió operaciones por navegación.");
    err.statusCode = e?.response?.status || 500;
    err.cause = e;
    err.response = e?.response;

    if (LOG_OPS) {
      const detail = e?.response?.data || e?.message || e;
      console.error(`🟥 [OPS][NAV_FAIL] ${safeJson(detail)}`);
    }

    throw err;
  }
}