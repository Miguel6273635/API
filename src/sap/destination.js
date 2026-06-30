// src/sap/destination.js
import { getDestination } from "@sap-cloud-sdk/connectivity";
import { DEST_NAME } from "../config/env.js";

export async function getSapDestination() {
  const d = await getDestination({ destinationName: DEST_NAME });
  if (!d) {
    throw new Error(`Destination "${DEST_NAME}" no encontrado`);
  }
  return d;
}
