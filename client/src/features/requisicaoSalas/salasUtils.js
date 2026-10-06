// Regras de horário da Requisição de Salas no frontend - espelham
// api/domains/salas/salasLogic.js (janela, passo, intervalos [inicio, fim)). Servem só
// para mostrar opções válidas e avisar cedo; o backend volta sempre a validar tudo.

export const HORA_ABERTURA = "07:00";
export const HORA_FECHO = "22:00";
export const PASSO_MINUTOS = 15;

export const GOLD = "#C8932F";
export const GOLD_LIGHT = "#f5e6ca";

export const toMin = (hora) => {
  const [h, m] = (hora || "").split(":").map(Number);
  return h * 60 + m;
};
export const fromMin = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export const HORAS = (() => {
  const horas = [];
  for (let t = toMin(HORA_ABERTURA); t <= toMin(HORA_FECHO); t += PASSO_MINUTOS) horas.push(fromMin(t));
  return horas;
})();

export const sobrepoe = (a, b) => toMin(a.inicio) < toMin(b.fim) && toMin(b.inicio) < toMin(a.fim);

export const encontrarConflitos = (reservas, horario, ignorarIds = []) =>
  (reservas || [])
    .filter((r) => !ignorarIds.includes(r.id) && sobrepoe(r, horario))
    .sort((a, b) => toMin(a.inicio) - toMin(b.inicio));

const pad = (n) => String(n).padStart(2, "0");
export const hoje = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const somarDias = (data, dias) => {
  const [y, m, d] = data.split("-").map(Number);
  const dt = new Date(y, m - 1, d + dias);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
};
export const formatarData = (data) => (data ? data.split("-").reverse().join("/") : "");
export const formatarDataLonga = (data) => {
  const [y, m, d] = data.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" });
};

export const agoraMin = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};
export const jaPassou = (data, hora) => {
  const h = hoje();
  if (data !== h) return data < h;
  return toMin(hora) <= agoraMin();
};

export const horarioTxt = (h) => (h ? `${h.inicio}–${h.fim}` : "");

// Divide o dia (janela de reservas) em blocos livres/reservados, para a tabela
// "Horário | Estado | Reserva".
export function segmentosDoDia(reservas) {
  const ordenadas = [...(reservas || [])].sort((a, b) => toMin(a.inicio) - toMin(b.inicio));
  const segmentos = [];
  let cursor = toMin(HORA_ABERTURA);
  ordenadas.forEach((r) => {
    if (toMin(r.inicio) > cursor) segmentos.push({ inicio: fromMin(cursor), fim: r.inicio, livre: true });
    segmentos.push({ inicio: r.inicio, fim: r.fim, livre: false, reserva: r });
    cursor = Math.max(cursor, toMin(r.fim));
  });
  if (cursor < toMin(HORA_FECHO)) segmentos.push({ inicio: fromMin(cursor), fim: HORA_FECHO, livre: true });
  return segmentos;
}

// Opções válidas de início/fim dado um conjunto de blocos ocupados (e a data, para não
// oferecer horas que já passaram). Usado na escolha do novo horário de quem aceita um
// pedido e na sugestão de novo horário - só aparecem horários realmente possíveis.
export function opcoesInicio(bloqueios, data) {
  return HORAS.slice(0, -1).filter((h) =>
    !jaPassou(data, h) && encontrarConflitos(bloqueios, { inicio: h, fim: fromMin(toMin(h) + PASSO_MINUTOS) }).length === 0
  );
}
export function opcoesFim(bloqueios, inicio) {
  if (!inicio) return [];
  const fins = [];
  for (const h of HORAS) {
    if (toMin(h) <= toMin(inicio)) continue;
    if (encontrarConflitos(bloqueios, { inicio, fim: h }).length) break;
    fins.push(h);
  }
  return fins;
}

// Corpo JSON de uma resposta, sem rebentar se o servidor devolver algo que não é JSON.
export async function lerJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}
