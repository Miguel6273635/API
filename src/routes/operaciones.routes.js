// src/routes/operaciones.routes.js
import { Router } from "express";
import { verifyAzureToken } from "../middlewares/verifyAzureToken.js";
import { fetchOperacionesSap } from "../services/operaciones/operacionesSap.service.js";
import { fetchComponentsFromSap } from "../services/operaciones/componentsSap.service.js";
import { postConfirmation } from "../sap/confirmations.js";

const router = Router();

/** ===================== Helpers ID ===================== */
function parseCompositeId(raw) {
  const s = String(raw || "").trim().replace(/-+$/, "");
  const [Orderid, Activity, SubActivity] = s.split("-");
  return {
    Orderid: (Orderid || "").trim(),
    Activity: (Activity || "").trim(),
    SubActivity: (SubActivity || "").trim() || "",
  };
}

function normalizeOperationId(op) {
  const s = String(op || "").trim();
  if (!s) return "";
  if (s.includes("-")) {
    const { Activity } = parseCompositeId(s);
    return String(Activity || "").padStart(4, "0");
  }
  return String(s).padStart(4, "0");
}

/** ===================== Helpers SAP ===================== */
const startOfDayUtcMs = (ms) => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);
};

const msToODataDate = (ms) => `/Date(${ms})/`;

const msToIsoTimeDurationUTC = (ms) => {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `PT${hh}H${mm}M${ss}S`;
};

const roundMin = (ms) => Math.max(1, Math.ceil(ms / 60000));

const numOrNull = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const pickMs = ({ ms, iso }) => {
  const n = numOrNull(ms);
  if (n != null) return n;
  const t = new Date(iso || "").getTime();
  return Number.isFinite(t) ? t : null;
};

const utcMsToDeviceLocalMs = (utcMs, tzOffsetMin) => {
  const off = numOrNull(tzOffsetMin) ?? 0;
  return utcMs - off * 60 * 1000;
};

const applyMinus5Min = (ms, enabled) => (enabled ? ms - 5 * 60 * 1000 : ms);

function safeJson(x) {
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

function logSapPayload(tag, payload, extra = {}) {
  console.log(`\n🟦 [SAP][${tag}] payload_enviado:\n${safeJson(payload)}\n`);
  if (extra && Object.keys(extra).length) {
    console.log(`🟦 [SAP][${tag}] meta:\n${safeJson(extra)}\n`);
  }
}
function logSapResp(tag, resp) {
  console.log(`🟩 [SAP][${tag}] resp:\n${safeJson(resp)}\n`);
}
function logSapErr(tag, err) {
  const detail = err?.response?.data || err?.message || err;
  console.error(`🟥 [SAP][${tag}] error:\n${safeJson(detail)}\n`);
}

/** ===================== Helpers materiales (✅ NUEVO) ===================== */
function normalizeMaterialRow(m) {
  if (!m) return null;

  const Material = String(m.Material ?? m.material ?? "").trim();
  if (!Material) return null;

  const CantidadRaw = m.Cantidad ?? m.cantidad ?? m.qty ?? m.quantity ?? "0";
  const n = Number(CantidadRaw);
  const Cantidad = Number.isFinite(n) ? String(n) : String(CantidadRaw).trim();

  const Unidad = String(m.Unidad ?? m.unidad ?? m.Unit ?? m.unit ?? "").trim();
  const Centro = String(m.Centro ?? m.centro ?? m.Werks ?? m.werks ?? "").trim();

  if (!Cantidad || Number(Cantidad) <= 0) return null;
  if (!Unidad) return null;
  if (!Centro) return null;

  // ✅ Almacen ya NO se manda
  return { Material, Cantidad, Unidad, Centro };
}

function buildConfirmationMaterialSet(materialConsumptionByOp, opsNorm) {
  const matsMap =
    materialConsumptionByOp && typeof materialConsumptionByOp === "object"
      ? materialConsumptionByOp
      : {};

  // Normaliza llaves del map para que coincidan con Operation (padStart 4)
  const normalizedMap = {};
  for (const [k, v] of Object.entries(matsMap)) {
    const opKey = normalizeOperationId(k);
    if (!opKey) continue;
    normalizedMap[opKey] = Array.isArray(v) ? v : [];
  }

  // Junta materiales SOLO de las ops que vas a confirmar
  const rawRows = opsNorm.flatMap((Operation) => normalizedMap[Operation] || []);

  const cleaned = rawRows.map(normalizeMaterialRow).filter(Boolean);

  // Agrega duplicados (Material+Unidad+Centro)
  const agg = new Map();
  for (const r of cleaned) {
    const key = `${r.Material}||${r.Unidad}||${r.Centro}`;
    const prev = agg.get(key);
    if (!prev) agg.set(key, r);
    else {
      const sum = Number(prev.Cantidad) + Number(r.Cantidad);
      agg.set(key, { ...prev, Cantidad: String(sum) });
    }
  }

  return Array.from(agg.values());
}

/** ===================== GET operaciones SAP “bonitas” ===================== */
router.get("/sap/:orderid", verifyAzureToken, async (req, res) => {
  try {
    const { orderid } = req.params;
    const ops = await fetchOperacionesSap(orderid);
    return res.json(ops);
  } catch (e) {
    const status = e?.statusCode || e?.response?.status || 500;
    const detail = e?.response?.data || e?.message || String(e);
    console.error("fetchOperacionesSap ERROR:", detail);
    return res.status(status).json({ error: "Error al obtener operaciones desde SAP", detail });
  }
});

/** ===================== GET componentes por operación ===================== */
router.get(
  "/ordenes/:orderid/operaciones/:activity/componentes",
  verifyAzureToken,
  async (req, res) => {
    try {
      const { orderid, activity } = req.params;
      const comps = await fetchComponentsFromSap(orderid, activity);
      return res.json(comps);
    } catch (e) {
      const status = e?.statusCode || e?.response?.status || 500;
      const detail = e?.response?.data || e?.message || String(e);
      console.error("fetchComponentsFromSap ERROR:", detail);
      return res.status(status).json({ error: "Error al obtener componentes desde SAP", detail });
    }
  }
);

/** ============================================================
 * ✅✅✅ IMPORTANTE: RUTAS /grupo/... VAN PRIMERO
 * ============================================================ */

/** ===================== PUT pausar grupo (batch) ===================== */
// PUT /api/operaciones/grupo/pausar
router.put("/grupo/pausar", verifyAzureToken, async (req, res) => {
  const {
    orderId,
    operations,
    segStartISO,
    segEndISO,
    segStartMs,
    segEndMs,
    tzOffsetMin,
    ConfText,
    minus5min,

    // ✅ NUEVO: consumibles también se mandan en "pendiente de firma"
    materialConsumptionByOp,
  } = req.body || {};

  const Orderid = String(orderId || "").trim();
  const opsArr = Array.isArray(operations) ? operations : [];

  if (!Orderid || opsArr.length === 0) {
    return res.status(400).json({
      error: "Faltan datos: orderId y operations[]",
      detail: { orderId, operations },
    });
  }

  const startUtcMs0 = pickMs({ ms: segStartMs, iso: segStartISO });
  const endUtcMs0 = pickMs({ ms: segEndMs, iso: segEndISO });

  if (startUtcMs0 == null || endUtcMs0 == null) {
    return res.status(400).json({
      error: "Faltan tiempos válidos (segStartMs/segEndMs o segStartISO/segEndISO)",
      detail: { segStartISO, segEndISO, segStartMs, segEndMs },
    });
  }

  const startUtcMs = applyMinus5Min(startUtcMs0, false);
  const endUtcMs = applyMinus5Min(endUtcMs0, !!minus5min);

  const startLocalMs = utcMsToDeviceLocalMs(startUtcMs, tzOffsetMin);
  const endLocalMs = utcMsToDeviceLocalMs(endUtcMs, tzOffsetMin);

  const segWorkedMs = Math.max(0, endLocalMs - startLocalMs);
  const segMin = roundMin(segWorkedMs);

  const opsNorm = opsArr.map(normalizeOperationId).filter(Boolean);
  if (opsNorm.length === 0) {
    return res.status(400).json({
      error: "operations[] no contenía operaciones válidas",
      detail: { operations },
    });
  }

  const ConfirmationOrderSet = opsNorm.map((Operation) => ({
    ConfNo: "",
    Orderid: String(Orderid),
    Operation,
    PostgDate: msToODataDate(startOfDayUtcMs(endLocalMs)),
    ActWork: String(segMin),
    UnWork: "min",
    ExecStartDate: msToODataDate(startOfDayUtcMs(startLocalMs)),
    ExecFinDate: msToODataDate(startOfDayUtcMs(endLocalMs)),
    ExecStartTime: msToIsoTimeDurationUTC(startLocalMs),
    ExecFinTime: msToIsoTimeDurationUTC(endLocalMs),
    ConfText: String(ConfText || "").trim(),
    // 👈 sin FinConf: es parcial (pendiente)
  }));

  // ✅ NUEVO: materiales en pausa
  const ConfirmationMaterialSet = buildConfirmationMaterialSet(materialConsumptionByOp, opsNorm);

  const payload = {
    Order: "S1",
    ConfirmationOrderSet,
    ConfirmationMaterialSet,
    Return: [],
  };

  logSapPayload("PAUSAR_GRUPO", payload, {
    Orderid,
    operations: opsNorm,
    tzOffsetMin: numOrNull(tzOffsetMin) ?? 0,
    minus5min: !!minus5min,
    startUtcMs,
    endUtcMs,
    startLocalMs,
    endLocalMs,
    segMin,
    segWorkedMs,
    material_items: ConfirmationMaterialSet.length,
  });

  let confirmacion;
  try {
    const sapResp = await postConfirmation(payload);
    logSapResp("PAUSAR_GRUPO", sapResp);
    confirmacion = { ok: true, raw: sapResp };
  } catch (e) {
    logSapErr("PAUSAR_GRUPO", e);
    confirmacion = { ok: false, error: e?.response?.data || e.message || e };
  }

  return res.json({
    message: "Grupo pausado (confirm parcial SAP)",
    tramo_ms: segWorkedMs,
    tramo_minutos: segMin,
    payload_enviado: payload,
    confirmacion,
  });
});

/** ===================== PUT finalizar grupo (batch) ===================== */
// PUT /api/operaciones/grupo/finalizar
router.put("/grupo/finalizar", verifyAzureToken, async (req, res) => {
  const {
    orderId,
    operations,
    startedISO,
    finishedISO,
    startedMs,
    finishedMs,
    tzOffsetMin,
    workedMsTotalByOp,
    materialConsumptionByOp,
    minus5min,
  } = req.body || {};

  const Orderid = String(orderId || "").trim();
  const opsArr = Array.isArray(operations) ? operations : [];

  if (!Orderid || opsArr.length === 0) {
    return res.status(400).json({
      error: "Faltan datos: orderId y operations[]",
      detail: { orderId, operations },
    });
  }

  const startUtcMs0 = pickMs({ ms: startedMs, iso: startedISO });
  const endUtcMs0 = pickMs({ ms: finishedMs, iso: finishedISO });

  if (startUtcMs0 == null || endUtcMs0 == null) {
    return res.status(400).json({
      error: "Faltan tiempos válidos (startedMs/finishedMs o startedISO/finishedISO)",
      detail: { startedISO, finishedISO, startedMs, finishedMs },
    });
  }

  const startUtcMs = applyMinus5Min(startUtcMs0, false);
  const endUtcMs = applyMinus5Min(endUtcMs0, !!minus5min);

  const startLocalMs = utcMsToDeviceLocalMs(startUtcMs, tzOffsetMin);
  const endLocalMs = utcMsToDeviceLocalMs(endUtcMs, tzOffsetMin);

  const workedMap =
    workedMsTotalByOp && typeof workedMsTotalByOp === "object" ? workedMsTotalByOp : {};

  const opsNorm = opsArr.map(normalizeOperationId).filter(Boolean);
  if (opsNorm.length === 0) {
    return res.status(400).json({
      error: "operations[] no contenía operaciones válidas",
      detail: { operations },
    });
  }

  const ConfirmationOrderSet = opsNorm.map((Operation) => {
    const totalMs = Number.isFinite(Number(workedMap[Operation]))
      ? Number(workedMap[Operation])
      : Math.max(0, endLocalMs - startLocalMs);

    const actWorkMin = roundMin(totalMs);

    return {
      ConfNo: "",
      Orderid: String(Orderid),
      Operation,
      PostgDate: msToODataDate(startOfDayUtcMs(endLocalMs)),
      ActWork: String(actWorkMin),
      UnWork: "min",
      ExecStartDate: msToODataDate(startOfDayUtcMs(startLocalMs)),
      ExecFinDate: msToODataDate(startOfDayUtcMs(endLocalMs)),
      ExecStartTime: msToIsoTimeDurationUTC(startLocalMs),
      ExecFinTime: msToIsoTimeDurationUTC(endLocalMs),
      FinConf: "X",
    };
  });

  // ✅ FIX: NO mandar Almacen + normalizar + agregar duplicados
  const ConfirmationMaterialSet = buildConfirmationMaterialSet(materialConsumptionByOp, opsNorm);

  const payload = {
    Order: "S1",
    ConfirmationOrderSet,
    ConfirmationMaterialSet,
    Return: [],
  };

  logSapPayload("FINALIZAR_GRUPO", payload, {
    Orderid,
    operations: opsNorm,
    tzOffsetMin: numOrNull(tzOffsetMin) ?? 0,
    minus5min: !!minus5min,
    startUtcMs,
    endUtcMs,
    startLocalMs,
    endLocalMs,
    material_items: ConfirmationMaterialSet.length,
  });

  let confirmacion;
  try {
    const sapResp = await postConfirmation(payload);
    logSapResp("FINALIZAR_GRUPO", sapResp);
    confirmacion = { ok: true, raw: sapResp };
  } catch (e) {
    logSapErr("FINALIZAR_GRUPO", e);
    confirmacion = { ok: false, error: e?.response?.data || e.message || e };
  }

  return res.json({
    message: "Grupo finalizado (confirm final SAP)",
    payload_enviado: payload,
    confirmacion,
  });
});

/** ===================== PUT iniciar (sin SAP, solo OK) ===================== */
router.put("/:id/iniciar", verifyAzureToken, async (req, res) => {
  const { id } = req.params;
  const { Orderid, Activity, SubActivity } = parseCompositeId(id);

  if (!Orderid || !Activity) {
    return res.status(400).json({ error: "ID inválido (Orderid-Activity-Sub?)" });
  }

  return res.json({
    message: "OK iniciar (client-side)",
    operacion: {
      Orderid,
      Activity,
      SubActivity,
      estatus: "en_proceso",
      last_resume_at: new Date().toISOString(),
    },
  });
});

/** ===================== PUT pausar individual ===================== */
router.put("/:id/pausar", verifyAzureToken, async (_req, res) => {
  return res.status(501).json({
    error: "Mantén tu handler individual aquí (no lo pegué completo)",
  });
});

/** ===================== PUT finalizar individual ===================== */
router.put("/:id/finalizar", verifyAzureToken, async (_req, res) => {
  return res.status(501).json({
    error: "Mantén tu handler individual aquí (no lo pegué completo)",
  });
});

export default router;