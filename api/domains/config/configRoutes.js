const express = require("express");
const router = express.Router();
const { requireAuth } = require("../../shared/middleware/auth");
const { LOCAIS_TRABALHO } = require("../../shared/lib/locaisTrabalho");

// Configuração do sistema servida ao frontend (que está publicado à parte, no GitHub
// Pages, e por isso não partilha ficheiros com a API). Não lê o Firestore para além da
// autenticação; o frontend pede isto uma vez por sessão (ver useLocaisTrabalho.js).
router.get("/locais-trabalho", requireAuth, (req, res) => {
  res.status(200).json({ locaisTrabalho: LOCAIS_TRABALHO });
});

module.exports = router;
