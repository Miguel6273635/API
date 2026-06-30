import express from "express";
import { verifyAzureToken } from "../middlewares/verifyAzureToken.js";

const router = express.Router();

router.get("/areas", verifyAzureToken, (_req, res) => {
  // Ajusta ids/labels a tu gusto
  res.json([
    { id: 1, area: "Cuarto de máquinas" },
    { id: 2, area: "Pozo" },
    { id: 3, area: "Cabina" },
    { id: 4, area: "Azotea" },
    { id: 5, area: "Vestíbulo / Lobby" },
  ]);
});

router.get("/riesgos", verifyAzureToken, (_req, res) => {
  res.json([
    { id: 1, riesgo: "Caída a distinto nivel" },
    { id: 2, riesgo: "Golpeado por / contra objetos" },
    { id: 3, riesgo: "Atrapamiento" },
    { id: 4, riesgo: "Contacto eléctrico" },
    { id: 5, riesgo: "Corte / laceración" },
    { id: 6, riesgo: "Proyección de partículas" },
    { id: 7, riesgo: "Sobreesfuerzo / postura" },
    { id: 8, riesgo: "Exposición a polvo" },
    { id: 9, riesgo: "Ruido" },
  ]);
});

export default router;
