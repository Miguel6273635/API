// src/services/operaciones/componentsSap.service.js
import { executeHttpRequest } from "@sap-cloud-sdk/http-client";
import { SAP_CLIENT, SAP_LANG } from "../../config/env.js";
import { getSapDestination } from "../../sap/destination.js";

const BASE = "/sap/opu/odata/sap/ZCS_GET_WORKORDER_SRV";

export async function fetchComponentsFromSap(orderid, activityRaw) {
  const destination = await getSapDestination();
  const activityWanted = String(activityRaw || "").padStart(4, "0");

  const url = `${BASE}/WorkOrderHeaderSet('${encodeURIComponent(
    String(orderid).trim()
  )}')/ToComponents?$format=json`;

  const resp = await executeHttpRequest(destination, {
    method: "GET",
    url,
    headers: {
      "sap-client": SAP_CLIENT,
      "Accept-Language": SAP_LANG || "ES",
      accept: "application/json",
      "sap-terminate": "session",
    },
  });

  const results = resp?.data?.d?.results || [];

  return results
    .filter((c) => String(c.Activity || "").padStart(4, "0") === activityWanted)
    .map((c) => ({
      Orderid: c.Orderid,
      Activity: c.Activity,
      ResItem: c.ResItem,
      Material: c.Material,
      MatlDesc: c.MatlDesc,
      RequirementQuantity: Number(c.RequirementQuantity ?? 0),
      RequirementQuantityUnit: c.RequirementQuantityUnit,
      RequirementQuantityUnitIso: c.RequirementQuantityUnitIso,
      Plant: c.Plant,
      StgeLoc: c.StgeLoc,
      WithdQuan: Number(c.WithdQuan ?? 0),
      CommitedQuan: Number(c.CommitedQuan ?? 0),
    }));
}
