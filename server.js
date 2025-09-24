const express = require('express');
const axios = require('axios');
const xsenv = require('@sap/xsenv');

xsenv.loadEnv();
const services = xsenv.getServices({ dest: { tag: 'destination' } });

const destinationService = services.dest;

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/api/clientes', async (req, res) => {
  try {
    const destName = 'mi_destino_onpremise'; // reemplaza con tu destination
    const path = '/sap/opu/odata/sap/ZCLIENTES_SRV/ClientesSet?$format=json';

    const tokenResponse = await axios.get(
      `${destinationService.uri}/destination-configuration/v1/destinations/${destName}`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(destinationService.clientid + ':' + destinationService.clientsecret).toString('base64')}`,
        },
      }
    );

    const config = tokenResponse.data.destinationConfiguration;
    const url = `${config.URL}${path}`;

    const response = await axios.get(url, {
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${config.User}:${config.Password}`).toString('base64'),
        Accept: 'application/json',
      },
    });

    res.json(response.data.d.results);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Error al consumir el servicio OData' });
  }
});

app.listen(PORT, () => console.log(`API ejecutándose en http://localhost:${PORT}`));
