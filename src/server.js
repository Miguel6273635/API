// src/server.js
import { createApp } from "./app.js";
import { PORT, DEST_NAME, SAP_CLIENT, AZURE_TENANT_ID, AZURE_CLIENT_ID, log } from "./config/env.js";

const app = createApp();

app.listen(PORT, () => {
  log(`Servidor escuchando en puerto ${PORT}`);
  log(`Destino activo: ${DEST_NAME} | Mandante SAP: ${SAP_CLIENT}`);
  log(`Azure tenant: ${AZURE_TENANT_ID ? "OK" : "MISSING"} | client: ${AZURE_CLIENT_ID ? "OK" : "MISSING"}`);
});
