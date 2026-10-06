const admin = require("firebase-admin");
const { resolveTargetUid, calcularMinutosFaltaDia } = require("./helpers");
const { computeAnnualOvertimeBalance } = require("./reportsController");
const {
  ESTADOS_HORA_EXTRA: ESTADOS,
  camposAprovacao,
  camposDecisao,
  formatarMinutos,
  listarGestoresRHParaNotificar,
  enviarEmailGestoresRH,
} = require("./overtimeApprovalController");
const { refreshFechoMensalSnapshotIfClosed } = require("../../shared/lib/monthLock");
const { isSuperAdmin } = require("../../shared/middleware/auth");
const db = admin.firestore();

// Compensação de horas: pedido -> pendente -> decisão da GestorRH -> compensação efetiva.
//
// O botão "Compensar" (CompensateOvertimeButton) só cria um PEDIDO em
// registo-ponto/{uid}/PedidosCompensacao/{id} (estado "pendente" - mesmos estados e
// mesmos campos de decisão das horas extra manuais, ver overtimeApprovalController.js).
// Um pedido pendente ou rejeitado não toca no registo do dia: a compensação EFETIVA
// continua a ser só o campo "horas_compensatorias" em Registos/registo_DDMMYYYY, que só
// é gravado aqui ao APROVAR. Como tudo o resto (saldo anual em
// computeAnnualOvertimeBalance, coluna "Compensação Horas", faltas no fecho mensal) lê
// esse campo, um pedido pendente não consome saldo, não conta como compensação usada e
// o dia continua a ser tratado como não compensado.

function parseData(date) {
  if (!date || !/^\d{2}-\d{2}-\d{4}$/.test(date)) return null;
  const [dd, mm, yyyy] = date.split("-").map(Number);
  const dataAtual = new Date(yyyy, mm - 1, dd);
  if (dataAtual.getDate() !== dd || dataAtual.getMonth() !== mm - 1) return null;
  return { dd, mm, yyyy, dataAtual };
}

function registoRefFor(uid, { dd, mm, yyyy }) {
  return db.collection("registo-ponto").doc(uid).collection("Registos")
    .doc(`registo_${String(dd).padStart(2, "0")}${String(mm).padStart(2, "0")}${yyyy}`);
}

// Regras de uma compensação - verificadas ao pedir E de novo ao aprovar, porque entre as
// duas coisas o saldo (outras compensações aprovadas entretanto) ou o próprio dia (já
// compensado) podem ter mudado. Poder compensar depende APENAS de haver saldo de horas
// extra aprovadas - não do défice do dia (um dia com 8h ou mais, ou ao fim de semana,
// também pode ser compensado); minutosFalta é calculado só como informação.
// "semLimites" (só no PEDIDO feito por um SuperAdmin, ver requestCompensation): ignora o
// saldo, para se poder testar o fluxo/email. A aprovação valida sempre o saldo, por isso
// nunca resulta numa compensação sem saldo.
async function validarCompensacao(uid, date, minutosPedidos, { semLimites = false } = {}) {
  const parsed = parseData(date);
  if (!parsed) return { error: "Campo obrigatório: date (formato DD-MM-YYYY)" };
  if (!Number.isInteger(minutosPedidos) || minutosPedidos <= 0) {
    return { error: "Indica quantos minutos queres compensar" };
  }
  if (minutosPedidos > 1440) {
    return { error: "Não é possível compensar mais de 24h num dia" };
  }

  const registoRef = registoRefFor(uid, parsed);
  const registoDoc = await registoRef.get();
  const registo = registoDoc.exists ? registoDoc.data() : null;

  if (registo?.horas_compensatorias > 0) {
    return { error: "Este dia já foi compensado" };
  }

  const minutosFalta = registo?.horaEntrada && registo?.horaSaida
    ? calcularMinutosFaltaDia(registo.horaEntrada, registo.horaSaida, parsed.dataAtual)
    : (parsed.dataAtual.getDay() === 0 || parsed.dataAtual.getDay() === 6 ? 0 : 480);

  // Saldo = horas extra APROVADAS menos compensações já APROVADAS (pedidos pendentes não
  // entram, ver nota no topo).
  const { netMinutes } = await computeAnnualOvertimeBalance(uid, parsed.yyyy);
  if (!semLimites && netMinutes < minutosPedidos) {
    return { error: "Saldo anual de horas extra aprovadas insuficiente para compensar este dia" };
  }

  return { parsed, registoRef, registoDoc, minutosFalta, netMinutes };
}

function pedidosRef(uid) {
  return db.collection("registo-ponto").doc(uid).collection("PedidosCompensacao");
}

function serializarPedido(doc) {
  const data = doc.data();
  return {
    id: doc.id,
    date: data.date,
    minutos: data.minutos || 0,
    minutosFalta: data.minutosFalta || 0,
    saldoDisponivel: data.saldoDisponivel ?? null,
    requestedByNome: data.requestedByNome || null,
    ...camposAprovacao(data),
  };
}

async function notificarGestoresRHCompensacao({ uid, colaboradorNome, entidade, pedido }) {
  try {
    const destinatarios = await listarGestoresRHParaNotificar(uid);
    if (destinatarios.length === 0) {
      console.warn(`[compensação] Nenhuma GestorRH com email para notificar do pedido de ${uid}`);
      return;
    }
    const [dd, mm, yyyy] = pedido.date.split("-");
    const dados = {
      colaboradorNome: colaboradorNome || "um colaborador",
      data: `${dd}/${mm}/${yyyy}`,
      horas: formatarMinutos(pedido.minutos),
      saldoUtilizado: formatarMinutos(pedido.minutos),
      saldoDisponivel: formatarMinutos(pedido.saldoDisponivel || 0),
      link: `https://magnaiso9001.comenius.pt/ponto/user-details/${uid}`,
      eyebrow: "Compensação de Horas",
    };
    await enviarEmailGestoresRH({
      destinatarios,
      subject: `Novo pedido de compensação pendente de aprovação - ${dados.colaboradorNome} (${dados.data})`,
      template: "compensacao-nova",
      dados,
      entidade,
      contexto: `pedido de compensação de ${uid}`,
    });
  } catch (error) {
    console.error(`Erro ao notificar GestorRH do pedido de compensação de ${uid}:`, error);
  }
}

// POST /compensate-short-day - cria o pedido (o próprio colaborador ou um admin/RH em
// nome de outro, via resolveTargetUid). Nunca grava nada no registo do dia.
const requestCompensation = async (req, res) => {
  try {
    const { date } = req.body;
    const minutosPedidos = parseInt(req.body.minutes);

    const { uid: userId, error: authError } = await resolveTargetUid(req);
    if (authError) return res.status(403).json({ error: authError });

    // SuperAdmin pode pedir sempre (qualquer dia, sem saldo) - p.ex. para testar o email.
    const validacao = await validarCompensacao(userId, date, minutosPedidos, { semLimites: isSuperAdmin(req.user?.nivelAcesso) });
    if (validacao.error) return res.status(400).json({ error: validacao.error });

    // Um só pedido pendente por dia - evita pedidos duplicados enquanto a GestorRH não
    // decide (depois de rejeitado já se pode pedir de novo).
    const pendenteDoDia = await pedidosRef(userId)
      .where("date", "==", date)
      .where("estado", "==", ESTADOS.PENDENTE)
      .limit(1)
      .get();
    if (!pendenteDoDia.empty) {
      return res.status(409).json({ error: "Já existe um pedido de compensação pendente de aprovação para este dia" });
    }

    const userDoc = userId === req.user.uid ? null : await db.collection("users").doc(userId).get();
    const colaborador = userId === req.user.uid ? (req.userData || {}) : (userDoc.exists ? userDoc.data() : {});

    const { dd, mm, yyyy } = validacao.parsed;
    const pedidoId = `compensacao_${String(dd).padStart(2, "0")}${String(mm).padStart(2, "0")}${yyyy}_${Date.now()}`;
    const pedido = {
      uid: userId,
      colaboradorNome: colaborador.nome || null,
      date,
      year: yyyy,
      minutos: minutosPedidos,
      minutosFalta: validacao.minutosFalta,
      // Saldo no momento do pedido - só informativo (email/lista de pendentes); o saldo é
      // sempre recalculado ao aprovar.
      saldoDisponivel: validacao.netMinutes,
      estado: ESTADOS.PENDENTE,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      requestedBy: req.user.uid,
      requestedByNome: req.userData?.nome || null,
      approvedAt: null,
      approvedBy: null,
      approvedByNome: null,
    };
    await pedidosRef(userId).doc(pedidoId).set(pedido);

    await notificarGestoresRHCompensacao({ uid: userId, colaboradorNome: pedido.colaboradorNome, entidade: colaborador.entidade, pedido });

    return res.status(201).json({
      message: "Pedido de compensação enviado - pendente de aprovação",
      pedidoId,
      estado: ESTADOS.PENDENTE,
    });
  } catch (error) {
    console.error("Erro ao pedir compensação:", error);
    return res.status(500).json({ error: error.message });
  }
};

// Pedidos de compensação pendentes de um colaborador (detalhe do colaborador, userStats.jsx).
const getPendingCompensations = async (req, res) => {
  try {
    const { uid: userId, error: authError } = await resolveTargetUid(req);
    if (authError) return res.status(403).json({ error: authError });

    const snapshot = await pedidosRef(userId).where("estado", "==", ESTADOS.PENDENTE).get();
    const pendentes = snapshot.docs.map(serializarPedido);
    const chave = (p) => p.date.split("-").reverse().join("");
    pendentes.sort((a, b) => chave(a).localeCompare(chave(b)));
    return res.status(200).json({ pendentes });
  } catch (error) {
    console.error("Erro ao buscar pedidos de compensação pendentes:", error);
    return res.status(500).json({ error: error.message });
  }
};

// Aprovar: volta a validar tudo (saldo, défice, dia ainda não compensado) e só então
// aplica a compensação ao dia - na mesma escrita em lote que marca o pedido aprovado.
const approveCompensation = async (req, res) => {
  try {
    const { uid, pedidoId } = req.body;
    if (!uid || !pedidoId) return res.status(400).json({ error: "Campos obrigatórios: uid, pedidoId" });
    if (uid === req.user.uid) {
      return res.status(403).json({ error: "Não é possível aprovar ou rejeitar a própria compensação" });
    }

    const pedidoRef = pedidosRef(uid).doc(pedidoId);
    const pedidoDoc = await pedidoRef.get();
    if (!pedidoDoc.exists) return res.status(404).json({ error: "Pedido de compensação não encontrado" });
    const pedido = pedidoDoc.data();
    if (pedido.estado !== ESTADOS.PENDENTE) {
      return res.status(409).json({ error: "Este pedido de compensação já não está pendente de aprovação" });
    }

    const validacao = await validarCompensacao(uid, pedido.date, pedido.minutos);
    if (validacao.error) {
      return res.status(409).json({ error: `Não é possível aprovar: ${validacao.error}` });
    }

    const updateRegisto = { horas_compensatorias: pedido.minutos, compensacaoPedidoId: pedidoId };
    if (!validacao.registoDoc.exists) {
      // Dia sem nenhum registo (falta total) - cria o documento só para guardar a
      // compensação. "timestamp" tem de ser a data compensada (é usado para saber a que
      // dia do mês pertence, ver registoPorDia em computeMonthlyAttendance).
      updateRegisto.timestamp = validacao.parsed.dataAtual;
    }

    const batch = db.batch();
    batch.set(validacao.registoRef, updateRegisto, { merge: true });
    batch.update(pedidoRef, camposDecisao(req, ESTADOS.APROVADA));
    await batch.commit();

    // A compensação de uma falta total muda a contagem de faltas desse mês.
    await refreshFechoMensalSnapshotIfClosed(uid, pedido.date, req.user.uid);

    return res.status(200).json({ message: "Compensação aprovada", estado: ESTADOS.APROVADA });
  } catch (error) {
    console.error("Erro ao aprovar compensação:", error);
    return res.status(500).json({ error: error.message });
  }
};

// Rejeitar: só marca o pedido - o registo do dia nunca foi tocado.
const rejectCompensation = async (req, res) => {
  try {
    const { uid, pedidoId, motivoRejeicao } = req.body;
    if (!uid || !pedidoId) return res.status(400).json({ error: "Campos obrigatórios: uid, pedidoId" });
    if (uid === req.user.uid) {
      return res.status(403).json({ error: "Não é possível aprovar ou rejeitar a própria compensação" });
    }

    const pedidoRef = pedidosRef(uid).doc(pedidoId);
    const pedidoDoc = await pedidoRef.get();
    if (!pedidoDoc.exists) return res.status(404).json({ error: "Pedido de compensação não encontrado" });
    if (pedidoDoc.data().estado !== ESTADOS.PENDENTE) {
      return res.status(409).json({ error: "Este pedido de compensação já não está pendente de aprovação" });
    }

    await pedidoRef.update(camposDecisao(req, ESTADOS.REJEITADA, motivoRejeicao));
    return res.status(200).json({ message: "Compensação rejeitada", estado: ESTADOS.REJEITADA });
  } catch (error) {
    console.error("Erro ao rejeitar compensação:", error);
    return res.status(500).json({ error: error.message });
  }
};

// Contagem de pedidos de compensação pendentes por colaborador (aviso na lista de
// /ponto/entidades) - mesmo padrão/fallback de getUidsComHorasExtraPendentes.
const FAILED_PRECONDITION = 9;
const getUidsComCompensacoesPendentes = async (req, res) => {
  try {
    let snapshot;
    try {
      snapshot = await db.collectionGroup("PedidosCompensacao").where("estado", "==", ESTADOS.PENDENTE).get();
    } catch (queryError) {
      if (queryError.code !== FAILED_PRECONDITION) throw queryError;
      console.warn("[getUidsComCompensacoesPendentes] Índice collection group de PedidosCompensacao.estado em falta - a usar leitura completa:", queryError.message);
      snapshot = await db.collectionGroup("PedidosCompensacao").get();
    }
    const contagemPorUid = {};
    snapshot.forEach((doc) => {
      if (doc.data().estado !== ESTADOS.PENDENTE) return;
      if (doc.ref.parent.parent?.parent?.id !== "registo-ponto") return;
      const uid = doc.ref.parent.parent.id;
      contagemPorUid[uid] = (contagemPorUid[uid] || 0) + 1;
    });
    return res.status(200).json({ contagemPorUid });
  } catch (error) {
    console.error("Erro ao contar pedidos de compensação pendentes:", error);
    return res.status(500).json({ error: error.message });
  }
};

module.exports = {
  requestCompensation,
  getPendingCompensations,
  approveCompensation,
  rejectCompensation,
  getUidsComCompensacoesPendentes,
};
