// src/services/cartaNoMantenimiento.service.js
import { getDestination } from "@sap-cloud-sdk/connectivity";
import { executeHttpRequest } from "@sap-cloud-sdk/http-client";
import { DEST_NAME, SAP_CLIENT, SAP_LANG, log } from "../config/env.js";
import { fetchCsrfAndCookies, forwardWrite } from "../sap/csrf.js";

/* ========= Helpers ========= */
function sapDateToISO(val) {
  if (!val) return null;

  // SAP /Date(…)/ style
  if (typeof val === "string" && val.startsWith("/Date(")) {
    const ms = parseInt(val.replace("/Date(", "").replace(")/", ""), 10);
    if (!Number.isNaN(ms)) return new Date(ms).toISOString();
    return null;
  }

  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function mapDireccion(addr) {
  if (!addr) return { cliente: null, direccion: "" };

  const Name1 = addr.Name1 ?? addr.Name ?? addr.FullName ?? "";
  const Name2 = addr.Name2 ?? "";
  const Name3 = addr.Name3 ?? "";
  const Name4 = addr.Name4 ?? "";

  const Street = addr.Street ?? addr.StreetName ?? "";
  const HouseNum1 = addr.HouseNum1 ?? addr.HouseNumber ?? "";
  const HouseNum2 = addr.HouseNum2 ?? "";
  const HouseNum3 = addr.HouseNum3 ?? "";

  const StrSuppl1 = addr.StrSuppl1 ?? "";
  const StrSuppl2 = addr.StrSuppl2 ?? "";
  const StrSuppl3 = addr.StrSuppl3 ?? "";

  const Location = addr.Location ?? "";
  const City2 = addr.City2 ?? "";
  const City1 = addr.City1 ?? addr.City ?? "";

  const Region = addr.Region ?? addr.State ?? addr.RegionName ?? "";
  const PostCode1 = addr.PostCode1 ?? addr.PostalCode ?? "";
  const Country = addr.Country ?? addr.CountryISO ?? addr.CountryKey ?? "";

  const cliente = [Name1, Name2, Name3, Name4]
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();

  const calleNumero = [Street, HouseNum1]
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .join(" ");

  const detalle = [HouseNum2, HouseNum3]
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .join(" ");

  const complementos = [StrSuppl1, StrSuppl2, StrSuppl3]
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .join(", ");

  const ubicacion = [Location, City2, City1]
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .join(", ");

  const regionCpPais = [Region, PostCode1, Country]
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .join(" ");

  const direccion = [
    calleNumero,
    detalle,
    complementos,
    ubicacion,
    regionCpPais,
  ]
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .join(", ");

  return { cliente, direccion };
}

/**
 * GET datos base SAP para la carta (SIN BD)
 */
export async function getDatosCartaNoMantenimiento({ orderid, user }) {
  const id = String(orderid || "").trim();

  if (!id) {
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

  // 1) Header de la orden
  const qp = new URLSearchParams();
  qp.set("$format", "json");
  qp.set("sap-client", SAP_CLIENT);
  qp.set("sap-language", SAP_LANG);

  const headerPath =
    `/sap/opu/odata/sap/ZCS_GET_WORKORDER_SRV/WorkOrderHeaderSet('${encodeURIComponent(
      id,
    )}')?` + qp.toString();

  log("GET", d.url + headerPath);

  const rHdr = await executeHttpRequest(d, {
    method: "GET",
    url: headerPath,
    headers: { Accept: "application/json" },
  });

  const header = rHdr?.data?.d || null;

  if (!header?.Orderid && !header?.OrderId && !header?.Aufnr) {
    const e = new Error(`Orden no encontrada en SAP: ${id}`);
    e.statusCode = 404;
    throw e;
  }

  const Orderid = header?.Orderid || header?.OrderId || header?.Aufnr || id;
  const Equipment = header?.Equipment || header?.Equnr || "";
  const StartDate = sapDateToISO(header?.StartDate);

  // 2) Dirección (ToAddresses)
  const addrPath =
    `/sap/opu/odata/sap/ZCS_GET_WORKORDER_SRV/WorkOrderHeaderSet('${encodeURIComponent(
      id,
    )}')/ToAddresses?` + qp.toString();

  let addr = null;

  try {
    log("GET", d.url + addrPath);

    const rAddr = await executeHttpRequest(d, {
      method: "GET",
      url: addrPath,
      headers: { Accept: "application/json" },
    });

    const results = rAddr?.data?.d?.results || [];

    // Siempre tomar la primera dirección de ToAddresses
    addr = Array.isArray(results) && results.length > 0 ? results[0] : null;
      } catch {
        // Si SAP no trae dirección, no truena
        addr = null;
      }

  const { cliente, direccion } = mapDireccion(addr);

  // 3) Datos del mecánico desde token
  const nomina = user?.nomina ?? null;

  const nombre =
    user?.nombre ?? user?.name ?? user?.email ?? user?.correo ?? null;

  return {
    Orderid: String(Orderid),
    Equipment: String(Equipment),
    StartDate,
    razon_social: cliente || "",
    direccion: direccion || "",
    nomina,
    nombre,
  };
}

/**
 * POST "guardar" sin BD:
 * activa 0600 en SAP y desactiva estatus activos previos.
 *
 * Regla actual:
 * - 0600 = Carta No Mantto
 * - 0100 debe desactivarse para que no se queden dos estatus activos.
 */
export async function marcarNoMantenimientoSap({ payload }) {
  const orderid = String(payload?.orderid || payload?.Orderid || "").trim();

  if (!orderid) {
    const e = new Error("Falta orderid en payload");
    e.statusCode = 400;
    throw e;
  }

  // Validación básica del texto
  const descripcion = String(payload?.descripcion_concreta || "").trim();

  if (!descripcion) {
    const e = new Error("Falta descripcion_concreta");
    e.statusCode = 400;
    throw e;
  }

  const d = await getDestination({ destinationName: DEST_NAME });

  if (!d) {
    const e = new Error(`Destination "${DEST_NAME}" no encontrado`);
    e.statusCode = 404;
    throw e;
  }

  const { csrfToken, cookies } = await fetchCsrfAndCookies(
    d,
    "ZCS_CHANGE_WORKORDER_SRV",
  );

  const path =
    `/sap/opu/odata/sap/ZCS_CHANGE_WORKORDER_SRV/WorkOrderSet` +
    `?sap-client=${SAP_CLIENT}&sap-language=${SAP_LANG}`;

  /**
   * IMPORTANTE:
   * Antes se activaba 0011 y se quitaba 0100.
   * Ahora se activa 0600 y se quita 0100.
   *
   * También desactivamos 0200 y 0400 por seguridad para evitar estatus acumulados
   * si SAP permite varios activos al mismo tiempo.
   */
  const changePayload = {
    OrderId: orderid,
    WorkOrderHeader: {
      Orderid: orderid,
    },
    WorkOrderUserStatusSet: [
      {
        UserStText: "0600",
        Langu: "ES",
        Inactive: "",
      },
      {
        UserStText: "0100",
        Langu: "ES",
        Inactive: "X",
      },
      {
        UserStText: "0200",
        Langu: "ES",
        Inactive: "X",
      },
      {
        UserStText: "0400",
        Langu: "ES",
        Inactive: "X",
      },
    ],
    Return: [],
  };

  log("POST", d.url + path);
  log("Payload", JSON.stringify(changePayload));

  try {
    const resp = await forwardWrite({
      destination: d,
      method: "POST",
      path,
      body: changePayload,
      csrfToken,
      cookies,
      contentType: "application/json",
    });

    const sapData = resp?.data || null;

    const returns =
      sapData?.d?.ReturnSet?.results ??
      sapData?.ReturnSet?.results ??
      sapData?.ReturnSet ??
      [];

    const hasError =
      Array.isArray(returns) &&
      returns.some(
        (r) => String(r?.Type || r?.type || "").toUpperCase() === "E",
      );

    const sapResult = {
      ok: !hasError,
      returns,
      raw: sapData,
    };

    return {
      ok: true,
      orderid,

      estatus_code: "0600",
      userstatus: "0600",
      estatus: "Carta No Mantto",
      estatus_label: "Carta No Mantto",
      estatus_tipo: "NO_MANTENIMIENTO",
      isFinal: true,

      sap: sapResult,

      captura: {
        mes_afecto: payload?.mes_afecto ?? null,
        descripcion_concreta: descripcion,
        motivo_no_mantenimiento: payload?.motivo_no_mantenimiento ?? null,
      },
    };
  } catch (err) {
    const status = err?.response?.status || 500;
    const data = err?.response?.data || err?.message || String(err);

    return {
      ok: true,
      orderid,

      estatus_code: "0600",
      userstatus: "0600",
      estatus: "Carta No Mantto",
      estatus_label: "Carta No Mantto",
      estatus_tipo: "NO_MANTENIMIENTO",
      isFinal: true,

      sap: {
        ok: false,
        status,
        error: data,
      },

      captura: {
        mes_afecto: payload?.mes_afecto ?? null,
        descripcion_concreta: descripcion,
        motivo_no_mantenimiento: payload?.motivo_no_mantenimiento ?? null,
      },
    };
  }
}