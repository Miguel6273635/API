// src/services/ordersSap.service.js
import { getDestination } from "@sap-cloud-sdk/connectivity";
import { executeHttpRequest } from "@sap-cloud-sdk/http-client";
import { DEST_NAME, SAP_CLIENT, SAP_LANG, log } from "../config/env.js";
import { fetchStatusCatalog, mapUserstatusToUi } from "./statusCatalog.js";
import { fetchCsrfAndCookies, forwardWrite } from "../sap/csrf.js";

/* ====================== Helpers ====================== */
function safeYmd(ymd) {
  const s = String(ymd || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function escapeODataString(value) {
  return String(value || "").replace(/'/g, "''");
}

function sapV2DateToISO(val) {
  if (!val) return null;

  if (typeof val === "string" && val.startsWith("/Date(")) {
    const match = val.match(/\/Date\((-?\d+)/);
    const ms = match ? Number(match[1]) : Number.NaN;
    if (!Number.isNaN(ms)) return new Date(ms).toISOString();
    return null;
  }

  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function sapDateToYmd(val) {
  if (!val) return null;

  const raw = String(val).trim();
  const literalMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (literalMatch) return literalMatch[1];

  const iso = sapV2DateToISO(val);
  return iso ? iso.slice(0, 10) : null;
}

function isEnterDateNotFilterableError(error) {
  const status = error?.statusCode || error?.response?.status;
  const detail = error?.response?.data || error?.message || error;

  let text;
  try {
    text = typeof detail === "string" ? detail : JSON.stringify(detail);
  } catch {
    text = String(detail || "");
  }

  const normalized = text.toLowerCase();
  return (
    status === 400 &&
    normalized.includes("enterdate") &&
    (normalized.includes("filterable") ||
      normalized.includes("not filter") ||
      normalized.includes("no se puede filtrar") ||
      normalized.includes("not allowed"))
  );
}

async function terminateSapSessionBestEffort(destination, serviceName, cookies) {
  try {
    const qp = new URLSearchParams();
    qp.set("sap-client", SAP_CLIENT);
    qp.set("sap-language", SAP_LANG || "ES");

    const path =
      `/sap/opu/odata/sap/${encodeURIComponent(serviceName)}/?` + qp.toString();

    await executeHttpRequest(destination, {
      method: "HEAD",
      url: path,
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
        "sap-terminate": "session",
      },
    });
  } catch (error) {
    console.warn(
      `[SAP][SESSION] No se pudo terminar la sesión de ${serviceName}:`,
      error?.response?.data || error?.message || error
    );
  }
}

async function fetchWorkOrderRows(destination, filter) {
  const qp = new URLSearchParams();
  qp.set("$filter", filter);
  qp.set("$format", "json");
  qp.set("sap-client", SAP_CLIENT);
  qp.set("sap-language", SAP_LANG);

  const path =
    `/sap/opu/odata/sap/ZCS_GET_WORKORDER_SRV/WorkOrderHeaderSet?` +
    qp.toString();

  log("GET", destination.url + path);
  console.log("[ORDENES][LIST] $filter =", filter);

  const response = await executeHttpRequest(destination, {
    method: "GET",
    url: path,
    headers: {
      Accept: "application/json",
      "sap-terminate": "session",
    },
  });

  return response?.data?.d?.results || [];
}

/** ===================== LISTA ÓRDENES ===================== */
export async function listOrdenesSap({
  start,
  end,
  user,
  mode = "range",
  enterDate = null,
}) {
  const s = safeYmd(start);
  const e = safeYmd(end);
  const enter = enterDate ? safeYmd(enterDate) : null;
  const u = String(user || "").trim();

  if (!s || !e || !u) {
    const err = new Error("Faltan parámetros start/end/user (YYYY-MM-DD)");
    err.statusCode = 400;
    throw err;
  }

  if (enterDate && !enter) {
    const err = new Error("enterDate debe tener formato YYYY-MM-DD");
    err.statusCode = 400;
    throw err;
  }

  const d = await getDestination({ destinationName: DEST_NAME });
  if (!d) {
    const err = new Error(`Destination "${DEST_NAME}" no encontrado`);
    err.statusCode = 404;
    throw err;
  }

  const statusMap = await fetchStatusCatalog(d);

  const startDT = `${s}T00:00:00`;
  const endDT = mode === "eq" ? `${s}T23:59:59` : `${e}T23:59:59`;
  const escapedUser = escapeODataString(u);

  const baseFilter =
    `StartDate ge datetime'${startDT}' ` +
    `and FinishDate le datetime'${endDT}' ` +
    `and Userstatus eq '${escapedUser}'`;

  let results;
  let usedLocalEnterDateFallback = false;

  if (enter) {
    const enterStart = `${enter}T00:00:00`;
    const enterEnd = `${enter}T23:59:59`;
    const filterWithEnterDate =
      `${baseFilter} ` +
      `and EnterDate ge datetime'${enterStart}' ` +
      `and EnterDate le datetime'${enterEnd}'`;

    try {
      results = await fetchWorkOrderRows(d, filterWithEnterDate);
    } catch (error) {
      if (!isEnterDateNotFilterableError(error)) throw error;

      usedLocalEnterDateFallback = true;
      console.warn(
        "[ORDENES][LIST] EnterDate no es filtrable en SAP. " +
          "Se reintenta sin EnterDate y se filtra localmente."
      );
      results = await fetchWorkOrderRows(d, baseFilter);
    }

    results = results.filter((wo) => sapDateToYmd(wo?.EnterDate) === enter);
  } else {
    results = await fetchWorkOrderRows(d, baseFilter);
  }

  console.log("[ORDENES][LIST] user =", u);
  console.log("[ORDENES][LIST] mode =", mode);
  console.log("[ORDENES][LIST] enterDate =", enter || "—");
  console.log(
    "[ORDENES][LIST] enterDateFallback =",
    usedLocalEnterDateFallback
  );

  return results.map((wo) => {
    const us = wo?.Userstatus || "";
    const ui = mapUserstatusToUi(us, statusMap);
    const orderid = wo?.Orderid || wo?.OrderId || wo?.Aufnr || "";

    const startISO = sapV2DateToISO(
      wo?.StartDate || wo?.Startdate || wo?.Start_date
    );
    const endISO = sapV2DateToISO(
      wo?.FinishDate || wo?.Finishdate || wo?.Finish_date
    );
    const enterISO = sapV2DateToISO(
      wo?.EnterDate || wo?.Enterdate || wo?.Enter_date
    );

    return {
      Orderid: orderid,
      orderid,
      order_type: wo?.Auart || wo?.OrderType || "",
      nombre_orden: wo?.Auart || wo?.OrderType || "",
      equipment: wo?.Equnr || wo?.Equipment || "",
      start_date: startISO,
      startdate: startISO,
      finish_date: endISO,
      finishdate: endISO,
      enter_date: enterISO,
      enterdate: enterISO,
      partner_name: wo?.PartnerName || wo?.Name1 || "",
      partner_address: wo?.PartnerAddress || wo?.Stras || wo?.Ort01 || "",
      id_mecanico: wo?.IdMecanico || "",
      nombre_mecanico: wo?.NombreMec || "",
      nombre_cliente: wo?.NombreCliente || "",
      userstatus: us,
      ...ui,
    };
  });
}

/** ===================== CHECK-IN ===================== */
export async function checkinOrdenSap({
  orderId,
  base64,
  fileName,
  mimeType,
  docId,
}) {
  if (!orderId) {
    const e = new Error("Falta orderId");
    e.statusCode = 400;
    throw e;
  }

  if (!base64) {
    const e = new Error("Falta base64");
    e.statusCode = 400;
    throw e;
  }

  const safeFileName = String(fileName || "imagen.jpg");
  const safeMimeType = String(mimeType || "image/jpeg");
  const safeDocId = String(docId || "40000118");

  const d = await getDestination({ destinationName: DEST_NAME });
  if (!d) {
    const e = new Error(`Destination "${DEST_NAME}" no encontrado`);
    e.statusCode = 404;
    throw e;
  }

  const serviceName = "ZCS_CHANGE_WORKORDER_SRV";
  const { csrfToken, cookies } = await fetchCsrfAndCookies(d, serviceName);

  const pathWorkOrderSet =
    `/sap/opu/odata/sap/${serviceName}/WorkOrderSet` +
    `?sap-client=${SAP_CLIENT}&sap-language=${SAP_LANG}`;

  const attachPayload = {
    WorkOrderHeader: { Orderid: String(orderId) },
    Attachments: [
      {
        DocId: safeDocId,
        FileName: safeFileName,
        MimeType: safeMimeType,
        Base64: String(base64).trim(),
      },
    ],
    Return: [],
  };

  console.log(
    "[CHECKIN] attachPayload =",
    JSON.stringify(
      {
        ...attachPayload,
        Attachments: attachPayload.Attachments.map((a) => ({
          ...a,
          Base64: `<<base64 omitted: ${String(a.Base64 || "").length} chars>>`,
        })),
      },
      null,
      2
    )
  );

  const statusPayload = {
    OrderId: String(orderId),
    WorkOrderHeader: { Orderid: String(orderId) },
    WorkOrderUserStatusSet: [
      { UserStText: "0100", Langu: "ES", Inactive: "" },
    ],
    Return: [],
  };

  console.log("[CHECKIN] statusPayload =", JSON.stringify(statusPayload, null, 2));

  try {
    const rAttach = await forwardWrite({
      destination: d,
      method: "POST",
      path: pathWorkOrderSet,
      body: attachPayload,
      csrfToken,
      cookies,
      contentType: "application/json",
      terminateSession: false,
    });

    const rStatus = await forwardWrite({
      destination: d,
      method: "POST",
      path: pathWorkOrderSet,
      body: statusPayload,
      csrfToken,
      cookies,
      contentType: "application/json",
      terminateSession: true,
    });

    return {
      ok: true,
      orderId: String(orderId),
      estatus_code: "0100",
      userstatus: "0100",
      estatus_label: "PENDIENTE",
      estatus_tipo: "NORMAL",
      attachment: rAttach?.data || null,
      statusChange: rStatus?.data || null,
    };
  } catch (error) {
    await terminateSapSessionBestEffort(d, serviceName, cookies);
    throw error;
  }
}

/** ===================== DETALLE 1 ORDEN ===================== */
export async function getOrdenSapById(orderidRaw) {
  const orderid = String(orderidRaw || "").trim();
  if (!orderid) {
    const e = new Error("Falta orderid");
    e.statusCode = 400;
    throw e;
  }

  const d = await getDestination({ destinationName: DEST_NAME });
  if (!d) {
    const e = new Error(`Destination "${DEST_NAME}" no encontrado`);
    e.statusCode = 404;
    throw e;
  }

  const statusMap = await fetchStatusCatalog(d);
  const qp = new URLSearchParams();
  qp.set("$format", "json");
  qp.set("sap-client", SAP_CLIENT);
  qp.set("sap-language", SAP_LANG);

  const path = `/sap/opu/odata/sap/ZCS_GET_WORKORDER_SRV/WorkOrderHeaderSet('${encodeURIComponent(
    orderid
  )}')?${qp.toString()}`;

  log("GET", d.url + path);

  const r = await executeHttpRequest(d, {
    method: "GET",
    url: path,
    headers: {
      Accept: "application/json",
      "sap-terminate": "session",
    },
  });

  const wo = r?.data?.d || null;
  if (!wo) {
    const e = new Error(`Orden no encontrada: ${orderid}`);
    e.statusCode = 404;
    throw e;
  }

  const us = wo?.Userstatus || "";
  const ui = mapUserstatusToUi(us, statusMap);
  const startISO = sapV2DateToISO(
    wo?.StartDate || wo?.Startdate || wo?.Start_date
  );
  const endISO = sapV2DateToISO(
    wo?.FinishDate || wo?.Finishdate || wo?.Finish_date
  );
  const enterISO = sapV2DateToISO(
    wo?.EnterDate || wo?.Enterdate || wo?.Enter_date
  );

  return {
    Orderid: wo?.Orderid || wo?.OrderId || wo?.Aufnr || orderid,
    orderid: wo?.Orderid || wo?.OrderId || wo?.Aufnr || orderid,
    order_type: wo?.Auart || wo?.OrderType || "",
    nombre_orden: wo?.Auart || wo?.OrderType || "",
    equipment: wo?.Equnr || wo?.Equipment || "",
    start_date: startISO,
    finish_date: endISO,
    enter_date: enterISO,
    partner_name: wo?.PartnerName || wo?.Name1 || "",
    partner_address: wo?.PartnerAddress || wo?.Stras || wo?.Ort01 || "",
    id_mecanico: wo?.IdMecanico || "",
    nombre_mecanico: wo?.NombreMec || "",
    nombre_cliente: wo?.NombreCliente || "",
    userstatus: us,
    ...ui,
    raw: wo,
  };
}

/** ===================== DIRECCIONES DE 1 ORDEN ===================== */
export async function getOrdenAddressesSap(orderidRaw) {
  const orderid = String(orderidRaw || "").trim();
  if (!orderid) {
    const e = new Error("Falta orderid");
    e.statusCode = 400;
    throw e;
  }

  const d = await getDestination({ destinationName: DEST_NAME });
  if (!d) {
    const e = new Error(`Destination "${DEST_NAME}" no encontrado`);
    e.statusCode = 404;
    throw e;
  }

  const qp = new URLSearchParams();
  qp.set("$format", "json");
  qp.set("sap-client", SAP_CLIENT);
  qp.set("sap-language", SAP_LANG);

  const path =
    `/sap/opu/odata/sap/ZCS_GET_WORKORDER_SRV/` +
    `WorkOrderHeaderSet('${encodeURIComponent(orderid)}')/ToAddresses?${qp.toString()}`;

  log("GET", d.url + path);

  const r = await executeHttpRequest(d, {
    method: "GET",
    url: path,
    headers: {
      Accept: "application/json",
      "sap-terminate": "session",
    },
  });

  return r?.data?.d?.results || [];
}
