const admin = require("firebase-admin");
const db = admin.firestore();
const ID_DOC = admin.firestore.FieldPath.documentId();
const { isAdminOrHR } = require("../../shared/middleware/auth");
const { sendMail, renderEmail } = require("../../shared/services/mailer");
const { isLocalTrabalhoValido } = require("../../shared/lib/locaisTrabalho");
const { normalizeEntityId } = require("../../shared/lib/normalizeEntityId");
const {
  dataValida,
  validarHorario,
  agoraLisboa,
  jaPassou,
  sobrepoe,
  encontrarConflitos,
  aplicarGrupo,
} = require("./salasLogic");

// Modelo de dados (Requisição de Salas) - tudo dentro da coleção "salas":
//   salas/{salaId}                        { nome, sede, ativa, createdAt } - o ID é o nome
//                                         normalizado (ex: "Amesterdão" -> "amesterdao"), mesma
//                                         convenção de users/entidades; "sede" é o local
//                                         de trabalho, o mesmo valor de users/{uid}.sede no
//                                         Cadastro, validado contra shared/lib/locaisTrabalho.js.
//   salas/{salaId}/reservas/{AAAA-MM-DD}  { data, uids, reservas: [{ id, uid, nome, descricao,
//                                         inicio, fim }] } - todas as reservas de uma sala num
//                                         dia, num único documento (é o único sítio onde uma
//                                         reserva existe): 1 read para ver/validar o dia
//                                         inteiro, e é o documento que serializa todas as
//                                         escritas desse dia (todas as transações que mexem em
//                                         reservas dessa sala/dia leem-no e escrevem-no, por
//                                         isso duas reservas simultâneas nunca passam as duas).
//                                         "uids" (quem tem reservas nesse dia) serve "as minhas
//                                         reservas". Cancelar retira a reserva da lista; um dia
//                                         sem reservas é apagado.
//   salas/{salaId}/pedidos/{AAAA-MM-DD}_{id}  pedido de Y ao dono de UMA reserva em conflito
//                                         nessa sala (o ID começa pela data do pedido); os
//                                         pedidos feitos de uma vez (um por cada reserva que
//                                         impede o horário de Y) partilham o mesmo grupoId e só
//                                         são aplicados quando todos os donos aceitarem.
// Sem índices compostos: as consultas "do próprio" (reservas/pedidos) são feitas sala a sala,
// com igualdades (que o Firestore combina sozinho) e, para limitar por datas, um intervalo no
// ID do documento (que começa sempre pela data) - nada a configurar na consola.

const salasCol = db.collection("salas");
const diaRef = (salaId, data) => salasCol.doc(salaId).collection("reservas").doc(data);
const pedidosDaSala = (salaId) => salasCol.doc(salaId).collection("pedidos");
const novoId = () => salasCol.doc().id;
const MAX_SALAS_POR_PEDIDO = 30;

// Grava a lista de reservas de uma sala/dia dentro de uma transação (mantém "uids" em
// linha com a lista; um dia que fica vazio é apagado).
function gravarDia(tx, ref, data, reservas) {
  if (!reservas.length) {
    tx.delete(ref);
    return;
  }
  tx.set(ref, {
    data,
    uids: [...new Set(reservas.map((r) => r.uid))],
    reservas,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

const LINK_PAGINA = "https://magnaiso9001.comenius.pt/requisicao-salas";
const MAX_MENSAGEM = 500;
const MAX_DESCRICAO = 300;
const MAX_ANTERIORES = 100;
const DIAS_ANTERIORES = 365;

class HttpError extends Error {
  constructor(status, error, extra = {}) {
    super(error);
    this.status = status;
    this.payload = { error, ...extra };
  }
}

function responderErro(res, error, contexto) {
  if (error instanceof HttpError) return res.status(error.status).json(error.payload);
  console.error(`${contexto}:`, error);
  return res.status(500).json({ error: error.message });
}

const formatarData = (data) => data.split("-").reverse().join("/");
const horarioTxt = (h) => `${h.inicio}–${h.fim}`;
// A descrição vive no documento do dia: todos os colaboradores veem os detalhes de cada
// reserva na timeline do dia sem leituras extra.
const publicoReserva = (r, uid) => ({
  id: r.id, uid: r.uid, nome: r.nome, inicio: r.inicio, fim: r.fim, descricao: r.descricao || "", propria: r.uid === uid,
});

// Descrição (motivo) da reserva - obrigatória em todas as reservas, incluindo a que é criada
// quando um pedido de alteração é aceite (fica guardada no pedido até lá).
function lerDescricao(body) {
  const descricao = typeof body?.descricao === "string" ? body.descricao.trim() : "";
  if (!descricao) throw new HttpError(400, "A descrição da reserva é obrigatória");
  if (descricao.length > MAX_DESCRICAO) throw new HttpError(400, `A descrição não pode ter mais de ${MAX_DESCRICAO} carateres`);
  return descricao;
}

function lerHorario(body) {
  const horario = { inicio: body?.inicio, fim: body?.fim };
  const erro = validarHorario(horario);
  if (erro) throw new HttpError(400, erro);
  return horario;
}

async function lerSalaAtiva(salaId) {
  if (!salaId || typeof salaId !== "string") throw new HttpError(400, "Sala é obrigatória");
  const salaDoc = await salasCol.doc(salaId).get();
  if (!salaDoc.exists || salaDoc.data().ativa === false) throw new HttpError(404, "Sala não encontrada");
  const sala = salaDoc.data();
  // Um local retirado da lista de locais de trabalho deixa de aceitar reservas.
  if (!isLocalTrabalhoValido(sala.sede)) throw new HttpError(404, "Sala não encontrada");
  return { id: salaDoc.id, nome: sala.nome, sede: sala.sede };
}

// ---------------------------------------------------------------------------
// Notificações (email) - nunca deixam um erro de envio desfazer a operação, que já está
// gravada quando isto é chamado (mesmo padrão de notificarGestorasQualidade).
// ---------------------------------------------------------------------------

async function notificar(avisos) {
  if (!avisos.length) return;
  try {
    const uids = [...new Set(avisos.map((a) => a.uid))];
    const docs = await db.getAll(...uids.map((uid) => db.collection("users").doc(uid)));
    const users = new Map(docs.filter((d) => d.exists).map((d) => [d.id, d.data()]));

    const resultados = await Promise.allSettled(avisos.map((a) => {
      const u = users.get(a.uid);
      if (!u?.email) return Promise.reject(new Error(`utilizador ${a.uid} sem email`));
      return sendMail({
        to: u.email,
        subject: a.assunto,
        entidade: u.entidade,
        html: renderEmail("sala-reserva-aviso", {
          nome: u.nome || "",
          eyebrow: "Requisição de Salas",
          paragrafos: a.paragrafos,
          detalhes: a.detalhes || [],
          link: LINK_PAGINA,
        }),
      });
    }));
    resultados.forEach((r, i) => {
      if (r.status === "rejected") console.error(`Erro ao enviar aviso de reserva de sala (${avisos[i].assunto}):`, r.reason);
    });
  } catch (error) {
    console.error("Erro ao enviar avisos de reserva de sala:", error);
  }
}

const detalhesPedido = (p) => [
  { label: "Sala", valor: `${p.salaNome} (${p.sede})` },
  ...(p.descricao ? [{ label: "Motivo do pedido", valor: p.descricao }] : []),
  { label: "Data", valor: formatarData(p.data) },
  { label: `Reserva de ${p.donoNome}`, valor: horarioTxt(p.horarioAtual) },
  { label: `Horário pretendido por ${p.requerenteNome}`, valor: horarioTxt(p.horarioPretendido) },
];

// ---------------------------------------------------------------------------
// Salas
// ---------------------------------------------------------------------------

// Todas as salas numa só resposta - são poucas dezenas de documentos e o frontend pede-as
// uma única vez ao abrir a página. Os locais de trabalho em si não vêm daqui (nem do
// Firestore): o frontend obtém-nos em GET /config/locais-trabalho. Quem não é
// SuperAdmin/GestorRH só recebe as salas ativas de locais válidos.
const getEstrutura = async (req, res) => {
  try {
    const salasSnap = await salasCol.get();
    const gestor = isAdminOrHR(req.user?.nivelAcesso);
    const salas = salasSnap.docs
      .map((d) => ({ id: d.id, nome: d.data().nome, sede: d.data().sede, ativa: d.data().ativa !== false }))
      .filter((s) => gestor || (s.ativa && isLocalTrabalhoValido(s.sede)))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt"));
    return res.status(200).json({ salas });
  } catch (error) {
    return responderErro(res, error, "Erro ao obter salas");
  }
};

function lerNome(body) {
  const nome = typeof body?.nome === "string" ? body.nome.trim() : "";
  if (!nome || nome.length > 100) throw new HttpError(400, "Nome inválido");
  return nome;
}

// Validação server-side do local de trabalho contra a lista do backend - sem reads e sem
// depender de existirem colaboradores nesse local.
function lerSede(body) {
  if (!isLocalTrabalhoValido(body?.sede)) throw new HttpError(400, "Local de trabalho inválido");
  return body.sede;
}

// O ID da sala é o nome normalizado (normalizeEntityId, como users/entidades). Se já existir
// uma sala com esse ID (o mesmo nome noutro local, ex: "Sala de Reuniões 1" no Porto e em
// Lisboa), junta-se o local ao ID; o mesmo nome no mesmo local é recusado. Criação dentro de
// uma transação, para dois pedidos simultâneos nunca escreverem no mesmo ID. O ID não muda se
// a sala for renomeada depois (as reservas e pedidos vivem por baixo dele).
const createSala = async (req, res) => {
  try {
    const nome = lerNome(req.body);
    const sede = lerSede(req.body);
    const base = normalizeEntityId(nome);
    if (!base) throw new HttpError(400, "Nome inválido");
    const candidatos = [base, `${base}-${normalizeEntityId(sede)}`];

    const id = await db.runTransaction(async (tx) => {
      const docs = await Promise.all(candidatos.map((c) => tx.get(salasCol.doc(c))));
      const mesmoLocal = docs.find((d) => d.exists && d.data().sede === sede && normalizeEntityId(d.data().nome) === base);
      if (mesmoLocal) throw new HttpError(409, `Já existe uma sala "${mesmoLocal.data().nome}" em ${sede}`);
      const livre = candidatos.find((c, i) => !docs[i].exists);
      if (!livre) throw new HttpError(409, "Já existe uma sala com este nome");
      tx.set(salasCol.doc(livre), { nome, sede, ativa: true, createdAt: admin.firestore.FieldValue.serverTimestamp() });
      return livre;
    });
    return res.status(201).json({ sala: { id, nome, sede, ativa: true } });
  } catch (error) {
    return responderErro(res, error, "Erro ao criar sala");
  }
};

// Editar nome/local/ativar/desativar - nunca se apaga uma sala, para não perder as suas
// reservas e pedidos (subcoleções); uma desativada deixa de aparecer e de aceitar novas
// reservas. As reservas não guardam nome nem local da sala, por isso nada mais muda.
const updateSala = async (req, res) => {
  try {
    const ref = salasCol.doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) throw new HttpError(404, "Sala não encontrada");
    const updates = {};
    if (req.body?.nome !== undefined) updates.nome = lerNome(req.body);
    if (req.body?.sede !== undefined) updates.sede = lerSede(req.body);
    if (req.body?.ativa !== undefined) updates.ativa = req.body.ativa === true;
    if (!Object.keys(updates).length) throw new HttpError(400, "Nada para atualizar");

    await ref.update(updates);
    return res.status(200).json({ message: "Sala atualizada" });
  } catch (error) {
    return responderErro(res, error, "Erro ao atualizar sala");
  }
};

// ---------------------------------------------------------------------------
// Ocupação / disponibilidade
// ---------------------------------------------------------------------------

// Salas a consultar num pedido de ocupação: ?salaId=, ?salaIds=a,b,c (o frontend já sabe
// as salas do local - evita ler a coleção salas) ou, em último caso, ?sede= (lê as salas
// desse local).
async function salasDoPedido(query) {
  if (query.salaId) return [String(query.salaId)];
  if (query.salaIds) {
    const ids = [...new Set(String(query.salaIds).split(",").map((x) => x.trim()).filter(Boolean))];
    if (!ids.length || ids.length > MAX_SALAS_POR_PEDIDO) throw new HttpError(400, "Lista de salas inválida");
    return ids;
  }
  if (query.sede) {
    if (!isLocalTrabalhoValido(query.sede)) throw new HttpError(400, "Local de trabalho inválido");
    return (await salasCol.where("sede", "==", query.sede).get()).docs.map((d) => d.id);
  }
  throw new HttpError(400, "Indique o local de trabalho ou as salas");
}

// Ocupação de um dia: 1 read por sala pedida (o documento desse dia dessa sala) - nunca lê
// reservas de outros dias nem de outras salas.
const getOcupacao = async (req, res) => {
  try {
    const { data } = req.query;
    if (!dataValida(data)) throw new HttpError(400, "Data inválida (formato esperado AAAA-MM-DD)");
    const salaIds = await salasDoPedido(req.query);

    const docs = salaIds.length ? await db.getAll(...salaIds.map((id) => diaRef(id, data))) : [];
    const ocupacao = {};
    docs.forEach((d, i) => {
      if (!d.exists) return;
      ocupacao[salaIds[i]] = (d.data().reservas || [])
        .map((r) => publicoReserva(r, req.user.uid))
        .sort((a, b) => a.inicio.localeCompare(b.inicio));
    });
    return res.status(200).json({ data, ocupacao });
  } catch (error) {
    return responderErro(res, error, "Erro ao obter ocupação");
  }
};

// Ocupação de 7 dias seguidos (vista semanal): por sala, um range de datas na sua
// subcoleção "reservas" (índice automático, sem índice composto) - 1 read por sala/dia com
// reservas (ou 1 por sala, se a semana estiver vazia). Devolve os 7 dias, mesmo os vazios,
// para o frontend os poder guardar na cache de ocupação diária.
const getOcupacaoSemana = async (req, res) => {
  try {
    const { inicio } = req.query;
    if (!dataValida(inicio)) throw new HttpError(400, "Data inválida (formato esperado AAAA-MM-DD)");
    const salaIds = await salasDoPedido({ salaIds: req.query.salaIds, sede: req.query.sede });

    const [a, m, d] = inicio.split("-").map(Number);
    const datas = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(a, m - 1, d + i)).toISOString().slice(0, 10));
    const snaps = await Promise.all(salaIds.map((id) => salasCol.doc(id).collection("reservas")
      .where("data", ">=", datas[0]).where("data", "<=", datas[6]).get()));

    const dias = Object.fromEntries(datas.map((data) => [data, {}]));
    snaps.forEach((snap, i) => {
      snap.docs.forEach((doc) => {
        const { data, reservas = [] } = doc.data();
        if (!dias[data] || !reservas.length) return;
        dias[data][salaIds[i]] = reservas
          .map((r) => publicoReserva(r, req.user.uid))
          .sort((x, y) => x.inicio.localeCompare(y.inicio));
      });
    });
    return res.status(200).json({ inicio: datas[0], fim: datas[6], dias });
  } catch (error) {
    return responderErro(res, error, "Erro ao obter ocupação da semana");
  }
};

// Resumo de um mês das salas de um local (para marcar no calendário os dias com reservas):
// por sala, um range de datas na sua própria subcoleção "reservas" (índice automático, sem
// índice composto) - 1 read por sala/dia com reservas. Só devolve contagens.
const getOcupacaoMes = async (req, res) => {
  try {
    const { mes } = req.query;
    if (typeof mes !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new HttpError(400, "Mês inválido (formato esperado AAAA-MM)");
    const salaIds = await salasDoPedido({ salaIds: req.query.salaIds, sede: req.query.sede });

    const snaps = await Promise.all(salaIds.map((id) => salasCol.doc(id).collection("reservas")
      .where("data", ">=", `${mes}-01`).where("data", "<=", `${mes}-31`).get()));

    const dias = {};
    snaps.flatMap((snap) => snap.docs).forEach((d) => {
      const reservas = d.data().reservas || [];
      if (!reservas.length) return;
      const dia = dias[d.data().data] || (dias[d.data().data] = { reservas: 0, salas: 0, propria: false });
      dia.reservas += reservas.length;
      dia.salas += 1;
      dia.propria = dia.propria || reservas.some((r) => r.uid === req.user.uid);
    });
    return res.status(200).json({ sede: req.query.sede || null, mes, dias });
  } catch (error) {
    return responderErro(res, error, "Erro ao obter ocupação do mês");
  }
};

// ---------------------------------------------------------------------------
// Reservas
// ---------------------------------------------------------------------------

// Cria uma reserva sem aprovação. A verificação de conflitos é feita dentro da transação
// sobre o documento de ocupação da sala/dia, por isso duas pessoas a reservar ao mesmo
// tempo o mesmo horário nunca ficam as duas com a reserva - a segunda transação é
// repetida pelo Firestore, já vê a primeira reserva e recebe 409 com os conflitos.
const createReserva = async (req, res) => {
  try {
    const { salaId, data } = req.body;
    if (!dataValida(data)) throw new HttpError(400, "Data inválida (formato esperado AAAA-MM-DD)");
    const horario = lerHorario(req.body);
    if (jaPassou(data, horario.inicio)) throw new HttpError(400, "Não é possível reservar no passado");
    const descricao = lerDescricao(req.body);

    const sala = await lerSalaAtiva(salaId);
    const { uid, nome } = req.user;
    const ref = diaRef(sala.id, data);
    const id = novoId();

    await db.runTransaction(async (tx) => {
      const diaDoc = await tx.get(ref);
      const reservas = diaDoc.exists ? diaDoc.data().reservas || [] : [];
      const conflitos = encontrarConflitos(reservas, horario);
      if (conflitos.length) {
        throw new HttpError(409, "Horário indisponível", { conflitos: conflitos.map((r) => publicoReserva(r, uid)) });
      }
      gravarDia(tx, ref, data, [...reservas, { id, uid, nome: nome || "", descricao, ...horario }]);
    });

    return res.status(201).json({ message: "Reserva efetuada com sucesso", reserva: { id, salaId: sala.id, data, descricao, ...horario } });
  } catch (error) {
    return responderErro(res, error, "Erro ao criar reserva");
  }
};

// Reservas do próprio: em cada sala, os dias em que tem reservas (uids array-contains) num
// intervalo de datas aplicado ao ID do documento (= a data) - índices automáticos, sem índice
// composto. Por omissão a partir de hoje; com ?periodo=anteriores, as dos últimos
// DIAS_ANTERIORES dias, das mais recentes para as mais antigas e limitadas a MAX_ANTERIORES.
const getMinhasReservas = async (req, res) => {
  try {
    const { uid } = req.user;
    const anteriores = req.query?.periodo === "anteriores";
    const hojeLisboa = agoraLisboa().data;
    const desde = new Date(`${hojeLisboa}T12:00:00Z`);
    desde.setUTCDate(desde.getUTCDate() - DIAS_ANTERIORES);

    const salasSnap = await salasCol.get();
    const porSala = await Promise.all(salasSnap.docs.map((sala) => {
      let q = sala.ref.collection("reservas").where("uids", "array-contains", uid);
      q = anteriores
        ? q.where(ID_DOC, ">=", desde.toISOString().slice(0, 10)).where(ID_DOC, "<", hojeLisboa)
        : q.where(ID_DOC, ">=", hojeLisboa);
      return q.get().then((snap) => ({ sala, snap }));
    }));

    const ordem = (a, b) => (a.data + a.inicio).localeCompare(b.data + b.inicio);
    let reservas = porSala.flatMap(({ sala, snap }) => snap.docs.flatMap((d) => (
      (d.data().reservas || []).filter((r) => r.uid === uid).map((r) => ({
        id: r.id, salaId: sala.id, salaNome: sala.data().nome, sede: sala.data().sede,
        data: d.data().data, inicio: r.inicio, fim: r.fim, descricao: r.descricao || "", estado: "ativa",
      }))
    ))).sort((a, b) => (anteriores ? ordem(b, a) : ordem(a, b)));
    if (anteriores) reservas = reservas.slice(0, MAX_ANTERIORES);
    return res.status(200).json({ reservas });
  } catch (error) {
    return responderErro(res, error, "Erro ao obter reservas");
  }
};

// Lê (dentro da transação) todos os pedidos ainda em curso que dependem de alguma das
// reservas indicadas, e os respetivos grupos completos - para os poder cancelar quando
// essas reservas mudam ou desaparecem. Só leituras (as escritas vêm depois, regra das
// transações do Firestore).
async function lerGruposAfetados(tx, salaId, reservaIds, excluirGrupoId = null) {
  if (!reservaIds.length) return [];
  const pedidosCol = pedidosDaSala(salaId);
  const afetados = await tx.get(pedidosCol.where("reservaId", "in", reservaIds.slice(0, 30)));
  const grupoIds = [...new Set(
    afetados.docs.filter((d) => d.data().ativo === true).map((d) => d.data().grupoId)
  )].filter((g) => g !== excluirGrupoId);
  if (!grupoIds.length) return [];
  const grupos = await tx.get(pedidosCol.where("grupoId", "in", grupoIds.slice(0, 30)));
  return grupos.docs.filter((d) => d.data().ativo === true);
}

function fecharPedidos(tx, docs, estado, motivo) {
  docs.forEach((d) => tx.update(d.ref, {
    estado,
    motivo: motivo || null,
    ativo: false,
    respondidoAt: admin.firestore.FieldValue.serverTimestamp(),
  }));
}

// Cancela uma reserva futura do próprio: a reserva é retirada da lista do dia (não fica
// nenhum registo "cancelada"; um dia que fica vazio é apagado). Só o dono a encontra: a
// reserva tem de estar na lista com o uid de quem pede, senão é 404. Pedidos de alteração
// pendentes sobre esta reserva deixam de fazer sentido e são cancelados (o requerente é
// avisado de que o horário pode ter ficado livre).
const cancelReserva = async (req, res) => {
  try {
    const { uid, nome } = req.user;
    const { salaId, data, id } = req.params;
    if (!dataValida(data)) throw new HttpError(400, "Data inválida (formato esperado AAAA-MM-DD)");
    const ref = diaRef(salaId, data);
    let gruposCancelados = [];

    await db.runTransaction(async (tx) => {
      const diaDoc = await tx.get(ref);
      const reservas = diaDoc.exists ? diaDoc.data().reservas || [] : [];
      const reserva = reservas.find((r) => r.id === id && r.uid === uid);
      if (!reserva) throw new HttpError(404, "Reserva não encontrada");
      if (jaPassou(data, reserva.inicio)) throw new HttpError(400, "Só é possível cancelar reservas futuras");

      const afetados = await lerGruposAfetados(tx, salaId, [id]);
      gravarDia(tx, ref, data, reservas.filter((r) => r.id !== id));
      fecharPedidos(tx, afetados, "cancelado", `A reserva de ${nome || "outro colaborador"} foi cancelada`);
      gruposCancelados = afetados.map((d) => d.data());
    });

    await notificar(avisosGruposEncerrados(gruposCancelados, uid, nome, "cancelou"));
    return res.status(200).json({ message: "Reserva cancelada" });
  } catch (error) {
    return responderErro(res, error, "Erro ao cancelar reserva");
  }
};

// Pedidos encerrados porque o dono cancelou/alterou a reserva de que dependiam: um aviso por
// grupo ao requerente (o horário que queria pode ter ficado livre) e um aos outros donos do
// grupo, que já não precisam de responder.
function avisosGruposEncerrados(grupos, uid, nome, acao) {
  const porGrupo = new Map();
  grupos.forEach((p) => porGrupo.set(p.grupoId, [...(porGrupo.get(p.grupoId) || []), p]));
  const avisos = [];
  porGrupo.forEach((pedidos) => {
    const p = pedidos[0];
    avisos.push({
      uid: p.requerenteUid,
      assunto: `Pedido de alteração de reserva cancelado - ${p.salaNome}`,
      paragrafos: [
        `${nome || "O colaborador"} ${acao} a reserva que impedia o horário que pretendia, por isso o seu pedido de alteração foi encerrado.`,
        "O horário pode ter ficado disponível - volte a tentar a reserva na Requisição de Salas.",
      ],
      detalhes: [
        { label: "Sala", valor: `${p.salaNome} (${p.sede})` },
        { label: "Data", valor: formatarData(p.data) },
        { label: "Horário pretendido", valor: horarioTxt(p.horarioPretendido) },
      ],
    });
    pedidos.filter((o) => o.donoUid !== uid).forEach((o) => avisos.push({
      uid: o.donoUid,
      assunto: `Pedido de alteração de reserva encerrado - ${o.salaNome}`,
      paragrafos: [`O pedido de ${o.requerenteNome} para alterar a sua reserva já não precisa de resposta. A sua reserva mantém-se igual.`],
      detalhes: detalhesPedido(o),
    }));
  });
  return avisos;
}

// Edita uma reserva futura do próprio: descrição, horário, dia e/ou sala (body: { descricao,
// inicio, fim, data?, salaId? } - data/salaId omitidos mantêm os atuais). Tudo numa
// transação sobre o(s) documento(s) do dia: o de origem e, se mudar de dia/sala, o de
// destino (onde se verifica que o novo horário está livre - 409 com os conflitos, como ao
// reservar). Se só muda a descrição, os pedidos de alteração pendentes mantêm-se; se muda
// o horário/dia/sala, deixam de fazer sentido e são encerrados (como ao cancelar).
const updateReserva = async (req, res) => {
  try {
    const { uid, nome } = req.user;
    const { salaId, data, id } = req.params;
    if (!dataValida(data)) throw new HttpError(400, "Data inválida (formato esperado AAAA-MM-DD)");
    const descricao = lerDescricao(req.body);
    const horario = lerHorario(req.body);
    const novaData = req.body?.data || data;
    if (!dataValida(novaData)) throw new HttpError(400, "Data inválida (formato esperado AAAA-MM-DD)");
    const novaSalaId = req.body?.salaId || salaId;

    const mesmoDia = novaData === data && novaSalaId === salaId;
    // Para outra sala, tem de ser uma sala ativa do mesmo local de trabalho.
    if (novaSalaId !== salaId) {
      const [destino, origemDoc] = await Promise.all([lerSalaAtiva(novaSalaId), salasCol.doc(salaId).get()]);
      if (!origemDoc.exists || origemDoc.data().sede !== destino.sede) {
        throw new HttpError(400, "Só pode mudar a reserva para uma sala do mesmo local de trabalho");
      }
    }

    const origemRef = diaRef(salaId, data);
    const destinoRef = diaRef(novaSalaId, novaData);
    let gruposEncerrados = [];
    let reservaAntes = null;

    await db.runTransaction(async (tx) => {
      const origemDoc = await tx.get(origemRef);
      const destinoDoc = mesmoDia ? origemDoc : await tx.get(destinoRef);
      const origem = origemDoc.exists ? origemDoc.data().reservas || [] : [];
      const reserva = origem.find((r) => r.id === id && r.uid === uid);
      if (!reserva) throw new HttpError(404, "Reserva não encontrada");
      if (jaPassou(data, reserva.inicio)) throw new HttpError(400, "Só é possível editar reservas futuras");
      reservaAntes = reserva;

      const mudaHorario = !mesmoDia || reserva.inicio !== horario.inicio || reserva.fim !== horario.fim;
      if (mudaHorario && jaPassou(novaData, horario.inicio)) throw new HttpError(400, "Não é possível reservar no passado");

      const destino = destinoDoc.exists ? destinoDoc.data().reservas || [] : [];
      const conflitos = encontrarConflitos(destino, horario, [id]);
      if (conflitos.length) {
        throw new HttpError(409, "Horário indisponível", { conflitos: conflitos.map((r) => publicoReserva(r, uid)) });
      }

      const afetados = mudaHorario ? await lerGruposAfetados(tx, salaId, [id]) : [];
      const editada = { ...reserva, descricao, ...horario };
      if (mesmoDia) {
        gravarDia(tx, origemRef, data, origem.map((r) => (r.id === id ? editada : r)));
      } else {
        gravarDia(tx, origemRef, data, origem.filter((r) => r.id !== id));
        gravarDia(tx, destinoRef, novaData, [...destino, editada]);
      }
      fecharPedidos(tx, afetados, "cancelado", `A reserva de ${nome || "outro colaborador"} foi alterada`);
      gruposEncerrados = afetados.map((d) => d.data());
    });

    await notificar(avisosGruposEncerrados(gruposEncerrados, uid, nome, "alterou"));
    return res.status(200).json({
      message: "Reserva atualizada",
      reserva: { id, salaId: novaSalaId, data: novaData, descricao, ...horario },
      antes: { salaId, data, inicio: reservaAntes.inicio, fim: reservaAntes.fim },
    });
  } catch (error) {
    return responderErro(res, error, "Erro ao editar reserva");
  }
};

// ---------------------------------------------------------------------------
// Pedidos de alteração de reserva
// ---------------------------------------------------------------------------

// Y não consegue reservar porque uma ou mais reservas ocupam (parte d)o horário: cria um
// pedido para cada uma (mesmo grupoId) e avisa os respetivos donos. Os conflitos são
// sempre recalculados aqui, nunca vêm do cliente.
const createPedido = async (req, res) => {
  try {
    const { salaId, data } = req.body;
    if (!dataValida(data)) throw new HttpError(400, "Data inválida (formato esperado AAAA-MM-DD)");
    const horario = lerHorario(req.body);
    if (jaPassou(data, horario.inicio)) throw new HttpError(400, "Não é possível reservar no passado");
    const mensagem = typeof req.body.mensagem === "string" ? req.body.mensagem.trim().slice(0, MAX_MENSAGEM) : "";
    const descricao = lerDescricao(req.body);

    const sala = await lerSalaAtiva(salaId);
    const { uid, nome } = req.user;

    const pedidosCol = pedidosDaSala(sala.id);
    const diaDoc = await diaRef(sala.id, data).get();
    const conflitos = encontrarConflitos(diaDoc.exists ? diaDoc.data().reservas : [], horario);
    if (!conflitos.length) throw new HttpError(409, "O horário está livre - pode reservar diretamente", { livre: true });
    if (conflitos.some((r) => r.uid === uid)) {
      throw new HttpError(409, "Já tem uma reserva sua que se sobrepõe a este horário");
    }

    const existentes = await pedidosCol.where("requerenteUid", "==", uid).where("data", "==", data).get();
    if (existentes.docs.some((d) => d.data().ativo === true && sobrepoe(d.data().horarioPretendido, horario))) {
      throw new HttpError(409, "Já tem um pedido em curso para este horário");
    }

    const grupoId = novoId();
    const envolvidos = conflitos.map((r) => ({ reservaId: r.id, donoUid: r.uid, donoNome: r.nome, inicio: r.inicio, fim: r.fim }));
    const batch = db.batch();
    const criados = conflitos.map((r) => {
      const pedido = {
        grupoId,
        salaId: sala.id,
        salaNome: sala.nome,
        sede: sala.sede,
        data,
        reservaId: r.id,
        donoUid: r.uid,
        donoNome: r.nome,
        requerenteUid: uid,
        requerenteNome: nome || "",
        horarioAtual: { inicio: r.inicio, fim: r.fim },
        horarioPretendido: horario,
        novoHorario: null,
        mensagem,
        descricao,
        envolvidos,
        estado: "pendente",
        ativo: true,
        motivo: null,
        reservaCriadaId: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        respondidoAt: null,
      };
      batch.set(pedidosCol.doc(`${data}_${novoId()}`), pedido);
      return pedido;
    });
    await batch.commit();

    await notificar(criados.map((p) => ({
      uid: p.donoUid,
      assunto: `Pedido de alteração da sua reserva - ${p.salaNome}`,
      paragrafos: [
        `${p.requerenteNome} gostaria de reservar a ${p.salaNome} num horário que se sobrepõe à sua reserva e pergunta se pode alterar o horário da mesma.`,        ...(p.envolvidos.length > 1 ? [`Este pedido envolve também ${p.envolvidos.length - 1} outra(s) reserva(s); só será aplicado se todos aceitarem.`] : []),
        ...(p.mensagem ? [`Mensagem: "${p.mensagem}"`] : []),
        "A sua reserva só é alterada se aceitar o pedido. Pode aceitar (escolhendo o novo horário) ou recusar na Requisição de Salas.",
      ],
      detalhes: detalhesPedido(p),
    })));

    return res.status(201).json({ message: "Pedido enviado", grupoId, total: criados.length });
  } catch (error) {
    return responderErro(res, error, "Erro ao criar pedido de alteração");
  }
};

function publicoPedido(d, agora) {
  const p = d.data();
  // Expiração "preguiçosa": um pedido cujo horário pretendido já começou deixa de poder ser
  // aceite (ver aceitarPedido); aqui só se mostra como tal, sem escrever nada só por ler.
  const expirado = p.ativo === true && jaPassou(p.data, p.horarioPretendido.inicio, agora);
  return {
    id: d.id, grupoId: p.grupoId, salaId: p.salaId, salaNome: p.salaNome, sede: p.sede, data: p.data,
    reservaId: p.reservaId, donoUid: p.donoUid, donoNome: p.donoNome, requerenteNome: p.requerenteNome,
    horarioAtual: p.horarioAtual, horarioPretendido: p.horarioPretendido, descricao: p.descricao || "",
    novoHorario: p.novoHorario, mensagem: p.mensagem, envolvidos: p.envolvidos || [],
    estado: expirado ? "expirado" : p.estado, ativo: p.ativo === true && !expirado, motivo: p.motivo,
  };
}

// Pedidos recebidos ainda em curso + pedidos enviados a partir de hoje (incluindo os já
// respondidos, para o requerente ver o resultado), sala a sala e só do próprio utilizador:
// recebidos por donoUid + ativo (duas igualdades), enviados por requerenteUid + intervalo no
// ID (que começa pela data) - índices automáticos, sem índice composto.
const getPedidos = async (req, res) => {
  try {
    const { uid } = req.user;
    const agora = agoraLisboa();
    const salasSnap = await salasCol.get();
    const snaps = await Promise.all(salasSnap.docs.flatMap((sala) => {
      const col = sala.ref.collection("pedidos");
      return [
        col.where("donoUid", "==", uid).where("ativo", "==", true).get(),
        col.where("requerenteUid", "==", uid).where(ID_DOC, ">=", agora.data).get(),
      ];
    }));
    const recebidos = snaps.filter((_, i) => i % 2 === 0).flatMap((snap) => snap.docs)
      .map((d) => publicoPedido(d, agora)).filter((p) => p.ativo);
    const enviados = snaps.filter((_, i) => i % 2 === 1).flatMap((snap) => snap.docs)
      .filter((d) => d.data().data >= agora.data)
      .map((d) => publicoPedido(d, agora));
    const ordem = (a, b) => (a.data + a.horarioPretendido.inicio).localeCompare(b.data + b.horarioPretendido.inicio);
    return res.status(200).json({ recebidos: recebidos.sort(ordem), enviados: enviados.sort(ordem) });
  } catch (error) {
    return responderErro(res, error, "Erro ao obter pedidos");
  }
};

async function lerPedidoDoDono(tx, salaId, pedidoId, uid) {
  const doc = await tx.get(pedidosDaSala(salaId).doc(pedidoId));
  if (!doc.exists) throw new HttpError(404, "Pedido não encontrado");
  const pedido = doc.data();
  if (pedido.donoUid !== uid) throw new HttpError(403, "Só o dono da reserva pode responder a este pedido");
  if (pedido.estado !== "pendente" || pedido.ativo !== true) throw new HttpError(409, "Este pedido já foi respondido");
  return { doc, pedido };
}

// O dono (X) aceita e escolhe o novo horário da SUA reserva. Tudo é revalidado no momento
// (nunca com base no que o frontend mostrou): o pedido ainda está pendente e é de X, a
// reserva de X ainda existe e não mudou, o novo horário de X é válido e livre, e o horário
// pretendido por Y continua possível. Se o grupo tiver outros donos que ainda não
// responderam, a aceitação fica registada mas nada é alterado até todos aceitarem; quando o
// último aceita, todas as mudanças + a nova reserva de Y são aplicadas de uma só vez na
// mesma transação (sobre o documento de ocupação da sala/dia) - ou nenhuma é.
const aceitarPedido = async (req, res) => {
  try {
    const { uid } = req.user;
    const novoHorario = lerHorario(req.body);
    let resultado;

    await db.runTransaction(async (tx) => {
      const { salaId, id } = req.params;
      const { doc, pedido } = await lerPedidoDoDono(tx, salaId, id, uid);
      const ref = diaRef(salaId, pedido.data);
      const diaDoc = await tx.get(ref);
      const reservas = diaDoc.exists ? diaDoc.data().reservas || [] : [];
      const grupoDocs = (await tx.get(pedidosDaSala(salaId).where("grupoId", "==", pedido.grupoId))).docs;
      const grupoAtivo = grupoDocs.filter((d) => d.data().ativo === true);
      const agora = agoraLisboa();

      // Erros de "estado do mundo" (o pedido deixou de ser possível) encerram o grupo
      // inteiro, para ninguém ficar à espera de uma alteração que já não pode acontecer.
      const encerrar = (motivo) => {
        fecharPedidos(tx, grupoAtivo, "expirado", motivo);
        resultado = { status: 409, error: motivo, grupo: grupoAtivo.map((d) => d.data()) };
      };

      if (jaPassou(pedido.data, pedido.horarioPretendido.inicio, agora)) {
        return encerrar("O horário pretendido já passou");
      }
      const minha = reservas.find((r) => r.id === pedido.reservaId);
      if (!minha || minha.uid !== uid) return encerrar("A reserva original já não existe");
      if (minha.inicio !== pedido.horarioAtual.inicio || minha.fim !== pedido.horarioAtual.fim) {
        return encerrar("A reserva original foi entretanto alterada");
      }

      // Erros do novo horário escolhido por X: não alteram nada, X pode escolher outro.
      if (jaPassou(pedido.data, novoHorario.inicio, agora)) {
        throw new HttpError(400, "O novo horário não pode ser no passado");
      }
      if (sobrepoe(novoHorario, pedido.horarioPretendido)) {
        throw new HttpError(400, `O novo horário não pode sobrepor-se ao horário pedido (${horarioTxt(pedido.horarioPretendido)})`);
      }
      const conflitosNovo = encontrarConflitos(reservas, novoHorario, [minha.id]);
      if (conflitosNovo.length) {
        throw new HttpError(409, "O novo horário escolhido já está ocupado", { conflitos: conflitosNovo.map((r) => publicoReserva(r, uid)) });
      }

      const outrosPendentes = grupoAtivo.filter((d) => d.id !== doc.id && d.data().estado !== "aceite");
      if (outrosPendentes.length) {
        tx.update(doc.ref, { estado: "aceite", novoHorario, respondidoAt: admin.firestore.FieldValue.serverTimestamp() });
        resultado = { status: 200, parcial: true, pedido, faltam: outrosPendentes.map((d) => d.data().donoNome) };
        return;
      }

      // Último a aceitar: aplica o grupo inteiro. Antes de qualquer escrita, lê também os
      // outros grupos que dependem das reservas que vão mudar (ficam desatualizados).
      const pedidosGrupo = grupoAtivo.map((d) => (d.id === doc.id ? { ...d.data(), novoHorario } : d.data()));
      const novaReserva = {
        id: novoId(), uid: pedido.requerenteUid, nome: pedido.requerenteNome, descricao: pedido.descricao || "", ...pedido.horarioPretendido,
      };
      const aplicado = aplicarGrupo(reservas, pedidosGrupo, novaReserva);
      const outrosGrupos = aplicado.ok
        ? await lerGruposAfetados(tx, salaId, pedidosGrupo.map((p) => p.reservaId), pedido.grupoId)
        : [];
      if (!aplicado.ok) return encerrar(aplicado.motivo);

      gravarDia(tx, ref, pedido.data, aplicado.reservas);
      grupoAtivo.forEach((d) => tx.update(d.ref, {
        estado: "aceite",
        ativo: false,
        reservaCriadaId: novaReserva.id,
        ...(d.id === doc.id ? { novoHorario, respondidoAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
      }));
      fecharPedidos(tx, outrosGrupos, "cancelado", "A reserva envolvida foi entretanto alterada");
      resultado = { status: 200, aplicado: true, pedidosGrupo, outrosGrupos: outrosGrupos.map((d) => d.data()) };
    });

    if (resultado.status === 409) {
      const p = resultado.grupo[0];
      await notificar([
        { uid: p.requerenteUid, assunto: `Pedido de alteração de reserva expirado - ${p.salaNome}`,
          paragrafos: [`O seu pedido já não pôde ser aplicado: ${resultado.error}. Nenhuma reserva foi alterada.`], detalhes: detalhesPedido(p) },
        ...resultado.grupo.filter((o) => o.donoUid !== uid).map((o) => ({
          uid: o.donoUid, assunto: `Pedido de alteração de reserva encerrado - ${o.salaNome}`,
          paragrafos: [`O pedido de ${o.requerenteNome} já não pôde ser aplicado (${resultado.error}). A sua reserva mantém-se igual.`], detalhes: detalhesPedido(o) })),
      ]);
      return res.status(409).json({ error: `${resultado.error}. Nenhuma reserva foi alterada.` });
    }

    if (resultado.parcial) {
      const p = resultado.pedido;
      await notificar([{
        uid: p.requerenteUid,
        assunto: `${p.donoNome} aceitou alterar a reserva - ${p.salaNome}`,
        paragrafos: [
          `${p.donoNome} aceitou alterar a sua reserva para ${horarioTxt(novoHorario)}.`,
          `Ainda falta a resposta de: ${resultado.faltam.join(", ")}. Nada é alterado até todos aceitarem.`,
        ],
        detalhes: detalhesPedido(p),
      }]);
      return res.status(200).json({ message: `Aceitação registada. Aguarda ainda a resposta de ${resultado.faltam.join(", ")} - a sua reserva só muda quando todos aceitarem.` });
    }

    const { pedidosGrupo, outrosGrupos } = resultado;
    const p = pedidosGrupo[0];
    const avisos = [
      {
        uid: p.requerenteUid,
        assunto: `Reserva confirmada - ${p.salaNome}`,
        paragrafos: [
          `O seu pedido foi aceite e a reserva da ${p.salaNome} para ${horarioTxt(p.horarioPretendido)} já está feita em seu nome.`,
          ...pedidosGrupo.map((o) => `${o.donoNome} alterou a sua reserva para ${horarioTxt(o.novoHorario)}.`),
        ],
        detalhes: [
          { label: "Sala", valor: `${p.salaNome} (${p.sede})` },
          { label: "Data", valor: formatarData(p.data) },
          { label: "A sua reserva", valor: horarioTxt(p.horarioPretendido) },
        ],
      },
      ...pedidosGrupo.map((o) => ({
        uid: o.donoUid,
        assunto: `A sua reserva foi alterada - ${o.salaNome}`,
        paragrafos: [`Aceitou o pedido de ${o.requerenteNome}: a sua reserva passou de ${horarioTxt(o.horarioAtual)} para ${horarioTxt(o.novoHorario)}.`],
        detalhes: [
          { label: "Sala", valor: `${o.salaNome} (${o.sede})` },
          { label: "Data", valor: formatarData(o.data) },
          { label: "Novo horário", valor: horarioTxt(o.novoHorario) },
        ],
      })),
      ...outrosGrupos.filter((o, i, arr) => arr.findIndex((x) => x.grupoId === o.grupoId) === i).map((o) => ({
        uid: o.requerenteUid,
        assunto: `Pedido de alteração de reserva cancelado - ${o.salaNome}`,
        paragrafos: [`A reserva a que o seu pedido se referia foi entretanto alterada, por isso o pedido foi encerrado. Verifique a disponibilidade e tente novamente.`],
        detalhes: detalhesPedido(o),
      })),
    ];
    await notificar(avisos);

    return res.status(200).json({ message: "Pedido aceite: as reservas foram atualizadas" });
  } catch (error) {
    return responderErro(res, error, "Erro ao aceitar pedido");
  }
};

// O dono recusa: nenhuma reserva é alterada. O grupo inteiro fica encerrado (se um dos
// donos recusa, o horário de Y nunca poderá ficar livre por este pedido).
const recusarPedido = async (req, res) => {
  try {
    const { uid, nome } = req.user;
    let grupo;
    await db.runTransaction(async (tx) => {
      const { doc } = await lerPedidoDoDono(tx, req.params.salaId, req.params.id, uid);
      const grupoDocs = (await tx.get(pedidosDaSala(req.params.salaId).where("grupoId", "==", doc.data().grupoId))).docs.filter((d) => d.data().ativo === true);
      fecharPedidos(tx, grupoDocs.filter((d) => d.id === doc.id), "recusado", null);
      fecharPedidos(tx, grupoDocs.filter((d) => d.id !== doc.id), "cancelado", `Recusado por ${nome || "outro colaborador"}`);
      grupo = grupoDocs.map((d) => d.data());
    });

    const p = grupo[0];
    await notificar([
      {
        uid: p.requerenteUid,
        assunto: `Pedido de alteração de reserva recusado - ${p.salaNome}`,
        paragrafos: [`${nome || "O colaborador"} recusou alterar a reserva. Nenhuma reserva foi alterada e o horário pretendido continua indisponível.`],
        detalhes: detalhesPedido(grupo.find((o) => o.donoUid === uid) || p),
      },
      ...grupo.filter((o) => o.donoUid !== uid).map((o) => ({
        uid: o.donoUid,
        assunto: `Pedido de alteração de reserva encerrado - ${o.salaNome}`,
        paragrafos: [`O pedido de ${o.requerenteNome} foi recusado por outra pessoa envolvida. A sua reserva mantém-se igual.`],
        detalhes: detalhesPedido(o),
      })),
    ]);
    return res.status(200).json({ message: "Pedido recusado. A sua reserva mantém-se igual." });
  } catch (error) {
    return responderErro(res, error, "Erro ao recusar pedido");
  }
};

// O requerente desiste do pedido (todo o grupo).
const cancelarPedido = async (req, res) => {
  try {
    const { uid } = req.user;
    let grupo;
    await db.runTransaction(async (tx) => {
      const grupoDocs = (await tx.get(pedidosDaSala(req.params.salaId).where("grupoId", "==", req.params.grupoId))).docs;
      if (!grupoDocs.length) throw new HttpError(404, "Pedido não encontrado");
      if (grupoDocs.some((d) => d.data().requerenteUid !== uid)) throw new HttpError(403, "Só quem fez o pedido o pode cancelar");
      const ativos = grupoDocs.filter((d) => d.data().ativo === true);
      if (!ativos.length) throw new HttpError(409, "Este pedido já está encerrado");
      fecharPedidos(tx, ativos, "cancelado", "Cancelado pelo requerente");
      grupo = ativos.map((d) => d.data());
    });

    await notificar(grupo.map((o) => ({
      uid: o.donoUid,
      assunto: `Pedido de alteração de reserva cancelado - ${o.salaNome}`,
      paragrafos: [`${o.requerenteNome} cancelou o pedido de alteração. A sua reserva mantém-se igual.`],
      detalhes: detalhesPedido(o),
    })));
    return res.status(200).json({ message: "Pedido cancelado" });
  } catch (error) {
    return responderErro(res, error, "Erro ao cancelar pedido");
  }
};

module.exports = {
  getEstrutura,
  createSala,
  updateSala,
  getOcupacao,
  getOcupacaoSemana,
  getOcupacaoMes,
  createReserva,
  getMinhasReservas,
  cancelReserva,
  updateReserva,
  createPedido,
  getPedidos,
  aceitarPedido,
  recusarPedido,
  cancelarPedido,
};
