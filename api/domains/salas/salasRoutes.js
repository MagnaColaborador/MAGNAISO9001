const express = require("express");
const router = express.Router();
const { requireAuth, requireAdminOrHR } = require("../../shared/middleware/auth");
const controller = require("./salasController");

// Requisição de Salas (Gestão de Infraestruturas). Consultar e reservar: qualquer
// colaborador autenticado. Gerir salas: SuperAdmin/GestorRH (o local de cada sala é um dos
// locais de trabalho de shared/lib/locaisTrabalho.js, servidos em /config/locais-trabalho).
// Editar/cancelar reservas e responder a pedidos: só o próprio dono - validado no controller (a
// reserva/pedido tem de pertencer a quem faz o pedido). Tudo vive em salas/{salaId}/...,
// por isso as rotas de escrita levam a sala.
router.get("/estrutura", requireAuth, controller.getEstrutura);
router.post("/salas", requireAuth, requireAdminOrHR, controller.createSala);
router.patch("/salas/:id", requireAuth, requireAdminOrHR, controller.updateSala);

router.get("/ocupacao", requireAuth, controller.getOcupacao);
router.get("/ocupacao-semana", requireAuth, controller.getOcupacaoSemana);
router.get("/ocupacao-mes", requireAuth, controller.getOcupacaoMes);

router.post("/reservas", requireAuth, controller.createReserva);
router.get("/reservas/minhas", requireAuth, controller.getMinhasReservas);
router.patch("/reservas/:salaId/:data/:id", requireAuth, controller.updateReserva);
router.delete("/reservas/:salaId/:data/:id", requireAuth, controller.cancelReserva);

router.post("/pedidos", requireAuth, controller.createPedido);
router.get("/pedidos", requireAuth, controller.getPedidos);
router.post("/pedidos/:salaId/grupo/:grupoId/cancelar", requireAuth, controller.cancelarPedido);
router.post("/pedidos/:salaId/:id/aceitar", requireAuth, controller.aceitarPedido);
router.post("/pedidos/:salaId/:id/recusar", requireAuth, controller.recusarPedido);

module.exports = router;
