// services/avisoAveriaSap.service.js
import { getDestination } from "@sap-cloud-sdk/connectivity";
import { executeHttpRequest } from "@sap-cloud-sdk/http-client";
import { DEST_NAME, SAP_CLIENT, SAP_LANG } from "../config/env.js";
import { fetchCsrfAndCookies, forwardWrite } from "../sap/csrf.js";

const SRV_META = "ZCS_GET_WORKORDER_SRV";
const SRV_CAT = "ZSD_CATALOGOS_SRV";
const SRV_CREATE = "ZCS_CREATE_NOTIFICATION_SRV";

// --------------------- helpers ---------------------
function qp(extra = {}) {
  const p = new URLSearchParams();
  p.set("sap-client", SAP_CLIENT);
  p.set("sap-language", SAP_LANG || "ES");
  Object.entries(extra).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  });
  return p.toString();
}

function sapDateToISO(val) {
  if (!val) return null;
  if (typeof val === "string" && val.startsWith("/Date(")) {
    const ms = parseInt(val.replace("/Date(", "").replace(")/", ""), 10);
    if (!Number.isNaN(ms)) return new Date(ms).toISOString();
    return null;
  }
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function extractNotifNoFromText(text) {
  if (!text) return null;
  const m = String(text).match(/\d{6,}/g);
  if (!m?.length) return null;
  return m.sort((a, b) => b.length - a.length)[0];
}

function pickFromReturnResults(retResults = []) {
  if (!Array.isArray(retResults) || !retResults.length) {
    return { notifNo: null, sapMessage: null };
  }
  const success = retResults.filter(
    (r) => String(r?.Type || "").toUpperCase() === "S"
  );
  const pool = success.length ? success : retResults;

  const sapMessage =
    pool.find((r) => r?.Message)?.Message ||
    retResults.find((r) => r?.Message)?.Message ||
    null;

  const joined = pool.map((r) => String(r?.Message || "")).join(" | ");
  const notifNo = extractNotifNoFromText(joined);

  return { notifNo, sapMessage };
}

// --------------------- 1) META ---------------------
export async function obtenerMetaAvisoAveria({ orderid }) {
  const d = await getDestination({ destinationName: DEST_NAME });
  if (!d) {
    const e = new Error(`Destination "${DEST_NAME}" no encontrado`);
    e.statusCode = 404;
    throw e;
  }

  const headerUrl =
    `/sap/opu/odata/sap/${SRV_META}/WorkOrderHeaderSet('${encodeURIComponent(
      orderid
    )}')?${qp({ $format: "json" })}`;

  const hdr = await executeHttpRequest(d, {
    method: "GET",
    url: headerUrl,
    headers: { Accept: "application/json" },
  });

  const h = hdr?.data?.d ?? hdr?.data;
  if (!h?.Orderid) {
    const e = new Error("Orden no encontrada en SAP");
    e.statusCode = 404;
    throw e;
  }

  // operaciones -> PersNo (ya NO es obligatorio, pero lo seguimos devolviendo como meta)
  let reportedByPersNo = null;

  const opsUrl =
    `/sap/opu/odata/sap/${SRV_META}/WorkOrderHeaderSet('${encodeURIComponent(
      orderid
    )}')/ToOperations?${qp({ $format: "json" })}`;

  try {
    const ops = await executeHttpRequest(d, {
      method: "GET",
      url: opsUrl,
      headers: { Accept: "application/json" },
    });

    const results = ops?.data?.d?.results ?? ops?.data?.value ?? [];
    const opConPersona =
      (Array.isArray(results) &&
        results.find(
          (op) =>
            op?.PersNo &&
            String(op.PersNo).trim() !== "" &&
            String(op.PersNo).trim() !== "00000000"
        )) ||
      null;

    if (opConPersona) {
      reportedByPersNo = String(opConPersona.PersNo || "").replace(/^0+/, "");
    } else {
      const firstOp = Array.isArray(results) && results.length ? results[0] : null;
      reportedByPersNo = firstOp?.PersNo
        ? String(firstOp.PersNo).replace(/^0+/, "")
        : null;
    }
  } catch {
    // no rompemos, solo regresa null
  }

  return {
    Orderid: h.Orderid,
    Equipment: h.Equipment,
    DocNumber: h.SalesOrd,
    ItmNumber: h.SOrdItem,
    ShortTextDefault: h.ShortText || h.SalesOrd || "",
    StartDateISO: sapDateToISO(h.StartDate),
    ReportedByPersNo: reportedByPersNo, // informativo
  };
}

// --------------------- 2) CATALOGO ---------------------
export async function listarCircunstanciaPorCatalogo({ catalogo }) {
  const d = await getDestination({ destinationName: DEST_NAME });
  if (!d) {
    const e = new Error(`Destination "${DEST_NAME}" no encontrado`);
    e.statusCode = 404;
    throw e;
  }

  const url =
    `/sap/opu/odata/sap/${SRV_CAT}/CircunstanciaSet?${qp({
      $filter: `Catalogo eq '${catalogo}'`,
      $format: "json",
    })}`;

  const r = await executeHttpRequest(d, {
    method: "GET",
    url,
    headers: { Accept: "application/json" },
  });

  const results = r?.data?.d?.results ?? r?.data?.value ?? [];
  return results.map((x) => ({
    Catalogo: x.Catalogo,
    GrupoCodigo: x.GrupoCodigo,
    Codigo: x.Codigo,
    Descripcion: x.Descripcion,
  }));
}

// --------------------- 3) CREAR AVISO ---------------------
export async function crearAvisoAveriaSap(payloadIn) {
  const d = await getDestination({ destinationName: DEST_NAME });
  if (!d) {
    const e = new Error(`Destination "${DEST_NAME}" no encontrado`);
    e.statusCode = 404;
    throw e;
  }

  const {
    equipment,
    docNumber,
    itmNumber,
    shortText,
    itemDescript,
    causaText,
    piezaDescripcion,
    piezaCircList,
    lugarCirc,
    causasCirc,

    // ✅ NUEVO
    email,

    // ✅ AQUI ESTABA EL PROBLEMA: NO LO LEIAS
    Attachments,
  } = payloadIn || {};

  // Validaciones mínimas
  if (!equipment || !docNumber || !itmNumber) {
    const e = new Error("Faltan equipment/docNumber/itmNumber");
    e.statusCode = 400;
    throw e;
  }

  if (!String(shortText || "").trim()) {
    const e = new Error("ShortText es obligatorio");
    e.statusCode = 400;
    throw e;
  }
  if (!String(itemDescript || "").trim()) {
    const e = new Error("itemDescript (Descript) es obligatorio");
    e.statusCode = 400;
    throw e;
  }
  if (!String(causaText || "").trim()) {
    const e = new Error("causaText (Causetext) es obligatorio");
    e.statusCode = 400;
    throw e;
  }
  if (!String(piezaDescripcion || "").trim()) {
    const e = new Error("piezaDescripcion es obligatoria (NotificationTextSet.TextLine)");
    e.statusCode = 400;
    throw e;
  }
  if (!Array.isArray(piezaCircList) || !piezaCircList.length) {
    const e = new Error("Selecciona al menos 1 daño (R)");
    e.statusCode = 400;
    throw e;
  }
  if (!lugarCirc?.Codigo) {
    const e = new Error("Selecciona 1 localización (S)");
    e.statusCode = 400;
    throw e;
  }
  if (!Array.isArray(causasCirc) || !causasCirc.length) {
    const e = new Error("Selecciona al menos 1 causa (T)");
    e.statusCode = 400;
    throw e;
  }

  if (!String(email || "").trim()) {
    const e = new Error("email es obligatorio para Refobjectkey");
    e.statusCode = 400;
    throw e;
  }

  // Header
  const notifHeader = {
    Equipment: String(equipment).trim(),
    ShortText: String(shortText).trim(),
    Refobjectkey: String(email).trim(),

    // si tu servicio los usa, déjalos
    DocNumber: String(docNumber).trim(),
    ItmNumber: String(itmNumber).trim(),
  };

  const lugarGrp = lugarCirc?.GrupoCodigo || "MANTTO";
  const lugarCod = lugarCirc?.Codigo || "";

  // Items (R)
  const NotificationItemsSet = piezaCircList.map((dmg, idx) => {
    const piezaGrp = dmg?.GrupoCodigo || "MANTTO";
    const piezaCod = dmg?.Codigo || "";
    const key = String(idx + 1).padStart(4, "0");
    return {
      ItemKey: key,
      ItemSortNo: key,
      Descript: String(itemDescript).trim(),
      DCodegrp: String(piezaGrp),
      DCode: String(piezaCod),
      DlCodegrp: String(lugarGrp),
      DlCode: String(lugarCod),
    };
  });

  // Causes (T)
  const NotificationCausesSet = causasCirc.map((c, idx) => {
    const causaGrp = c?.GrupoCodigo || "MANTTO";
    const causaCod = c?.Codigo || "";
    const key = String(idx + 1).padStart(4, "0");
    return {
      ItemKey: "0001",
      ItemSortNo: "0001",
      CauseKey: key,
      CauseSortNo: key,
      CauseCodegrp: String(causaGrp),
      CauseCode: String(causaCod),
      Causetext: String(causaText).trim(),
    };
  });

  // NotificationTextSet
  const NotificationTextSet = [
    { Objtype: "QMEL", FormatCol: ">X", TextLine: String(piezaDescripcion).trim() },
  ];

  // ✅ Attachments: map a lo que SAP espera
  // OJO: tú dijiste que SAP lo quiere como:
  // MimeType: "png" (no "image/png")
  // y DocId vacío (" ")
  let AttachmentsOut = [];
  if (Array.isArray(Attachments) && Attachments.length) {
    AttachmentsOut = Attachments
      .filter((a) => a && String(a.Base64 || "").trim())
      .map((a) => {
        const fileName = String(a.FileName || "imagen.png").trim();

        // MimeType como "png" / "jpg" según el nombre (por tu especificación)
        const ext = (fileName.split(".").pop() || "png").toLowerCase();

        return {
          DocId: " ",
          FileName: fileName,
          MimeType: ext, // ✅ "png" o "jpg"
          Base64: String(a.Base64).trim(), // ✅ base64 puro, sin "data:image/..."
        };
      });
  }

  // Debug (temporal)
  console.log("[AVISO-CREATE] attachments in:", Array.isArray(Attachments) ? Attachments.length : 0);
  console.log("[AVISO-CREATE] attachments out:", AttachmentsOut.length);
  console.log("[AVISO-CREATE] base64 length:", AttachmentsOut?.[0]?.Base64?.length);

  const body = {
    NotifType: "S1",
    NotifHeader: notifHeader,
    NotificationItemsSet,
    NotificationCausesSet,
    NotificationTextSet,

    // ✅ AQUI VA
    Attachments: AttachmentsOut,

    Return: [],
  };

  const { csrfToken, cookies } = await fetchCsrfAndCookies(d, SRV_CREATE);

  const postPath = `/sap/opu/odata/sap/${SRV_CREATE}/NotificationHeaderSet?${qp()}`;

  const resp = await forwardWrite({
    destination: d,
    method: "POST",
    path: postPath,
    body,
    csrfToken,
    cookies,
    contentType: "application/json",
  });

  const dPost = resp?.data?.d ?? resp?.data;

  const retResults = dPost?.Return?.results || dPost?.Return?.Results || [];
  const { notifNo, sapMessage } = pickFromReturnResults(retResults);

  return {
    ok: true,
    notifNo,
    sapMessage:
      sapMessage ||
      (notifNo ? `Notificación creada: ${notifNo}` : "Aviso creado (sin número en respuesta)"),
    raw: dPost,
  };
}
