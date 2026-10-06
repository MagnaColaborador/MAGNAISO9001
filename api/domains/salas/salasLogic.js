// Regras puras da Requisição de Salas (sem Firestore) - isoladas aqui para poderem ser
// testadas diretamente (ver salasLogic.test.js) e para o controller ficar só com a parte
// de leitura/escrita transacional.

const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const HORA_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

// Janela horária em que se pode reservar e granularidade das horas (o frontend só
// oferece estas opções nos selects, mas o backend volta sempre a validar).
const HORA_ABERTURA = "07:00";
const HORA_FECHO = "22:00";
const PASSO_MINUTOS = 15;

function horaParaMinutos(hora) {
  const m = HORA_REGEX.exec(hora || "");
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function dataValida(data) {
  if (!DATA_REGEX.test(data || "")) return false;
  const [y, m, d] = data.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Intervalos semiabertos [inicio, fim): o fim de uma reserva pode coincidir com o início
// da seguinte (10:30-12:00 e 12:00-13:00 não se sobrepõem).
function sobrepoe(a, b) {
  return horaParaMinutos(a.inicio) < horaParaMinutos(b.fim)
    && horaParaMinutos(b.inicio) < horaParaMinutos(a.fim);
}

// Valida um horário isolado (formato, ordem, janela e passo). Devolve a mensagem de erro
// ou null se for válido.
function validarHorario({ inicio, fim }) {
  const ini = horaParaMinutos(inicio);
  const f = horaParaMinutos(fim);
  if (ini == null || f == null) return "Horário inválido (formato esperado HH:MM)";
  if (ini >= f) return "A hora de fim tem de ser posterior à hora de início";
  if (ini < horaParaMinutos(HORA_ABERTURA) || f > horaParaMinutos(HORA_FECHO)) {
    return `As reservas têm de estar entre as ${HORA_ABERTURA} e as ${HORA_FECHO}`;
  }
  if (ini % PASSO_MINUTOS !== 0 || f % PASSO_MINUTOS !== 0) {
    return `As horas têm de ser múltiplos de ${PASSO_MINUTOS} minutos`;
  }
  return null;
}

// Hora atual em Lisboa (o servidor corre em UTC no Render) - usada para recusar reservas
// no passado e pedidos cujo horário já passou.
function agoraLisboa(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Lisbon",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(now).map((p) => [p.type, p.value])
  );
  return {
    data: `${parts.year}-${parts.month}-${parts.day}`,
    minutos: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

// true se o momento data+hora já passou (ou é agora) na hora de Lisboa.
function jaPassou(data, hora, agora = agoraLisboa()) {
  if (data !== agora.data) return data < agora.data;
  return horaParaMinutos(hora) <= agora.minutos;
}

// Todas as reservas do dia que impedem o horário pretendido - nunca assume que existe
// só um conflito. "ignorarIds" exclui reservas que vão ser movidas/substituídas.
function encontrarConflitos(reservas, horario, ignorarIds = []) {
  return (reservas || [])
    .filter((r) => !ignorarIds.includes(r.id) && sobrepoe(r, horario))
    .sort((a, b) => horaParaMinutos(a.inicio) - horaParaMinutos(b.inicio));
}

// Verifica se uma lista de reservas não tem sobreposições entre si (invariante do
// documento de ocupação de cada sala/dia).
function semSobreposicoes(reservas) {
  const ordenadas = [...reservas].sort((a, b) => horaParaMinutos(a.inicio) - horaParaMinutos(b.inicio));
  for (let i = 1; i < ordenadas.length; i++) {
    if (horaParaMinutos(ordenadas[i].inicio) < horaParaMinutos(ordenadas[i - 1].fim)) return false;
  }
  return true;
}

// Aplica um grupo de pedidos de alteração já todos aceites ao estado atual de uma
// sala/dia: move cada reserva visada para o novo horário escolhido pelo seu dono e
// acrescenta a reserva do requerente. Nunca altera nada se o resultado não for
// consistente - devolve { ok:false, motivo } e quem chama decide o que fazer.
function aplicarGrupo(reservas, pedidos, novaReserva) {
  const porId = new Map((reservas || []).map((r) => [r.id, r]));

  for (const p of pedidos) {
    const atual = porId.get(p.reservaId);
    if (!atual || atual.uid !== p.donoUid) {
      return { ok: false, motivo: "Uma das reservas envolvidas já não existe" };
    }
    if (atual.inicio !== p.horarioAtual.inicio || atual.fim !== p.horarioAtual.fim) {
      return { ok: false, motivo: "Uma das reservas envolvidas foi entretanto alterada" };
    }
  }

  const movidas = new Map(pedidos.map((p) => [p.reservaId, p.novoHorario]));
  const resultado = (reservas || []).map((r) => (
    movidas.has(r.id) ? { ...r, inicio: movidas.get(r.id).inicio, fim: movidas.get(r.id).fim } : r
  ));

  if (encontrarConflitos(resultado, novaReserva).length > 0) {
    return { ok: false, motivo: "O horário pretendido deixou de estar disponível" };
  }
  resultado.push(novaReserva);
  if (!semSobreposicoes(resultado)) {
    return { ok: false, motivo: "Os novos horários escolhidos sobrepõem-se a outras reservas" };
  }
  return { ok: true, reservas: resultado };
}

module.exports = {
  HORA_ABERTURA,
  HORA_FECHO,
  PASSO_MINUTOS,
  horaParaMinutos,
  dataValida,
  sobrepoe,
  validarHorario,
  agoraLisboa,
  jaPassou,
  encontrarConflitos,
  semSobreposicoes,
  aplicarGrupo,
};
