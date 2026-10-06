// Estados de uma hora extra manual - espelho de ESTADOS_HORA_EXTRA em
// api/domains/timeTracking/overtimeApprovalController.js. Registos antigos (antes de
// existir aprovação) vêm do backend já com estado "aprovada".
export const ESTADOS_HORA_EXTRA = { PENDENTE: 'pendente', APROVADA: 'aprovada', REJEITADA: 'rejeitada' };

export const LABEL_ESTADO_HORA_EXTRA = {
  pendente: 'Pendente',
  aprovada: 'Aprovada',
  rejeitada: 'Rejeitada',
};

export const estadoHoraExtra = (entry) => entry?.estado || ESTADOS_HORA_EXTRA.APROVADA;

// Só as aprovadas contam para totais (mês/ano, Excel) - igual ao backend.
export const minutosHorasExtraAprovadas = (entries = []) =>
  entries
    .filter((e) => estadoHoraExtra(e) === ESTADOS_HORA_EXTRA.APROVADA)
    .reduce((sum, e) => sum + (e.totalMinutes || 0), 0);

// Há já um pedido de compensação pendente para o dia (ver CompensationCell.jsx)?
export const temPedidoCompensacaoPendente = (item) =>
  (item?.compensationRequests || []).some((p) => estadoHoraExtra(p) === ESTADOS_HORA_EXTRA.PENDENTE);

// Regra única para mostrar a ação "Compensar" - usada pela coluna "Compensação Horas" e
// pelo menu de contexto das tabelas de ponto (colaborador e admin). Depende APENAS de a
// pessoa ter saldo de horas extra aprovadas (não do défice/horas do dia), desde que o dia
// ainda não esteja compensado nem tenha um pedido pendente. O SuperAdmin pode pedir sem
// saldo (ver compensateOvertimeButton.jsx); a aprovação valida sempre o saldo no backend.
export const podeCompensarDia = (item, { isSuperAdmin = false, saldoMinutos = 0 } = {}) => {
  if (!item || item.compensated || temPedidoCompensacaoPendente(item)) return false;
  return isSuperAdmin || (saldoMinutos || 0) > 0;
};
