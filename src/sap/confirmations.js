// src/sap/confirmations.js
import { SAP_CLIENT, SAP_LANG } from "../config/env.js";
import { getSapDestination } from "./destination.js";
import { fetchCsrfAndCookies, forwardWrite } from "./csrf.js";

export async function postConfirmation(payload) {
  const destination = await getSapDestination();
  const serviceName = "ZCS_CREATE_CONFIRMATION_SRV";
  const servicePath = `/sap/opu/odata/sap/${serviceName}`;

  const { csrfToken, cookies } = await fetchCsrfAndCookies(
    destination,
    serviceName
  );

  const resp = await forwardWrite({
    destination,
    method: "POST",
    path:
      `${servicePath}/ConfirmationHeaderSet` +
      `?sap-client=${encodeURIComponent(SAP_CLIENT)}` +
      `&sap-language=${encodeURIComponent(SAP_LANG || "ES")}`,
    body: payload,
    csrfToken,
    cookies,
    contentType: "application/json",
    terminateSession: true,
  });

  return resp.data;
}
