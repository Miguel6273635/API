# my-node-api 🚀

API Node.js desplegada en SAP BTP (Cloud Foundry) para consumir servicios OData
a través del Destination Service, sin necesidad de VPN.

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
