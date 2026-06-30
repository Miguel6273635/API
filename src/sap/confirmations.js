// src/sap/confirmations.js
import { executeHttpRequest } from "@sap-cloud-sdk/http-client";
import { SAP_CLIENT, SAP_LANG } from "../config/env.js";
import { getSapDestination } from "./destination.js";
import { fetchCsrfAndCookies } from "./csrf.js";

export async function postConfirmation(payload) {
  const destination = await getSapDestination(); // <- destination REAL con .url
  const serviceName = "ZCS_CREATE_CONFIRMATION_SRV";
  const servicePath = `/sap/opu/odata/sap/${serviceName}`;

  const { csrfToken, cookies } = await fetchCsrfAndCookies(destination, serviceName);

  const resp = await executeHttpRequest(destination, {
    method: "POST",
    url: `${servicePath}/ConfirmationHeaderSet`,
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
      Cookie: cookies,
      Accept: "application/json",
      "sap-client": SAP_CLIENT,
      "Accept-Language": SAP_LANG || "ES",
    },
    data: payload,
  });

  return resp.data;
}
