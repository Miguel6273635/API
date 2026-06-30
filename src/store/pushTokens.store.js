// src/store/pushTokens.store.js

const store = new Map();

/*
Estructura:
store[email] = {
  email,
  name,
  rol_id,
  azureRoles: [],
  tokens: [
    {
      expoPushToken,
      platform,
      app,
      updatedAt
    }
  ]
}
*/

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeRoleNames(roles = []) {
  return roles.map((r) => String(r).trim().toLowerCase());
}

function pickRolIdFromAzureRoles(rawRoles = []) {
  const roles = normalizeRoleNames(rawRoles);
  if (roles.includes("admin") || roles.includes("administrador")) return 1;
  if (roles.includes("supervisor")) return 2;
  return 3;
}

export function upsertPushTokenForUser({
  email,
  name = null,
  rol_id = null,
  azureRoles = [],
  expoPushToken,
  platform = null,
  app = null,
}) {
  const key = normalizeEmail(email);
  if (!key) {
    throw new Error("email requerido para guardar push token");
  }

  if (!expoPushToken) {
    throw new Error("expoPushToken requerido");
  }

  const existing =
    store.get(key) || {
      email: key,
      name: name || null,
      rol_id:
        rol_id ??
        pickRolIdFromAzureRoles(Array.isArray(azureRoles) ? azureRoles : []),
      azureRoles: Array.isArray(azureRoles) ? azureRoles : [],
      tokens: [],
    };

  existing.name = name || existing.name || null;
  existing.rol_id =
    rol_id ??
    existing.rol_id ??
    pickRolIdFromAzureRoles(Array.isArray(azureRoles) ? azureRoles : []);
  existing.azureRoles = Array.isArray(azureRoles)
    ? azureRoles
    : existing.azureRoles || [];

  const idx = existing.tokens.findIndex(
    (t) => String(t.expoPushToken) === String(expoPushToken)
  );

  const row = {
    expoPushToken: String(expoPushToken),
    platform: platform ? String(platform) : null,
    app: app ? String(app) : null,
    updatedAt: new Date().toISOString(),
  };

  if (idx >= 0) {
    existing.tokens[idx] = {
      ...existing.tokens[idx],
      ...row,
    };
  } else {
    existing.tokens.push(row);
  }

  store.set(key, existing);
  return existing;
}

export function removePushTokenForUser(email, expoPushToken) {
  const key = normalizeEmail(email);
  const user = store.get(key);
  if (!user) return false;

  const before = user.tokens.length;
  user.tokens = user.tokens.filter(
    (t) => String(t.expoPushToken) !== String(expoPushToken)
  );

  if (!user.tokens.length) {
    store.delete(key);
  } else {
    store.set(key, user);
  }

  return before !== user.tokens.length;
}

export function getPushUserByEmail(email) {
  const key = normalizeEmail(email);
  return store.get(key) || null;
}

export function getPushTokensByEmail(email) {
  const key = normalizeEmail(email);
  const user = store.get(key);
  return Array.isArray(user?.tokens) ? user.tokens : [];
}

export function getAllPushUsers() {
  return Array.from(store.values());
}

export function getAllSupervisorPushUsers() {
  return Array.from(store.values()).filter((u) => Number(u?.rol_id) === 2);
}

export function dumpPushStore() {
  return {
    totalUsers: store.size,
    users: Array.from(store.values()),
  };
}