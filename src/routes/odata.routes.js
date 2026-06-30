// src/routes/odata.routes.js
import express from "express";
import {
  servicesListPayload,
  proxyOdataRead,
  proxyOdataWrite,
  isAllowedService,
} from "../sap/odataProxy.js";

const router = express.Router();

/** Lista de servicios */
router.get("/", (_req, res) => {
  res.json(servicesListPayload());
});

/** GET raíz del servicio (igual que tu /api/odata/:service) */
router.get("/:service", async (req, res) => {
  const { service } = req.params;

  if (!isAllowedService(service)) {
    return res.status(400).json({ error: `Servicio no permitido: ${service}` });
  }

  try {
    const r = await proxyOdataRead({ service, extraPath: "", query: req.query });
    if (r.isMetadata) {
      return res.type("application/xml").status(r.status).send(r.data);
    }
    return res.status(r.status).send(r.data);
  } catch (error) {
    const status = error?.statusCode || error?.response?.status || 500;
    const body = error?.response?.data || error?.message || String(error);
    return res.status(status).send(body);
  }
});

/** GET subrutas (igual que tu /api/odata/:service/*) */
router.get("/:service/*", async (req, res) => {
  const { service } = req.params;
  const extraPath = (req.params[0] || "").replace(/^\/+/, "");

  if (!isAllowedService(service)) {
    return res.status(400).json({ error: `Servicio no permitido: ${service}` });
  }

  try {
    const r = await proxyOdataRead({ service, extraPath, query: req.query });
    if (r.isMetadata) {
      return res.type("application/xml").status(r.status).send(r.data);
    }
    return res.status(r.status).send(r.data);
  } catch (error) {
    const status = error?.statusCode || error?.response?.status || 500;
    const body = error?.response?.data || error?.message || String(error);
    return res.status(status).send(body);
  }
});

/** WRITE helper */
async function handleWrite(req, res, verb) {
  const { service } = req.params;
  const extraPath = (req.params[0] || "").replace(/^\/+/, "");

  try {
    const r = await proxyOdataWrite({
      service,
      extraPath,
      query: req.query,
      verb,
      body: req.body,
      contentType: req.headers["content-type"] || "",
    });

    return res.status(r.status).send(r.data);
  } catch (error) {
    const status = error?.statusCode || error?.response?.status || 500;

    // si venía payload (allowed list), devuélvela bonita
    if (error?.payload) {
      return res.status(status).json({ error: error.message, ...error.payload });
    }

    const body = error?.response?.data || error?.message || String(error);
    return res.status(status).send(body);
  }
}

router.post("/:service/*", (req, res) => handleWrite(req, res, "POST"));
router.put("/:service/*", (req, res) => handleWrite(req, res, "PUT"));
router.patch("/:service/*", (req, res) => handleWrite(req, res, "PATCH"));
router.delete("/:service/*", (req, res) => handleWrite(req, res, "DELETE"));

export default router;
