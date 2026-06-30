// services/tbmkySap.service.js
import { getDestination } from "@sap-cloud-sdk/connectivity";
import { DEST_NAME, SAP_CLIENT, SAP_LANG } from "../config/env.js";
import { fetchCsrfAndCookies, forwardWrite } from "../sap/csrf.js";

const SERVICE = "ZCS_CHANGE_WORKORDER_SRV";

function serviceRoot() {
  // ✅ IMPORTANTE: token fetch y POST deben usar el MISMO root + query
  return (
    `/sap/opu/odata/sap/${SERVICE}/` +
    `?sap-client=${SAP_CLIENT}&sap-language=${SAP_LANG}&$format=json`
  );
}

function workOrderSetPath() {
  return (
    `/sap/opu/odata/sap/${SERVICE}/WorkOrderSet` +
    `?sap-client=${SAP_CLIENT}&sap-language=${SAP_LANG}`
  );
}

export async function setStatusEnProceso({ orderId }) {
  const d = await getDestination({ destinationName: DEST_NAME });
  if (!d) {
    const e = new Error(`Destination "${DEST_NAME}" no encontrado`);
    e.statusCode = 404;
    throw e;
  }

  // ✅ CSRF + cookies desde el MISMO root (client/lang)
  const { csrfToken, cookies } = await fetchCsrfAndCookies(d, serviceRoot());

  const statusPayload = {
    OrderId: String(orderId),
    WorkOrderHeader: { Orderid: String(orderId) },
    WorkOrderUserStatusSet: [
      { UserStText: "0200", Langu: "ES", Inactive: "" },  // EN PROCESO
      { UserStText: "0100", Langu: "ES", Inactive: "X" }, // quitar PENDIENTE
    ],
    Return: [],
  };

  return forwardWrite({
    destination: d,
    method: "POST",
    path: workOrderSetPath(),
    body: statusPayload,

    // ✅ nombres correctos
    csrfToken,
    cookies,

    contentType: "application/json",
  });
}

export async function attachPdfToWorkOrder({ orderId, pdfBase64, fileName }) {
  const d = await getDestination({ destinationName: DEST_NAME });
  if (!d) {
    const e = new Error(`Destination "${DEST_NAME}" no encontrado`);
    e.statusCode = 404;
    throw e;
  }

  // ✅ CSRF + cookies desde el MISMO root (client/lang)
  const { csrfToken, cookies } = await fetchCsrfAndCookies(d, serviceRoot());

  const attachPayload = {
    WorkOrderHeader: { Orderid: String(orderId) },
    Attachments: [
      {
        // ✅ DocId = número de orden (como quieres)
        DocId: String(orderId),

        FileName: String(fileName || `TBMKY_${orderId}.pdf`),
        MimeType: "application/pdf",
        Base64: String(pdfBase64 || "").trim(),
      },
    ],
    Return: [],
  };

  return forwardWrite({
    destination: d,
    method: "POST",
    path: workOrderSetPath(),
    body: attachPayload,

    // ✅ nombres correctos
    csrfToken,
    cookies,

    contentType: "application/json",
  });
}
