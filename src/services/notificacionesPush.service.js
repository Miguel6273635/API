// src/services/notificacionesPush.service.js

import { getPushTokensByEmail } from "../store/pushTokens.store.js";
import { log } from "../config/env.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export function isValidExpoPushToken(token) {
  const s = String(token || "").trim();
  return (
    s.startsWith("ExponentPushToken[") ||
    s.startsWith("ExpoPushToken[")
  );
}

export async function sendExpoPushMessages(messages = []) {
  const cleaned = (Array.isArray(messages) ? messages : []).filter(
    (m) => m?.to && isValidExpoPushToken(m.to)
  );

  if (!cleaned.length) {
    return {
      ok: false,
      reason: "no_valid_messages",
      tickets: [],
    };
  }

  const resp = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cleaned),
  });

  const data = await resp.json().catch(() => null);

  if (!resp.ok) {
    const e = new Error("Expo push API respondió con error");
    e.statusCode = resp.status;
    e.payload = data;
    throw e;
  }

  return {
    ok: true,
    tickets: data?.data || [],
    raw: data,
  };
}

export async function sendPushToUserEmail({
  email,
  title,
  body,
  data = {},
  sound = "default",
}) {
  const tokens = getPushTokensByEmail(email).filter((t) =>
    isValidExpoPushToken(t?.expoPushToken)
  );

  if (!tokens.length) {
    return {
      ok: false,
      reason: "user_without_registered_tokens",
      tickets: [],
    };
  }

  const messages = tokens.map((t) => ({
    to: t.expoPushToken,
    sound,
    title: String(title || "Notificación"),
    body: String(body || ""),
    data: data || {},
  }));

  const result = await sendExpoPushMessages(messages);
  return {
    ok: true,
    tickets: result.tickets || [],
    sent: messages.length,
  };
}

export async function sendTestPushToUser({
  email,
  name,
}) {
  const title = "Prueba de notificaciones";
  const body = `Hola${name ? ` ${name}` : ""}, tu registro push está funcionando.`;

  return sendPushToUserEmail({
    email,
    title,
    body,
    data: {
      screen: "supervisor_home",
      type: "test_push",
      sentAt: new Date().toISOString(),
    },
  });
}

export async function sendOrderStatusPushToUser({
  email,
  orderId,
  statusCode,
  statusLabel,
  changedBy,
}) {
  const title = `Orden ${orderId}`;
  const body = `Cambió a estatus ${statusLabel || statusCode || "actualizado"}.`;

  log("[PUSH][ORDER STATUS]", {
    email,
    orderId,
    statusCode,
    statusLabel,
    changedBy,
  });

  return sendPushToUserEmail({
    email,
    title,
    body,
    data: {
      screen: "supervisor_order_detail",
      type: "order_status_changed",
      orderId: String(orderId),
      statusCode: statusCode ? String(statusCode) : "",
      statusLabel: statusLabel ? String(statusLabel) : "",
      changedBy: changedBy ? String(changedBy) : "",
      sentAt: new Date().toISOString(),
    },
  });
}