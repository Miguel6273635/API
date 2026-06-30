// src/routes/debug.routes.js
import express from "express";
import { getSapDestination } from "../sap/destination.js";

const router = express.Router();

router.get("/destination", async (_req, res) => {
  try {
    const d = await getSapDestination();
    if (!d) return res.status(404).json({ error: "Destination no encontrado" });

    res.json({
      name: d.name,
      url: d.url,
      proxyType: d.proxyType,
      authentication: d.authentication,
      locationId: d.cloudConnectorLocationId || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

export default router;
