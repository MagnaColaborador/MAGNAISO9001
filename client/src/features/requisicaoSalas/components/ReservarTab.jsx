import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import {
  FaLocationDot, FaDoorOpen, FaCircleCheck, FaTriangleExclamation, FaCalendarDays, FaClock, FaPlus,
  FaChevronLeft, FaChevronRight, FaXmark, FaAlignLeft, FaClockRotateLeft, FaHandPointer,
} from "react-icons/fa6";
import UserAvatar from "../../../shared/components/UserAvatar";
import { apiFetch } from "../../../shared/utils/apiFetch";
import { getNomeCurto } from "../../../shared/utils/nomeCurto";
import { Botao, Campo, Cartao, Modal, Rotulo, TabelaDia, Vazio, selectClass, useEscape } from "./ui";
import ConflitoModal from "./ConflitoModal";
import { useLocaisTrabalho } from "../../../shared/hooks/useLocaisTrabalho";
import {
  GOLD, HORAS, HORA_ABERTURA, HORA_FECHO, PASSO_MINUTOS, toMin, fromMin, hoje, somarDias, formatarDataLonga,
  encontrarConflitos, jaPassou, lerJson, segmentosDoDia, agoraMin, horarioTxt, formatarData,
} from "../salasUtils";

const SEDE_KEY = "requisicaoSalasSede";
const MAX_DESCRICAO = 300;
const DURACOES = [30, 60, 90, 120];

const duracaoTxt = (min) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? (m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`) : `${m} min`;
};
const INICIO_MIN = toMin(HORA_ABERTURA);
const FECHO_MIN = toMin(HORA_FECHO);
const TOTAL_MIN = FECHO_MIN - INICIO_MIN;
// Altura de uma hora na agenda (px) - a grelha tem a janela inteira de reservas.
const HORA_PX = 60;
const ALTURA = (TOTAL_MIN / 60) * HORA_PX;
const HORAS_GRELHA = Array.from({ length: TOTAL_MIN / 60 + 1 }, (_, i) => fromMin(INICIO_MIN + i * 60));
const y = (minuto) => ((minuto - INICIO_MIN) / 60) * HORA_PX;

const dataObj = (data) => {
  const [a, m, d] = data.split("-").map(Number);
  return new Date(a, m - 1, d);
};
const isoDe = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
const SEMANA = ["S", "T", "Q", "Q", "S", "S", "D"];

// Mini-calendário do mês (segunda a domingo). Os dias anteriores ficam acessíveis só
// para consulta. Os dias com reservas no local escolhido ficam marcados com um ponto
// (dourado quando inclui reservas suas).
function MiniCalendario({ data, onEscolher, mes, onMudarMes, marcas, aCarregarMarcas }) {
  const [ano, m] = mes.split("-").map(Number);
  const primeiro = new Date(ano, m - 1, 1);
  const desvio = (primeiro.getDay() + 6) % 7;
  const diasNoMes = new Date(ano, m, 0).getDate();
  const celulas = [
    ...Array.from({ length: desvio }, () => null),
    ...Array.from({ length: diasNoMes }, (_, i) => isoDe(new Date(ano, m - 1, i + 1))),
  ];
  const h = hoje();
  const mudarMes = (n) => onMudarMes(isoDe(new Date(ano, m - 1 + n, 1)).slice(0, 7));

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-bold text-stone-900 first-letter:uppercase flex items-center gap-2">
          {primeiro.toLocaleDateString("pt-PT", { month: "long", year: "numeric" })}
          {aCarregarMarcas && <span className="w-3 h-3 rounded-full border-2 border-stone-200 border-t-[#C8932F] animate-spin" />}
        </span>
        <div className="flex gap-1">
          {[[-1, FaChevronLeft, "Mês anterior"], [1, FaChevronRight, "Mês seguinte"]].map(([n, Icon, t]) => (
            <button key={n} type="button" title={t} onClick={() => mudarMes(n)} className="w-7 h-7 rounded-lg flex items-center justify-center bg-transparent border-0 text-stone-400 hover:bg-stone-100 hover:text-stone-800 cursor-pointer">
              <Icon style={{ fontSize: 10 }} />
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center">
        {SEMANA.map((d, i) => <span key={i} className="text-[10px] font-bold text-stone-400 pb-1">{d}</span>)}
        {celulas.map((d, i) => {
          if (!d) return <span key={`v${i}`} />;
          const ativo = d === data;
          const eHoje = d === h;
          const passado = d < h;
          const marca = marcas?.[d];
          return (
            <button
              key={d}
              type="button"
              onClick={() => onEscolher(d)}
              title={marca ? `${marca.reservas} reserva(s) em ${marca.salas} sala(s)${marca.propria ? ", inclui reservas suas" : ""}` : undefined}
              className={`relative mx-auto w-8 h-8 rounded-full text-[13px] tabular-nums border-0 cursor-pointer transition-colors ${
                ativo ? "text-white font-bold shadow-sm" : eHoje ? "font-bold text-[#7A5010] bg-[#FBF0DC] hover:bg-[#F5E3C0]" : passado ? "bg-transparent text-stone-300 hover:bg-stone-100" : "bg-transparent text-stone-700 hover:bg-stone-100"
              } ${marca && !ativo && !passado ? "font-semibold" : ""}`}
              style={ativo ? { background: GOLD } : undefined}
            >
              {Number(d.slice(8))}
              {marca && (
                <span
                  className="absolute left-1/2 -translate-x-1/2 bottom-[3px] w-1 h-1 rounded-full"
                  style={{ background: ativo ? "#fff" : marca.propria ? GOLD : passado ? "#d6d3d1" : "#78716c" }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Coluna de uma sala na agenda vertical: reservas como blocos, a seleção atual como
// bloco tracejado e a parte do dia que já passou sombreada. Com o rato pode-se arrastar
// para escolher o horário; um toque/clique num espaço livre propõe 1 hora.
function ColunaSala({ sala, reservas, selecao, conflito, passadoAteMin, ativa, bloqueada, onSelecionar, onVerReserva, reservaAberta }) {
  const ref = useRef(null);
  const arrasto = useRef(null);
  const tipoPonteiro = useRef(null);
  const [previa, setPrevia] = useState(null);

  const minutoEm = (e, arredondar) => {
    const r = ref.current.getBoundingClientRect();
    const m = INICIO_MIN + ((e.clientY - r.top) / ALTURA) * TOTAL_MIN;
    const passo = arredondar(m / PASSO_MINUTOS) * PASSO_MINUTOS;
    return Math.min(FECHO_MIN, Math.max(INICIO_MIN, passo));
  };
  const intervalo = (a) => (a.atual > a.ancora
    ? { ini: a.ancora, fim: a.atual }
    : { ini: a.atual, fim: Math.min(FECHO_MIN, a.ancora + PASSO_MINUTOS) });

  const baixo = (e) => {
    tipoPonteiro.current = e.pointerType;
    if (bloqueada || e.pointerType !== "mouse" || e.button !== 0) return;
    const ancora = Math.min(FECHO_MIN - PASSO_MINUTOS, minutoEm(e, Math.floor));
    if (ancora < passadoAteMin) return;
    e.preventDefault();
    ref.current.setPointerCapture(e.pointerId);
    arrasto.current = { ancora, atual: ancora, moveu: false };
    setPrevia(intervalo(arrasto.current));
  };
  const mover = (e) => {
    const a = arrasto.current;
    if (!a) return;
    const atual = Math.max(passadoAteMin, minutoEm(e, Math.round));
    if (atual !== a.atual) {
      a.atual = atual;
      a.moveu = a.moveu || atual !== a.ancora;
      setPrevia(intervalo(a));
    }
  };
  const cima = () => {
    const a = arrasto.current;
    arrasto.current = null;
    setPrevia(null);
    if (!a) return;
    const { ini, fim } = intervalo(a);
    onSelecionar(sala, a.moveu ? { ini, fim } : { clique: a.ancora });
  };
  // Toque (ou caneta): só seleção por clique - não interfere com o scroll.
  const clique = (e) => {
    if (bloqueada || tipoPonteiro.current === "mouse") return;
    const m = minutoEm(e, Math.floor);
    if (m < passadoAteMin) return;
    onSelecionar(sala, { clique: m });
  };

  const mostrar = previa || (selecao && { ini: toMin(selecao.inicio), fim: toMin(selecao.fim) });

  return (
    <div
      ref={ref}
      onPointerDown={baixo}
      onPointerMove={mover}
      onPointerUp={cima}
      onPointerCancel={() => { arrasto.current = null; setPrevia(null); }}
      onClick={clique}
      className={`relative border-l border-stone-200/70 select-none ${bloqueada ? "cursor-default" : "cursor-crosshair"} ${ativa ? "bg-[#FFFBF3]" : ""}`}
      style={{ height: ALTURA }}
    >
      {passadoAteMin > INICIO_MIN && (
        <div
          className="absolute inset-x-0 top-0 pointer-events-none"
          style={{
            height: y(Math.min(FECHO_MIN, passadoAteMin)),
            backgroundImage: "repeating-linear-gradient(135deg, rgba(245,245,244,0.95) 0 6px, rgba(231,229,228,0.55) 6px 12px)",
          }}
        />
      )}

      {reservas.map((r) => {
        const alto = y(toMin(r.fim)) - y(toMin(r.inicio));
        const aberta = reservaAberta === r.id;
        return (
          <button
            key={r.id}
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onVerReserva(r); }}
            className={`absolute left-1 right-1 rounded-lg px-2 py-1 overflow-hidden text-left border-0 cursor-pointer transition-shadow hover:shadow-md flex flex-col ${alto < 34 ? "justify-center" : ""}`}
            style={{
              top: y(toMin(r.inicio)) + 1,
              height: alto - 2,
              background: r.propria ? `linear-gradient(160deg, ${GOLD}, #B07D22)` : "#F4EEE3",
              color: r.propria ? "#fff" : "#4A3410",
              boxShadow: aberta ? "0 0 0 2px #7A5010" : r.propria ? "0 1px 2px rgba(122,80,16,0.3)" : `inset 3px 0 0 #D9A443`,
              zIndex: 2,
            }}
            title={`${r.inicio}–${r.fim} · ${r.nome}${r.descricao ? ` · ${r.descricao}` : ""}`}
          >
            <span className="text-[12px] font-bold truncate leading-tight">{r.propria ? "A sua reserva" : getNomeCurto(r.nome)}</span>
            {alto >= 34 && <span className="text-[11px] opacity-80 tabular-nums leading-tight">{r.inicio} – {r.fim}</span>}
            {alto >= 64 && r.descricao && <span className="text-[11px] opacity-75 leading-snug mt-0.5 line-clamp-2">{r.descricao}</span>}
          </button>
        );
      })}

      {mostrar && mostrar.fim > mostrar.ini && (
        <div
          className="absolute left-1 right-1 rounded-lg border-2 border-dashed pointer-events-none flex items-start justify-center pt-1"
          style={{
            top: y(mostrar.ini),
            height: y(mostrar.fim) - y(mostrar.ini),
            borderColor: conflito && !previa ? "#ef4444" : GOLD,
            background: conflito && !previa ? "rgba(239,68,68,0.08)" : "rgba(200,147,47,0.14)",
            zIndex: 3,
          }}
        >
          <span className="text-[11px] font-bold px-1.5 rounded-md bg-white/95 tabular-nums shadow-sm" style={{ color: conflito && !previa ? "#dc2626" : "#7A5010" }}>
            {fromMin(mostrar.ini)} – {fromMin(mostrar.fim)}
          </span>
        </div>
      )}
    </div>
  );
}

// Painel lateral "Nova reserva".
function PainelReserva({
  salas, sala, setSalaId, sede, data, onData, inicio, setInicio, fim, setFim, descricao, setDescricao,
  inicios, fins, ocupacao, reservasSala, conflitosAtuais, aReservar, onReservar, onEscolherLivre, onClose, comModal,
}) {
  useEscape(useCallback(() => { if (!comModal) onClose(); }, [comModal, onClose]));
  const horario = inicio && fim ? { inicio, fim } : null;
  const diaPassado = data < hoje();
  const definirDuracao = (min) => {
    if (!inicio) return;
    setFim(fromMin(Math.min(FECHO_MIN, toMin(inicio) + min)));
  };

  return (
    <div className="fixed inset-0 z-[900] flex justify-end bg-stone-900/30 backdrop-blur-[2px]" onClick={onClose}>
      <aside
        className="w-full sm:w-[420px] h-full bg-white shadow-2xl flex flex-col animate-fadeInUp sm:animate-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-5 border-b border-stone-100">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="m-0 text-[11px] font-bold uppercase tracking-[0.14em] text-[#B8892A] flex items-center gap-1.5"><FaPlus style={{ fontSize: 9 }} /> Nova reserva</p>
              <h2 className="m-0 mt-1 text-xl font-bold text-stone-900">{sala ? sala.nome : "Escolha uma sala"}</h2>
              <p className="m-0 mt-0.5 text-sm text-stone-500 first-letter:uppercase">{sede} · {formatarDataLonga(data)}</p>
            </div>
            <button type="button" onClick={onClose} className="w-9 h-9 -mr-2 rounded-lg flex items-center justify-center text-stone-400 hover:text-stone-800 hover:bg-stone-100 bg-transparent border-0 cursor-pointer" title="Fechar">
              <FaXmark />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <Campo label="Sala">
            <div className="grid grid-cols-2 gap-2">
              {salas.map((s) => {
                const ativa = s.id === sala?.id;
                const n = (ocupacao?.[s.id] || []).length;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSalaId(s.id)}
                    className={`text-left px-3 py-2.5 rounded-xl border cursor-pointer transition-all ${ativa ? "border-[#C8932F] bg-[#FFFAF0] ring-4 ring-[#C8932F]/10" : "border-stone-200 bg-white hover:border-stone-300"}`}
                  >
                    <span className="block text-sm font-semibold text-stone-900 truncate">{s.nome}</span>
                    <span className="block text-[11px] text-stone-500">{n ? `${n} reserva(s)` : "Sem reservas"}</span>
                  </button>
                );
              })}
            </div>
          </Campo>

          <Campo label="Data">
            <input type="date" className={`${selectClass} tabular-nums`} value={data} onChange={(e) => e.target.value && onData(e.target.value)} />
          </Campo>

          {diaPassado ? (
            <div className="rounded-xl bg-stone-50 border border-stone-200 px-4 py-3 text-sm text-stone-600 flex gap-2.5">
              <FaClockRotateLeft className="mt-0.5 shrink-0 text-stone-400" />
              Não é possível reservar em dias anteriores. Escolha hoje ou um dia seguinte.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Campo label="Início">
                  <select className={`${selectClass} tabular-nums`} value={inicio} onChange={(e) => {
                    const v = e.target.value;
                    setInicio(v);
                    if (fim && toMin(fim) <= toMin(v)) setFim("");
                  }}>
                    <option value="">--:--</option>
                    {inicios.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </Campo>
                <Campo label="Fim">
                  <select className={`${selectClass} tabular-nums`} value={fim} onChange={(e) => setFim(e.target.value)} disabled={!inicio}>
                    <option value="">--:--</option>
                    {fins.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </Campo>
              </div>
              {inicio && (
                <div className="flex flex-wrap gap-1.5 -mt-2">
                  {DURACOES.filter((d) => toMin(inicio) + d <= FECHO_MIN).map((d) => {
                    const ativo = fim && toMin(fim) - toMin(inicio) === d;
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => definirDuracao(d)}
                        className={`px-2.5 py-1 rounded-full text-xs font-semibold border cursor-pointer transition-colors ${ativo ? "bg-stone-900 text-white border-stone-900" : "bg-white text-stone-600 border-stone-200 hover:border-stone-400"}`}
                      >
                        {duracaoTxt(d)}
                      </button>
                    );
                  })}
                </div>
              )}

              <Campo label="Descrição" extra={<span className="font-normal text-stone-400 tabular-nums">{descricao.length}/{MAX_DESCRICAO}</span>}>
                <textarea
                  className={`${selectClass} min-h-[84px] resize-y`}
                  maxLength={MAX_DESCRICAO}
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  placeholder="Ex.: Reunião de equipa, entrevista, formação..."
                />
              </Campo>

              {horario && ocupacao && sala && (
                conflitosAtuais.length ? (
                  <div className="flex items-start gap-2.5 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                    <FaTriangleExclamation className="mt-0.5 shrink-0 text-amber-500" />
                    <span>Indisponível: sobrepõe-se a {conflitosAtuais.map((c) => `${getNomeCurto(c.nome)} (${c.inicio}–${c.fim})`).join(", ")}. Pode pedir para alterarem o horário.</span>
                  </div>
                ) : (
                  <div className="flex items-start gap-2.5 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                    <FaCircleCheck className="mt-0.5 shrink-0 text-emerald-500" />
                    <span>Disponível · {horarioTxt(horario)} ({duracaoTxt(toMin(fim) - toMin(inicio))})</span>
                  </div>
                )
              )}
            </>
          )}

          {sala && ocupacao && (
            <div className="pt-1">
              <Rotulo icon={FaClock} className="mb-3">Agenda da sala neste dia</Rotulo>
              <TabelaDia reservas={reservasSala} onEscolherLivre={diaPassado ? undefined : onEscolherLivre} />
            </div>
          )}
        </div>

        {!diaPassado && (
          <div className="px-6 py-4 border-t border-stone-100 bg-stone-50/60">
            <Botao onClick={onReservar} disabled={!sala || !horario || !descricao.trim() || aReservar || !ocupacao} className="w-full py-3 text-[15px]">
              {aReservar ? "A reservar..." : conflitosAtuais.length ? "Ver opções" : "Confirmar reserva"}
            </Botao>
            {horario && !descricao.trim() && (
              <p className="m-0 mt-2 text-[11px] text-stone-400 text-center">Preencha a descrição para reservar.</p>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

export default function ReservarTab({ estrutura, versaoOcupacao, onReservaCriada, onPedidoEnviado }) {
  // Locais de trabalho: os mesmos do Cadastro, vindos do backend (com cache partilhada).
  const { nomes: locais, aCarregar: locaisACarregar } = useLocaisTrabalho();
  const [sede, setSede] = useState("");
  const [data, setData] = useState(hoje());
  const [salaId, setSalaId] = useState("");
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [descricao, setDescricao] = useState("");
  const [painel, setPainel] = useState(false);
  // Reserva aberta no modal de detalhes ({ salaId, id }).
  const [detalhe, setDetalhe] = useState(null);
  const [ocupacao, setOcupacao] = useState(null);
  const [aCarregar, setACarregar] = useState(false);
  const [aReservar, setAReservar] = useState(false);
  const [conflitos, setConflitos] = useState(null);
  const [recarregar, setRecarregar] = useState(0);
  const [, setRelogio] = useState(0);
  const scrollRef = useRef(null);
  // Cache por local+dia durante a vida da página: voltar a um dia já visto não volta a ler
  // o Firestore. Invalidado só para o dia afetado depois de reservar/pedir.
  const cache = useRef(new Map());
  // Mês mostrado no mini-calendário e dias com reservas do local nesse mês
  // (cache por local+mês, invalidada da mesma forma que a da ocupação).
  const [mes, setMes] = useState(() => hoje().slice(0, 7));
  const [marcas, setMarcas] = useState(null);
  const [marcasACarregar, setMarcasACarregar] = useState(false);
  const cacheMes = useRef(new Map());

  useEffect(() => {
    if (!versaoOcupacao) return;
    cache.current.clear();
    cacheMes.current.clear();
    setRecarregar((n) => n + 1);
  }, [versaoOcupacao]);

  // O calendário acompanha o dia escolhido (setas de dia, "Hoje", data no painel).
  useEffect(() => { setMes(data.slice(0, 7)); }, [data]);

  // Atualiza a linha "agora" e a zona já passada a cada minuto (sem ler dados).
  useEffect(() => {
    const t = setInterval(() => setRelogio((n) => n + 1), 60000);
    return () => clearInterval(t);
  }, []);

  // Local inicial: o último escolhido neste browser, senão o primeiro local com salas.
  useEffect(() => {
    if (!locais.length || locais.includes(sede)) return;
    let guardado = null;
    try { guardado = localStorage.getItem(SEDE_KEY); } catch { /* sem storage */ }
    const comSalas = locais.find((l) => estrutura.salas.some((s) => s.sede === l && s.ativa));
    setSede(locais.includes(guardado) ? guardado : comSalas || locais[0]);
  }, [locais, sede, estrutura]);

  useEffect(() => { setDetalhe(null); }, [sede, data]);

  const salas = useMemo(() => estrutura.salas.filter((s) => s.sede === sede && s.ativa), [estrutura, sede]);
  // IDs das salas do local, enviados à API (que assim não precisa de ler a coleção salas).
  const salaIdsParam = salas.map((s) => s.id).join(",");
  const sala = salas.find((s) => s.id === salaId) || null;

  useEffect(() => {
    try { if (sede) localStorage.setItem(SEDE_KEY, sede); } catch { /* sem storage */ }
    setSalaId((atual) => (salas.some((s) => s.id === atual) ? atual : salas[0]?.id || ""));
  }, [sede, salas]);

  useEffect(() => {
    // Sem salas neste local não há ocupação para ler - evita um read inútil.
    if (!sede || !data || !salaIdsParam) return;
    const chave = `${sede}|${data}`;
    if (cache.current.has(chave)) {
      setOcupacao(cache.current.get(chave));
      return;
    }
    let cancelado = false;
    setACarregar(true);
    setOcupacao(null);
    apiFetch(`/reservas-salas/ocupacao?salaIds=${encodeURIComponent(salaIdsParam)}&data=${data}`)
      .then(async (res) => {
        const body = await lerJson(res);
        if (cancelado) return;
        if (!res.ok) throw new Error(body.error || "Erro ao carregar a ocupação");
        cache.current.set(chave, body.ocupacao);
        setOcupacao(body.ocupacao);
      })
      .catch((e) => { if (!cancelado) toast.error(e.message); })
      .finally(() => { if (!cancelado) setACarregar(false); });
    return () => { cancelado = true; };
  }, [sede, data, salaIdsParam, recarregar]);

  useEffect(() => {
    // Sem salas neste local não há reservas para marcar - evita reads inúteis.
    if (!sede || !mes || !salaIdsParam) return;
    const chave = `${sede}|${mes}`;
    if (cacheMes.current.has(chave)) {
      setMarcas(cacheMes.current.get(chave));
      return;
    }
    let cancelado = false;
    setMarcas(null);
    setMarcasACarregar(true);
    apiFetch(`/reservas-salas/ocupacao-mes?salaIds=${encodeURIComponent(salaIdsParam)}&mes=${mes}`)
      .then(async (res) => {
        const body = await lerJson(res);
        if (cancelado) return;
        if (!res.ok) throw new Error(body.error || "Erro ao carregar as reservas do mês");
        cacheMes.current.set(chave, body.dias);
        setMarcas(body.dias);
      })
      .catch((e) => { if (!cancelado) toast.error(e.message); })
      .finally(() => { if (!cancelado) setMarcasACarregar(false); });
    return () => { cancelado = true; };
  }, [sede, mes, salaIdsParam, recarregar]);

  // Ao mudar de dia/local, posiciona a agenda perto da hora atual (hoje) ou das 8h.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const alvo = data === hoje() ? Math.max(INICIO_MIN, agoraMin() - 60) : toMin("08:00");
    el.scrollTop = Math.max(0, y(alvo));
  }, [data, sede, salas.length]);

  const invalidarDia = () => {
    cache.current.delete(`${sede}|${data}`);
    cacheMes.current.delete(`${sede}|${data.slice(0, 7)}`);
    setRecarregar((n) => n + 1);
  };

  const reservasSala = (ocupacao && salaId && ocupacao[salaId]) || [];
  const horario = inicio && fim ? { inicio, fim } : null;
  const conflitosAtuais = horario ? encontrarConflitos(reservasSala, horario) : [];
  const inicios = HORAS.slice(0, -1).filter((h) => !jaPassou(data, h));
  const fins = inicio ? HORAS.filter((h) => toMin(h) > toMin(inicio)) : [];

  const escolherLivre = (seg) => {
    let ini = seg.inicio;
    if (jaPassou(data, ini)) {
      const prox = inicios.find((h) => toMin(h) >= toMin(seg.inicio));
      if (!prox || toMin(prox) >= toMin(seg.fim)) return false;
      ini = prox;
    }
    setInicio(ini);
    setFim(fromMin(Math.min(toMin(seg.fim), toMin(ini) + 60)));
    return true;
  };

  // Seleção na agenda: arrastar define o horário exato; um clique num espaço livre
  // propõe 1 hora a partir daí (arredondado à meia hora). Abre o painel de reserva.
  const selecionarNaGrelha = (s, sel) => {
    setSalaId(s.id);
    if (sel.clique == null) {
      const ini = inicios.find((h) => toMin(h) >= sel.ini);
      if (!ini || toMin(ini) >= sel.fim) return;
      setInicio(ini);
      setFim(fromMin(sel.fim));
      setPainel(true);
      return;
    }
    const reservas = (ocupacao && ocupacao[s.id]) || [];
    const seg = segmentosDoDia(reservas).find((x) => x.livre && toMin(x.inicio) <= sel.clique && sel.clique < toMin(x.fim));
    if (!seg) return;
    const arred = Math.max(toMin(seg.inicio), Math.floor(sel.clique / 30) * 30);
    if (escolherLivre({ inicio: fromMin(arred), fim: seg.fim })) setPainel(true);
  };

  const reservar = async () => {
    if (!sala || !horario) return;
    if (conflitosAtuais.length) {
      setConflitos(conflitosAtuais);
      return;
    }
    setAReservar(true);
    try {
      const res = await apiFetch("/reservas-salas/reservas", {
        method: "POST",
        body: JSON.stringify({ salaId: sala.id, data, ...horario, descricao: descricao.trim() }),
      });
      const body = await lerJson(res);
      if (res.status === 409 && body.conflitos) {
        // Alguém reservou entretanto: o backend devolve os conflitos reais.
        invalidarDia();
        setConflitos(body.conflitos);
        return;
      }
      if (!res.ok) {
        toast.error(body.error || "Não foi possível efetuar a reserva");
        return;
      }
      toast.success(`Reserva efetuada: ${sala.nome}, ${inicio}–${fim}`);
      setInicio("");
      setFim("");
      setDescricao("");
      setPainel(false);
      invalidarDia();
      onReservaCriada();
    } catch (e) {
      toast.error("Erro de ligação ao servidor");
    } finally {
      setAReservar(false);
    }
  };

  // Fechar o painel descarta o horário escolhido (deixa de aparecer na agenda).
  const fecharPainel = useCallback(() => { setPainel(false); setInicio(""); setFim(""); }, []);

  if (!locais.length) {
    return (
      <Cartao>
        <Vazio icon={FaLocationDot} titulo={locaisACarregar ? "A carregar locais de trabalho..." : "Não foi possível carregar os locais de trabalho."} />
      </Cartao>
    );
  }

  const h = hoje();
  const eHoje = data === h;
  const diaPassado = data < h;
  const agora = agoraMin();
  const passadoAteMin = diaPassado ? FECHO_MIN : eHoje ? Math.max(INICIO_MIN, Math.ceil(agora / PASSO_MINUTOS) * PASSO_MINUTOS) : INICIO_MIN;
  const mostrarAgora = eHoje && agora > INICIO_MIN && agora < FECHO_MIN;
  const salaDetalhe = detalhe && salas.find((s) => s.id === detalhe.salaId);
  const reservaDetalhe = detalhe && ocupacao && (ocupacao[detalhe.salaId] || []).find((r) => r.id === detalhe.id);
  const salasPorLocal = (l) => estrutura.salas.filter((s) => s.sede === l && s.ativa).length;
  const todas = ocupacao ? salas.flatMap((s) => ocupacao[s.id] || []) : [];
  const livresAgora = ocupacao && eHoje ? salas.filter((s) => !(ocupacao[s.id] || []).some((r) => toMin(r.inicio) <= agora && agora < toMin(r.fim))).length : null;
  const minhasHoje = todas.filter((r) => r.propria).length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-5 items-start">
      {/* ---------- Coluna lateral: local, calendário, resumo ---------- */}
      <div className="space-y-5 lg:sticky lg:top-[70px]">
        <Cartao className="p-2">
          <Rotulo icon={FaLocationDot} className="px-3 pt-2 pb-2">Local de trabalho</Rotulo>
          <div className="flex lg:flex-col gap-1 overflow-x-auto">
            {locais.map((l) => {
              const ativo = l === sede;
              const n = salasPorLocal(l);
              return (
                <button
                  key={l}
                  type="button"
                  onClick={() => setSede(l)}
                  className={`shrink-0 flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-sm text-left border-0 cursor-pointer transition-colors ${ativo ? "bg-stone-900 text-white" : "bg-transparent text-stone-700 hover:bg-stone-100"}`}
                >
                  <span className="font-semibold truncate">{l}</span>
                  <span className={`text-[11px] font-semibold tabular-nums px-2 py-0.5 rounded-full ${ativo ? "bg-white/15 text-white" : "bg-stone-100 text-stone-500"}`}>
                    {n} {n === 1 ? "sala" : "salas"}
                  </span>
                </button>
              );
            })}
          </div>
        </Cartao>

        <Cartao className="p-5">
          <MiniCalendario
            data={data}
            onEscolher={setData}
            mes={mes}
            onMudarMes={setMes}
            marcas={salas.length ? marcas : null}
            aCarregarMarcas={salas.length > 0 && marcasACarregar}
          />
          {salas.length > 0 && (
            <div className="mt-3 pt-3 border-t border-stone-100 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-stone-500">
              <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-stone-500" />Com reservas</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full" style={{ background: GOLD }} />Inclui reservas suas</span>
            </div>
          )}
        </Cartao>

        {salas.length > 0 && (
          <Cartao className="p-5">
            <Rotulo icon={FaCalendarDays} className="mb-4">Resumo do dia</Rotulo>
            <div className="grid grid-cols-3 lg:grid-cols-1 gap-3">
              {[
                ["Reservas", ocupacao ? todas.length : "–"],
                [eHoje ? "Salas livres agora" : "Salas", eHoje ? (livresAgora ?? "–") : salas.length, eHoje && livresAgora ? "text-emerald-600" : ""],
                ["Reservas suas", ocupacao ? minhasHoje : "–", minhasHoje ? "text-[#B8892A]" : ""],
              ].map(([label, valor, cor]) => (
                <div key={label} className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-0.5">
                  <span className="text-xs text-stone-500">{label}</span>
                  <span className={`text-lg lg:text-base font-bold tabular-nums text-stone-900 ${cor || ""}`}>{valor}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 pt-4 border-t border-stone-100 flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-stone-500">
              <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded border border-stone-200 bg-white" />Livre</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: "#F4EEE3", boxShadow: "inset 2px 0 0 #D9A443" }} />Reservada</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: GOLD }} />Sua</span>
            </div>
          </Cartao>
        )}
      </div>

      {/* ---------- Agenda do dia ---------- */}
      <Cartao className="overflow-hidden min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-4 border-b border-stone-100">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center rounded-lg border border-stone-200 overflow-hidden shrink-0">
              <button type="button" title="Dia anterior" onClick={() => setData((d) => somarDias(d, -1))} className="w-9 h-9 flex items-center justify-center bg-white border-0 text-stone-500 hover:bg-stone-50 hover:text-stone-900 cursor-pointer">
                <FaChevronLeft style={{ fontSize: 11 }} />
              </button>
              <button type="button" onClick={() => setData(h)} disabled={eHoje} className="h-9 px-3 text-xs font-bold bg-white border-0 border-x border-solid border-stone-200 text-stone-700 hover:bg-stone-50 cursor-pointer disabled:text-stone-300 disabled:cursor-default disabled:hover:bg-white">
                Hoje
              </button>
              <button type="button" title="Dia seguinte" onClick={() => setData((d) => somarDias(d, 1))} className="w-9 h-9 flex items-center justify-center bg-white border-0 text-stone-500 hover:bg-stone-50 hover:text-stone-900 cursor-pointer">
                <FaChevronRight style={{ fontSize: 11 }} />
              </button>
            </div>
            <div className="min-w-0">
              <h2 className="m-0 text-lg font-bold text-stone-900 first-letter:uppercase truncate">{formatarDataLonga(data)}</h2>
              <p className="m-0 text-xs text-stone-500 truncate">
                {sede}{diaPassado ? " · dia anterior, só para consulta" : ""}
              </p>
            </div>
          </div>
          {!diaPassado && salas.length > 0 && (
            <Botao onClick={() => setPainel(true)}>
              <FaPlus style={{ fontSize: 11 }} /> Nova reserva
            </Botao>
          )}
        </div>

        {!salas.length ? (
          <Vazio icon={FaDoorOpen} titulo={`${sede} ainda não tem salas.`} texto="Escolha outro local de trabalho ou peça à Gestão de RH para adicionar salas." />
        ) : (
          <>
            {!diaPassado && (
              <div className="hidden sm:flex items-center gap-2 px-5 py-2 text-xs text-stone-500 bg-stone-50/70 border-b border-stone-100">
                <FaHandPointer style={{ fontSize: 11, color: GOLD }} />
                Arraste numa coluna para escolher o horário, ou clique num espaço livre. Clique numa reserva para ver os detalhes.
              </div>
            )}
            <div ref={scrollRef} className="overflow-auto max-h-[calc(100vh-250px)] min-h-[420px]">
              <div style={{ minWidth: 64 + salas.length * 150 }}>
                {/* Cabeçalho das salas */}
                <div className="grid sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-stone-200" style={{ gridTemplateColumns: `64px repeat(${salas.length}, minmax(150px, 1fr))` }}>
                  <div />
                  {salas.map((s) => {
                    const res = ocupacao?.[s.id] || [];
                    const ocupadaAgora = eHoje && res.some((r) => toMin(r.inicio) <= agora && agora < toMin(r.fim));
                    const ativa = s.id === salaId && (painel || horario);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => { setSalaId(s.id); if (!diaPassado) setPainel(true); }}
                        className={`px-3 py-3 text-left border-0 border-l border-solid border-stone-200/70 cursor-pointer transition-colors ${ativa ? "bg-[#FFFAF0]" : "bg-transparent hover:bg-stone-50"}`}
                        style={ativa ? { boxShadow: `inset 0 -2px 0 ${GOLD}` } : undefined}
                      >
                        <span className="flex items-center gap-2">
                          <FaDoorOpen style={{ fontSize: 12, color: GOLD }} className="shrink-0" />
                          <span className="text-sm font-bold text-stone-900 truncate">{s.nome}</span>
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-stone-500">
                          {eHoje && ocupacao && <span className={`w-1.5 h-1.5 rounded-full ${ocupadaAgora ? "bg-amber-500" : "bg-emerald-500"}`} />}
                          {!ocupacao ? "…" : eHoje ? (ocupadaAgora ? "Ocupada agora" : "Livre agora") : res.length ? `${res.length} reserva(s)` : "Sem reservas"}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Corpo: escala de horas + colunas */}
                <div className="grid relative" style={{ gridTemplateColumns: `64px repeat(${salas.length}, minmax(150px, 1fr))` }}>
                  <div className="relative" style={{ height: ALTURA }}>
                    {HORAS_GRELHA.slice(0, -1).map((hh) => (
                      <span key={hh} className="absolute right-2 -translate-y-1/2 text-[11px] font-medium text-stone-400 tabular-nums" style={{ top: y(toMin(hh)) || 8 }}>
                        {hh}
                      </span>
                    ))}
                  </div>
                  {/* Linhas de hora / meia hora por trás das colunas */}
                  <div
                    className="absolute top-0 right-0 pointer-events-none"
                    style={{
                      left: 64,
                      height: ALTURA,
                      backgroundImage: `repeating-linear-gradient(to bottom, #ECE9E4 0 1px, transparent 1px ${HORA_PX / 2}px, #F5F3F0 ${HORA_PX / 2}px ${HORA_PX / 2 + 1}px, transparent ${HORA_PX / 2 + 1}px ${HORA_PX}px)`,
                    }}
                  />
                  {aCarregar || !ocupacao ? (
                    salas.map((s) => (
                      <div key={s.id} className="border-l border-stone-200/70 p-2 space-y-3" style={{ height: ALTURA }}>
                        {[90, 180, 420].map((t, i) => <div key={i} className="rounded-lg bg-stone-100 animate-pulse" style={{ marginTop: i ? t / 3 : t / 2, height: 50 + i * 15 }} />)}
                      </div>
                    ))
                  ) : (
                    salas.map((s) => (
                      <ColunaSala
                        key={s.id}
                        sala={s}
                        reservas={ocupacao[s.id] || []}
                        selecao={s.id === salaId ? horario : null}
                        conflito={s.id === salaId && conflitosAtuais.length > 0}
                        passadoAteMin={passadoAteMin}
                        ativa={s.id === salaId && !!(painel || horario)}
                        bloqueada={diaPassado}
                        onSelecionar={selecionarNaGrelha}
                        onVerReserva={(r) => setDetalhe({ salaId: s.id, id: r.id })}
                        reservaAberta={detalhe?.salaId === s.id ? detalhe.id : null}
                      />
                    ))
                  )}
                  {mostrarAgora && (
                    <div className="absolute right-0 pointer-events-none z-[4] flex items-center" style={{ left: 0, top: y(agora) }}>
                      <span className="w-[64px] pr-1.5 text-right">
                        <span className="inline-block px-1.5 py-px rounded-md bg-red-500 text-white text-[10px] font-bold tabular-nums -translate-y-1/2">{fromMin(agora)}</span>
                      </span>
                      <span className="flex-1 h-0.5 bg-red-500 -translate-y-1/2" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </Cartao>

      {painel && salas.length > 0 && (
        <PainelReserva
          salas={salas}
          sala={sala}
          setSalaId={setSalaId}
          sede={sede}
          data={data}
          onData={setData}
          inicio={inicio}
          setInicio={setInicio}
          fim={fim}
          setFim={setFim}
          descricao={descricao}
          setDescricao={setDescricao}
          inicios={inicios}
          fins={fins}
          ocupacao={ocupacao}
          reservasSala={reservasSala}
          conflitosAtuais={conflitosAtuais}
          aReservar={aReservar}
          onReservar={reservar}
          onEscolherLivre={escolherLivre}
          onClose={fecharPainel}
          comModal={!!conflitos}
        />
      )}

      {reservaDetalhe && salaDetalhe && (
        <Modal
          titulo={reservaDetalhe.propria ? "A sua reserva" : "Reserva"}
          subtitulo={`${salaDetalhe.nome} · ${sede}`}
          onClose={() => setDetalhe(null)}
          largura="max-w-md"
        >
          <div className="flex items-center gap-3 mb-5">
            <UserAvatar nome={reservaDetalhe.nome} size={44} fontSize={14} />
            <div className="min-w-0">
              <div className="text-xs text-stone-500">Reservado por</div>
              <div className="text-base font-bold text-stone-900 truncate">{reservaDetalhe.nome}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="rounded-xl bg-stone-50 px-4 py-3">
              <div className="text-[11px] text-stone-500 flex items-center gap-1.5"><FaClock style={{ fontSize: 10 }} /> Horário</div>
              <div className="text-base font-bold text-stone-900 tabular-nums">{reservaDetalhe.inicio} – {reservaDetalhe.fim}</div>
              <div className="text-xs text-stone-500">{duracaoTxt(toMin(reservaDetalhe.fim) - toMin(reservaDetalhe.inicio))}</div>
            </div>
            <div className="rounded-xl bg-stone-50 px-4 py-3">
              <div className="text-[11px] text-stone-500 flex items-center gap-1.5"><FaCalendarDays style={{ fontSize: 10 }} /> Data</div>
              <div className="text-base font-bold text-stone-900 tabular-nums">{formatarData(data)}</div>
              <div className="text-xs text-stone-500 first-letter:uppercase">{dataObj(data).toLocaleDateString("pt-PT", { weekday: "long" })}</div>
            </div>
          </div>
          <div className="rounded-xl border border-stone-200 px-4 py-3">
            <div className="text-[11px] text-stone-500 flex items-center gap-1.5 mb-1"><FaAlignLeft style={{ fontSize: 10 }} /> Descrição</div>
            <div className={`text-sm whitespace-pre-wrap break-words ${reservaDetalhe.descricao ? "text-stone-800" : "text-stone-400 italic"}`}>
              {reservaDetalhe.descricao || "Sem descrição"}
            </div>
          </div>
          {reservaDetalhe.propria && (
            <p className="m-0 mt-4 text-xs text-stone-500">Para cancelar, use o separador "As minhas reservas".</p>
          )}
        </Modal>
      )}

      {conflitos && sala && (
        <ConflitoModal
          sala={sala}
          sede={sede}
          data={data}
          horario={horario}
          conflitos={conflitos}
          reservasDia={reservasSala}
          descricao={descricao.trim()}
          onClose={() => setConflitos(null)}
          onEnviado={(enviado) => {
            setConflitos(null);
            if (enviado) { fecharPainel(); onPedidoEnviado(); }
            else invalidarDia();
          }}
        />
      )}
    </div>
  );
}
