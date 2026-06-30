// src/app.js
import express from "express";
import morgan from "morgan";

import authRoutes from "./routes/auth.routes.js";
import ordenesRoutes from "./routes/ordenes.routes.js";
import odataRoutes from "./routes/odata.routes.js";
import debugRoutes from "./routes/debug.routes.js";
import operacionesRoutes from "./routes/operaciones.routes.js";
import cartaNoMantenimientoRoutes from "./routes/cartaNoMantenimiento.routes.js";
import catalogosRoutes from "./routes/catalogos.routes.js";
import formularioRiesgosRoutes from "./routes/formularioRiesgos.routes.js";
import avisoAveriaRoutes from "./routes/avisoAveria.routes.js";
import rutasRoutes from "./routes/rutas.routes.js";
import notificacionesRoutes from "./routes/notificaciones.routes.js";

export function createApp() {
  const app = express();

  app.use(express.json({ limit: "100mb" }));
  app.use(express.text({ type: "application/xml" }));
  app.use(morgan("tiny"));

  app.get("/health", (_req, res) => res.send("OK QAS"));
  app.get("/", (_req, res) => res.send("API QAS viva (mandante 400)."));

  app.use("/api/auth", authRoutes);
  app.use("/api/ordenes", ordenesRoutes);
  app.use("/api/odata", odataRoutes);
  app.use("/api/operaciones", operacionesRoutes);
  app.use("/api/carta-no-mantenimiento", cartaNoMantenimientoRoutes);
  app.use("/api/catalogos", catalogosRoutes);
  app.use("/api/formulario-riesgos", formularioRiesgosRoutes);
  app.use("/api/aviso-averia", avisoAveriaRoutes);
  app.use("/api/rutas-asignadas", rutasRoutes);
  app.use("/api/notificaciones", notificacionesRoutes);

  app.use("/debug", debugRoutes);

  return app;
}