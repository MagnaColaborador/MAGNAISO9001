const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin, requireAdminOrHR, requireAdminOrEntidadeAdmin } = require('../../shared/middleware/auth');
const {
  createUser,
  sendWelcomeEmailTest,
  userDetails,
  getUsersByEntity,
  updateUserDetails,
  deleteUser,
} = require('./userManagementController');
const {
  registerEntry,
  checkEntry,
  registerLeave,
  checkLeave,
  checkTimeTracking,
  updateUserTime,
  deleteRegister,
  registerManualOvertime,
  getManualOvertimeForMonth,
  updateManualOvertime,
  deleteManualOvertime,
  debugCorruptOvertime,
  deleteCorruptOvertime,
} = require('./timeTrackingController');
const {
  createVacation,
  approveVacation,
  rejectVacation,
  createMedicalLeave,
  getPendingMedicalLeaves,
  approveMedicalLeave,
  rejectMedicalLeave,
  getPendingVacations,
  getAllUsersVacations,
} = require('./vacationController');
const {
  requestTimeEdit,
  getPendingTimeEdits,
  approveTimeEdit,
  rejectTimeEdit,
  getUidsComAjustesPendentes,
} = require('./timeEditRequestController');
const {
  getUserRecords,
  getOvertimeSummary,
  getOvertimeBalance,
  getYearlySummary,
} = require('./reportsController');
const { ping } = require('./utilsController');
const {
  getPendingManualOvertime,
  approveManualOvertime,
  rejectManualOvertime,
  getUidsComHorasExtraPendentes,
} = require('./overtimeApprovalController');
const {
  requestCompensation,
  getPendingCompensations,
  approveCompensation,
  rejectCompensation,
  getUidsComCompensacoesPendentes,
} = require('./compensationApprovalController');
const {
  getVacationMap,
  toggleVacationDay,
  toggleBirthdayDay,
  setVacationQuotaOverride,
  setVacationCarryover,
} = require('./vacationMapController');

// Auto-serviço (qualquer utilizador autenticado, sobre os seus próprios dados)
//
// NOTA: não há rotas próprias de verificação de token / primeiro login aqui  - 
// a app fundida usa só as do Magna (/users/verifyTokenAndGetUserInfo e
// /users/update-first-login), que já cobrem exatamente a mesma necessidade.
router.post("/registerEntry", requireAuth, registerEntry);
router.post("/registerLeave", requireAuth, registerLeave);
router.post("/calendar", requireAuth, getUserRecords);
router.post("/checkEntry", requireAuth, checkEntry);
router.post("/checkLeave", requireAuth, checkLeave);
router.post("/checkTimeTracking", requireAuth, checkTimeTracking);
router.post("/update-time", requireAuth, updateUserTime);
router.post("/vacation", requireAuth, createVacation);
router.post("/medicalLeave", requireAuth, createMedicalLeave);
// Pedido de alteração das horas de um dia passado: um Colaborador só pode pedir sobre
// si próprio (fica pendente); GestorRH/Administrador(própria entidade)/SuperAdmin podem
// aprovar/rejeitar ou editar em nome de outro (aplica-se de imediato)  -  autorização
// fina feita dentro do controller via resolveTargetUid, tal como em /vacation.
router.post("/request-time-edit", requireAuth, requestTimeEdit);
router.post("/pending-time-edits", requireAuth, getPendingTimeEdits);
router.post("/approve-time-edit", requireAuth, approveTimeEdit);
router.post("/reject-time-edit", requireAuth, rejectTimeEdit);
router.post("/overtime-summary", requireAuth, getOvertimeSummary);
// Só o saldo anual de horas extra (o que /ponto e o detalhe do colaborador usam) - sem
// ler todos os Registos do ano como /overtime-summary (ver getOvertimeBalance).
router.post("/overtime-balance", requireAuth, getOvertimeBalance);
router.post("/yearly-summary", requireAuth, getYearlySummary);
router.post("/register-manual-overtime", requireAuth, registerManualOvertime);
router.post("/get-manual-overtime", requireAuth, getManualOvertimeForMonth);
router.put("/update-manual-overtime", requireAuth, updateManualOvertime);
router.delete("/delete-manual-overtime", requireAuth, deleteManualOvertime);
// Aprovação de horas extra manuais: só GestorRH (e SuperAdmin) - ver overtimeApprovalController.js.
router.post("/pending-manual-overtime", requireAuth, requireAdminOrHR, getPendingManualOvertime);
router.post("/approve-manual-overtime", requireAuth, requireAdminOrHR, approveManualOvertime);
router.post("/reject-manual-overtime", requireAuth, requireAdminOrHR, rejectManualOvertime);
router.post("/pending-manual-overtime-uids", requireAuth, requireAdminOrHR, getUidsComHorasExtraPendentes);
// "Compensar" cria só um pedido pendente; a compensação efetiva só é aplicada ao aprovar
// (GestorRH/SuperAdmin) - ver compensationApprovalController.js.
router.post("/compensate-short-day", requireAuth, requestCompensation);
router.post("/pending-compensations", requireAuth, requireAdminOrHR, getPendingCompensations);
router.post("/approve-compensation", requireAuth, requireAdminOrHR, approveCompensation);
router.post("/reject-compensation", requireAuth, requireAdminOrHR, rejectCompensation);
router.post("/pending-compensations-uids", requireAuth, requireAdminOrHR, getUidsComCompensacoesPendentes);
router.get("/ping", requireAuth, ping);
// Calendário de férias de toda a equipa  -  informação visível a qualquer
// colaborador autenticado (não é dado sensível de admin), usado tanto pela
// vista de admin como pelo calendário que aparece ao próprio colaborador.
router.post("/all-vacations", requireAuth, getAllUsersVacations);

// Mapa de férias (grelha company-wide): leitura aberta a qualquer autenticado;
// escrita permite auto-edição da própria linha OU edição de outra linha por
// admin/GestorRH  -  regra mista que não cabe em requireAdmin (só SuperAdmin)
// nem em requireAdminOrHR sozinho (bloquearia a auto-edição do próprio user),
// por isso a validação de permissão vive dentro do próprio controller.
router.post("/vacation-map", requireAuth, getVacationMap);
router.post("/toggle-vacation-day", requireAuth, toggleVacationDay);
// Dia de aniversário: mesma regra mista de permissão que o dia de férias
// (auto-edição ou admin/GestorRH), validada dentro do controller.
router.post("/toggle-birthday-day", requireAuth, toggleBirthdayDay);
router.post("/vacation-quota-override", requireAuth, requireAdminOrHR, setVacationQuotaOverride);
router.post("/vacation-carryover", requireAuth, requireAdminOrHR, setVacationCarryover);

// Administração (gestão de outros utilizadores / dados cross-user)
//
// userDetails/createUser/byEntity/updateUserDetails/deleteUser também aceitam
// "Administrador"  -  o nível intermédio só gere colaboradores da sua própria
// entidade, restrição validada dentro de cada controller (não cabe num middleware
// que não conhece a entidade do colaborador-alvo). As restantes ações desta secção
// (aprovação de férias, processamento de horas extras, etc.) continuam exclusivas
// de SuperAdmin, tal como já não estavam disponíveis para GestorRH.
router.post("/userDetails", requireAuth, requireAdminOrEntidadeAdmin, userDetails);
router.post('/createUser', requireAuth, requireAdminOrEntidadeAdmin, createUser);
// Só SuperAdmin: envia um email com conteúdo livre para qualquer endereço a partir da
// conta no-reply - ferramenta de verificação, não faz parte do fluxo de criação de contas.
router.post('/welcomeEmail/test', requireAuth, requireAdmin, sendWelcomeEmailTest);
router.post("/byEntity", requireAuth, requireAdminOrEntidadeAdmin, getUsersByEntity);
router.post("/updateUserDetails", requireAuth, requireAdminOrEntidadeAdmin, updateUserDetails);
router.post("/approve-vacation", requireAuth, requireAdmin, approveVacation);
router.post("/reject-vacation", requireAuth, requireAdmin, rejectVacation);
router.post("/pending-vacations", requireAuth, requireAdmin, getPendingVacations);
router.post("/pending-medical-leaves", requireAuth, requireAdmin, getPendingMedicalLeaves);
router.post("/approve-medical-leave", requireAuth, requireAdmin, approveMedicalLeave);
router.post("/reject-medical-leave", requireAuth, requireAdmin, rejectMedicalLeave);
router.post("/debug-corrupt-overtime", requireAuth, requireAdmin, debugCorruptOvertime);
router.post("/delete-corrupt-overtime", requireAuth, requireAdmin, deleteCorruptOvertime);
router.delete("/deleteRegister", requireAuth, requireAdmin, deleteRegister);
router.post("/deleteUser", requireAuth, requireAdminOrEntidadeAdmin, deleteUser);
// Aviso de alterações de horas por aprovar na lista de /ponto/entidades - o Administrador só recebe os da sua entidade (filtragem no controller).
router.post("/pending-time-edits-uids", requireAuth, requireAdminOrEntidadeAdmin, getUidsComAjustesPendentes);

module.exports = router;
