# my-node-api 🚀

API Node.js desplegada en SAP BTP (Cloud Foundry) para consumir servicios OData
a través del Destination Service, sin necesidad de VPN.

Para desarrollo local, copia `.env.example` a `.env` y completa los valores de
tu entorno. `.env` no se versiona. Instala dependencias con `npm ci` y ejecuta
las pruebas con `npm test`.

## 🔧 Requisitos

- Cuenta en SAP BTP (subcuenta con Cloud Foundry habilitado)
- Servicios:
  - Destination (lite)
  - Connectivity (lite)
  - XSUAA (application)

## 🚀 Despliegue

```bash
cf login -a https://api.cf.us10-001.hana.ondemand.com
cf push
```

## Sesiones de seguridad HTTP en SAP (SM05)

En QAS, `SAP_REUSE_SECURITY_SESSION: "true"` está habilitado en `manifest.yml`.
La API conserva en memoria la cookie `SAP_SESSIONID_*` que devuelve SAP y la
reenvía en las llamadas posteriores de la misma Destination **solo si** esta usa
`BasicAuthentication` con un usuario técnico fijo. La primera llamada concurrente
intenta obtener la cookie para las demás. Si tarda, las otras esperan como máximo
3 segundos antes de continuar con sus propias llamadas. Las escrituras siguen
obteniendo su propio token CSRF; la cookie de sesión se agrega si SAP no la
devuelve de nuevo. Los cuerpos JSON no se guardan ni comparten.
Antes de usarlo fuera de QAS, confirme que los servicios Gateway no mantienen
estado de aplicación entre peticiones; una sesión compartida no sería apropiada
para un servicio OData configurado como stateful.

La caché es por proceso de Node.js. Si Cloud Foundry ejecuta varias instancias,
cada una tendrá su propia sesión. Después de 4 minutos sin uso se descarta la
cookie local; si SAP tiene un `http/security_session_timeout` menor, ajuste ese
valor en `src/sap/http.js`. Para desactivar este comportamiento, establezca
`SAP_REUSE_SECURITY_SESSION: "false"` y vuelva a desplegar.

Tras desplegar en QAS, compare en SM05 cuántas sesiones nuevas genera el usuario
técnico por minuto antes y después, y pruebe lecturas y escrituras OData. Si un
servicio no necesita sesiones de seguridad, Basis puede revisar la opción
**Sesiones de seguridad** del nodo específico en SICF; esto debe validarse
independientemente de la reutilización de cookies en BTP.
