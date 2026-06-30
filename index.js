// index.js — API Node.js para SAP BTP QAS (mandante 400)
import dotenv from "dotenv";
dotenv.config();

import { createApp } from "./src/app.js";
import { log, PORT, DEST_NAME, SAP_CLIENT, AZURE_TENANT_ID, AZURE_CLIENT_ID } from "./src/config/env.js";

const app = createApp();

app.listen(PORT, () => {
  log(`Servidor escuchando en puerto ${PORT}`);
  log(`Destino activo: ${DEST_NAME} | Mandante SAP: ${SAP_CLIENT}`);
  log(`Azure tenant: ${AZURE_TENANT_ID ? "OK" : "MISSING"} | client: ${AZURE_CLIENT_ID ? "OK" : "MISSING"}`);
});
