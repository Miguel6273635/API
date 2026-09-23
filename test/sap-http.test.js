import test from "node:test";
import assert from "node:assert/strict";
import { createSapHttpClient } from "../src/sap/http.js";

const basicDestination = {
  url: "http://ecc.internal:8000",
  authentication: "BasicAuthentication",
  username: "USER_BTP",
};

test("reutiliza SAP_SESSIONID en llamadas sucesivas del usuario técnico", async () => {
  const sent = [];
  const client = createSapHttpClient(async (_destination, request) => {
    sent.push(request.headers.Cookie);
    return sent.length === 1
      ? { headers: { "set-cookie": ["SAP_SESSIONID_ECC_400=abc; Path=/"] } }
      : { headers: {} };
  }, { enabled: true });

  await client.execute(basicDestination, { method: "GET", headers: {} });
  await client.execute(basicDestination, { method: "GET", headers: {} });

  assert.deepEqual(sent, [undefined, "SAP_SESSIONID_ECC_400=abc"]);
  assert.equal(client.getSecurityCookie(basicDestination), "SAP_SESSIONID_ECC_400=abc");
});

test("espera la primera respuesta para evitar múltiples sesiones simultáneas", async () => {
  let finishFirst;
  let calls = 0;
  const client = createSapHttpClient(async (_destination, request) => {
    calls++;
    if (calls === 1) {
      await new Promise((resolve) => { finishFirst = resolve; });
      return { headers: { "set-cookie": "SAP_SESSIONID_ECC_400=abc; Path=/" } };
    }
    assert.equal(request.headers.Cookie, "SAP_SESSIONID_ECC_400=abc");
    return { headers: {} };
  }, { enabled: true });

  const first = client.execute(basicDestination, { method: "GET", headers: {} });
  const second = client.execute(basicDestination, { method: "GET", headers: {} });
  assert.equal(calls, 1);
  finishFirst();
  await Promise.all([first, second]);
  assert.equal(calls, 2);
});

test("conserva las cookies explícitas de CSRF y agrega la sesión cuando falta", async () => {
  const sent = [];
  const client = createSapHttpClient(async (_destination, request) => {
    sent.push(request.headers.Cookie);
    return sent.length === 1
      ? { headers: { "set-cookie": "SAP_SESSIONID_ECC_400=abc; Path=/" } }
      : { headers: {} };
  }, { enabled: true });

  await client.execute(basicDestination, { method: "GET", headers: {} });
  await client.execute(basicDestination, {
    method: "POST",
    headers: { Cookie: "sap-usercontext=sap-client=400", "X-CSRF-Token": "token" },
  });

  assert.equal(sent[1], "sap-usercontext=sap-client=400; SAP_SESSIONID_ECC_400=abc");
});

test("no comparte cookies con PrincipalPropagation", async () => {
  const sent = [];
  const client = createSapHttpClient(async (_destination, request) => {
    sent.push(request.headers?.Cookie);
    return { headers: { "set-cookie": "SAP_SESSIONID_ECC_400=abc; Path=/" } };
  }, { enabled: true });
  const destination = { ...basicDestination, authentication: "PrincipalPropagation" };

  await client.execute(destination, { method: "GET", headers: {} });
  await client.execute(destination, { method: "GET", headers: {} });

  assert.deepEqual(sent, [undefined, undefined]);
});

test("separa las sesiones de mandantes SAP distintos", async () => {
  const sent = [];
  const client = createSapHttpClient(async (_destination, request) => {
    sent.push(request.headers.Cookie);
    const sapClient = new URL(request.url, basicDestination.url).searchParams.get("sap-client");
    return { headers: { "set-cookie": `SAP_SESSIONID_ECC_${sapClient}=id${sapClient}; Path=/` } };
  }, { enabled: true });

  await client.execute(basicDestination, { method: "GET", url: "/odata?sap-client=400", headers: {} });
  await client.execute(basicDestination, { method: "GET", url: "/odata?sap-client=500", headers: {} });
  await client.execute(basicDestination, { method: "GET", url: "/odata?sap-client=400", headers: {} });

  assert.deepEqual(sent, [undefined, undefined, "SAP_SESSIONID_ECC_400=id400"]);
});

test("otra consulta continúa si la primera llamada a SAP tarda demasiado", async () => {
  let finishFirst;
  let calls = 0;
  const client = createSapHttpClient(async () => {
    calls++;
    if (calls === 1) {
      await new Promise((resolve) => { finishFirst = resolve; });
      return { data: { mechanic: "A" }, headers: {} };
    }
    return { data: { mechanic: "B" }, headers: {} };
  }, { enabled: true, bootstrapWaitMs: 5 });

  const first = client.execute(basicDestination, { method: "GET", url: "/orders?user=A", headers: {} });
  const second = client.execute(basicDestination, { method: "GET", url: "/orders?user=B", headers: {} });
  const secondResponse = await second;
  assert.deepEqual(secondResponse.data, { mechanic: "B" });
  finishFirst();
  const firstResponse = await first;
  assert.deepEqual(firstResponse.data, { mechanic: "A" });
});
