// src/services/rutaSap.service.js
import { executeHttpRequest } from "@sap-cloud-sdk/http-client";
import { SAP_CLIENT, SAP_LANG } from "../config/env.js";
import { getSapDestination } from "../sap/destination.js";
import { listOrdenesSap } from "./ordersSap.service.js";

function mapDireccion(addr) {
  if (!addr) return { cliente: "", direccion: "" };

  const Name1 = addr.Name1 ?? "";
  const Name2 = addr.Name2 ?? "";
  const Street = addr.Street ?? addr.StreetName ?? "";
  const HouseNum1 = addr.HouseNum1 ?? "";
  const StrSuppl3 = addr.StrSuppl3 ?? "";
  const Location = addr.Location ?? "";
  const City1 = addr.City1 ?? "";
  const Region = addr.Region ?? "";
  const PostCode1 = addr.PostCode1 ?? "";
  const Country = addr.Country ?? "";

  const cliente = [Name1, Name2].filter(Boolean).join(" ").trim();

  const direccion = [
    `${Street} ${HouseNum1}`.trim(),
    StrSuppl3,
    Location,
    City1,
    Region,
    PostCode1,
    Country,
  ]
    .filter((x) => x && String(x).trim().length > 0)
    .join(", ");

  return { cliente, direccion };
}

async function fetchFirstAddressForOrder(destination, orderid) {
  const qp = new URLSearchParams();
  qp.set("$format", "json");
  qp.set("sap-client", SAP_CLIENT);
  qp.set("sap-language", SAP_LANG || "ES");

  const path =
    `/sap/opu/odata/sap/ZCS_GET_WORKORDER_SRV/WorkOrderHeaderSet('${encodeURIComponent(
      String(orderid)
    )}')/ToAddresses?` + qp.toString();

  const r = await executeHttpRequest(destination, {
    method: "GET",
    url: path,
    headers: { Accept: "application/json" },
  });

  const results = r?.data?.d?.results || [];
  const first = Array.isArray(results) && results.length ? results[0] : null;
  return mapDireccion(first);
}

// mini helper para limitar concurrencia (para no pegarle 1000 requests a SAP)
async function mapWithLimit(items, limit, mapper) {
  const out = new Array(items.length);
  let i = 0;

  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await mapper(items[idx], idx);
    }
  });

  await Promise.all(workers);
  return out;
}

/**
 * Rutas asignadas (SAP):
 * - trae órdenes del usuario (correo en token)
 * - resuelve ToAddresses
 */
export async function getRutasAsignadasSap({ start, end, user, mode = "eq" }) {
  const destination = await getSapDestination();

  const ordenes = await listOrdenesSap({ start, end, user, mode });

  // limita concurrencia para SAP (ajusta 3-6 según tu gateway)
  const enriched = await mapWithLimit(ordenes, 4, async (o) => {
    const orderid = o?.Orderid || o?.orderid;
    let cliente = "";
    let direccion = "";

    try {
      const addr = await fetchFirstAddressForOrder(destination, orderid);
      cliente = addr.cliente || "";
      direccion = addr.direccion || "";
    } catch {
      // si no trae dirección, no truena
      cliente = "";
      direccion = "";
    }

    return {
      order_id: String(orderid || ""),
      nombre_orden: o?.nombre_orden || o?.order_type || "Orden",
      direccion,
      cliente,
      start_date: o?.start_date || o?.startdate || null,

      // opcional por si quieres usarlo después
      equipment: o?.equipment || "",
      userstatus: o?.userstatus || "",
    };
  });

  // filtra los que no pudieron armar dirección (opcional)
  return enriched.filter((x) => x.order_id);
}
