import { executeHttpRequest } from "@sap-cloud-sdk/http-client";
import { SAP_CLIENT } from "../config/env.js";

const COOKIE_TTL_MS = 4 * 60 * 1000;
const NO_COOKIE_RETRY_MS = 60 * 1000;
const BOOTSTRAP_WAIT_MS = 3 * 1000;

async function waitForInitialization(initializing, waitMs) {
  let timer;
  try {
    await Promise.race([
      initializing,
      new Promise((resolve) => { timer = setTimeout(resolve, waitMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function securityCookieFromHeaders(headers = {}) {
  const setCookie = headers["set-cookie"] ?? headers["Set-Cookie"];
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];

  for (const value of values) {
    const pair = String(value).split(";", 1)[0].trim();
    if (/^SAP_SESSIONID_[^=\s]+=[^;\s]+$/i.test(pair)) return pair;
  }
  return null;
}

function securitySessionKey(destination, enabled, requestConfig = {}) {
  if (!enabled || !destination?.url || !destination?.username) return null;
  if (destination.authentication !== "BasicAuthentication") return null;

  // Nunca compartir una sesión cuando la Destination propaga la identidad del usuario.
  const headers = requestConfig.headers || {};
  const clientHeader = Object.keys(headers).find((name) => name.toLowerCase() === "sap-client");
  const client = clientHeader
    ? headers[clientHeader]
    : new URL(requestConfig.url || "", destination.url).searchParams.get("sap-client") ||
      destination.sapClient || SAP_CLIENT;
  return `${destination.url}|${destination.username}|${client}`;
}

function hasSecurityCookie(value) {
  return /(?:^|;\s*)SAP_SESSIONID_[^=\s]+=/i.test(String(value || ""));
}

function isExpiredSession(error) {
  const status = error?.response?.status;
  if (status === 401) return true;
  if (status !== 400) return false;
  const data = error?.response?.data;
  const message = typeof data === "string" ? data : JSON.stringify(data || "");
  return /session (?:not found|timed out)/i.test(message);
}

export function createSapHttpClient(transport = executeHttpRequest, options = {}) {
  const enabled = options.enabled ?? process.env.SAP_REUSE_SECURITY_SESSION === "true";
  const cookieTtlMs = options.cookieTtlMs ?? COOKIE_TTL_MS;
  const bootstrapWaitMs = options.bootstrapWaitMs ?? BOOTSTRAP_WAIT_MS;
  const sessions = new Map();

  function getSecurityCookie(destination, requestConfig) {
    const key = securitySessionKey(destination, enabled, requestConfig);
    const session = key && sessions.get(key);
    if (!session?.cookie || session.expiresAt <= Date.now()) return null;
    return session.cookie;
  }

  async function execute(destination, requestConfig, requestOptions) {
    const key = securitySessionKey(destination, enabled, requestConfig);
    if (!key) return transport(destination, requestConfig, requestOptions);

    let session = sessions.get(key);
    if (!session) {
      session = { cookie: null, expiresAt: 0, unavailableUntil: 0, initializing: null };
      sessions.set(key, session);
    }
    if (session.expiresAt <= Date.now()) session.cookie = null;

    let releaseInitialization;
    if (!getSecurityCookie(destination, requestConfig) && session.unavailableUntil <= Date.now()) {
      if (session.initializing) {
        await waitForInitialization(session.initializing, bootstrapWaitMs);
      } else {
        session.initializing = new Promise((resolve) => {
          releaseInitialization = resolve;
        });
      }
    }

    const headers = { ...requestConfig.headers };
    const cookieHeader = Object.keys(headers).find((name) => name.toLowerCase() === "cookie");
    const existingCookies = cookieHeader ? String(headers[cookieHeader]) : "";
    const securityCookie = getSecurityCookie(destination, requestConfig);
    const sentSecurityCookie = hasSecurityCookie(existingCookies)
      ? existingCookies.match(/SAP_SESSIONID_[^=\s]+=[^;\s]+/i)?.[0]
      : securityCookie;

    if (securityCookie && !hasSecurityCookie(existingCookies)) {
      headers[cookieHeader || "Cookie"] = existingCookies
        ? `${existingCookies}; ${securityCookie}`
        : securityCookie;
    }

    try {
      const response = await transport(
        destination,
        { ...requestConfig, headers },
        requestOptions
      );
      const newCookie = securityCookieFromHeaders(response?.headers);
      if (newCookie) {
        session.cookie = newCookie;
        session.expiresAt = Date.now() + cookieTtlMs;
        session.unavailableUntil = 0;
      } else if (sentSecurityCookie && session.cookie === sentSecurityCookie) {
        session.expiresAt = Date.now() + cookieTtlMs;
      } else if (!session.cookie) {
        session.unavailableUntil = Date.now() + NO_COOKIE_RETRY_MS;
      }
      return response;
    } catch (error) {
      if (sentSecurityCookie && session.cookie === sentSecurityCookie && isExpiredSession(error)) {
        session.cookie = null;
        session.expiresAt = 0;
      }
      throw error;
    } finally {
      if (releaseInitialization) {
        session.initializing = null;
        releaseInitialization();
      }
    }
  }

  return { execute, getSecurityCookie };
}

const sapHttpClient = createSapHttpClient();
export const executeSapHttpRequest = sapHttpClient.execute;
export const getSapSecurityCookie = sapHttpClient.getSecurityCookie;
