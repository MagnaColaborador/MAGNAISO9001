import React, { useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import {
  FaArrowRightLong, FaCircleInfo, FaTriangleExclamation, FaWandMagicSparkles, FaArrowPointer, FaQuoteLeft,
} from "react-icons/fa6";
import { apiFetch } from "../../../shared/utils/apiFetch";
import { getNomeCurto } from "../../../shared/utils/nomeCurto";
import UserAvatar from "../../../shared/components/UserAvatar";
import { Modal, Botao, Campo, selectClass } from "./ui";
import {
  GOLD, HORA_ABERTURA, HORA_FECHO, PASSO_MINUTOS, toMin, fromMin, hoje, agoraMin, formatarData, formatarDataLonga,
  horarioTxt, opcoesInicio, opcoesFim, segmentosDoDia, encontrarConflitos, lerJson,
} from "../salasUtils";

const INI = toMin(HORA_ABERTURA);
const FIM = toMin(HORA_FECHO);
// Escala da mini-agenda (px por hora).
const PX_HORA = 40;
const ALTURA = ((FIM - INI) / 60) * PX_HORA;
const yy = (min) => ((min - INI) / 60) * PX_HORA;
const HORAS_ESCALA = Array.from({ length: (FIM - INI) / 60 }, (_, i) => INI + i * 60);
const MAX_OPCOES = 4;
const SEPARACAO_MIN = 60;
const MAX_DESCRICAO = 300;
const DOURADO = `linear-gradient(160deg, ${GOLD}, #B07D22)`;

const duracaoTxt = (min) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? (m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`) : `${m} min`;
};

// Bloco de uma reserva na mini-agenda.
function Bloco({ inicio, fim, titulo, className = "", style }) {
  const alto = yy(toMin(fim)) - yy(toMin(inicio));
  return (
    <div
      className={`absolute left-1 right-1 rounded-md px-1.5 overflow-hidden pointer-events-none flex flex-col justify-center ${className}`}
      style={{ top: yy(toMin(inicio)) + 1, height: Math.max(alto - 2, 6), ...style }}
    >
      {alto >= 14 && <span className="text-[10px] font-bold leading-tight truncate">{titulo}</span>}
      {alto >= 28 && <span className="text-[10px] leading-tight opacity-80 tabular-nums truncate">{inicio} – {fim}</span>}
    </div>
  );
}

// Faixa de uma das colunas ("Agora" / "Depois"): linhas de hora e a parte do dia que já
// passou sombreada.
function Faixa({ passadoAte, onClick, children, clicavel }) {
  const ref = useRef(null);
  return (
    <div
      ref={ref}
      onClick={onClick ? (e) => onClick(INI + ((e.clientY - ref.current.getBoundingClientRect().top) / ALTURA) * (FIM - INI)) : undefined}
      className={`relative border-l border-stone-200 ${clicavel ? "cursor-pointer" : ""}`}
      style={{
        height: ALTURA,
        backgroundImage: `repeating-linear-gradient(to bottom, #ECE9E4 0 1px, transparent 1px ${PX_HORA}px)`,
      }}
    >
      {passadoAte > INI && (
        <div
          className="absolute inset-x-0 top-0 pointer-events-none"
          style={{
            height: yy(Math.min(FIM, passadoAte)),
            backgroundImage: "repeating-linear-gradient(135deg, rgba(245,245,244,0.95) 0 5px, rgba(231,229,228,0.6) 5px 10px)",
          }}
        />
      )}
      {children}
    </div>
  );
}

// Mudar uma reserva própria, com a mini-agenda "Agora | Depois". Dois modos:
//  - com "pedido": aceitar um pedido de alteração - o horário pedido fica bloqueado e a
//    reserva passa para um horário livre desse dia (POST /pedidos/.../aceitar);
//  - com "reserva": editar a reserva - horário e também dia, sala (do mesmo local, de
//    "salas") e descrição (PATCH /reservas/...).
// Só são oferecidos horários livres (sem contar com a própria reserva); o backend volta a
// validar tudo ao confirmar. "onConcluido(body)" é chamado depois de concluído (ou, ao
// aceitar, quando o pedido já não pode ser aceite e a lista tem de ser recarregada).
export default function AlterarReservaModal({ pedido, reserva: reservaEditar, salas = [], onClose, onConcluido }) {
  const modoPedido = !!pedido;
  const reserva = modoPedido
    ? {
      id: pedido.reservaId, salaId: pedido.salaId, salaNome: pedido.salaNome, sede: pedido.sede, data: pedido.data,
      inicio: pedido.horarioAtual.inicio, fim: pedido.horarioAtual.fim, descricao: "",
    }
    : reservaEditar;

  const [salaId, setSalaId] = useState(reserva.salaId);
  const [data, setData] = useState(reserva.data);
  const [inicio, setInicio] = useState(modoPedido ? "" : reserva.inicio);
  const [fim, setFim] = useState(modoPedido ? "" : reserva.fim);
  const [descricao, setDescricao] = useState(reserva.descricao || "");
  const [aEnviar, setAEnviar] = useState(false);
  const [recarregar, setRecarregar] = useState(0);
  const [, setLidas] = useState(0);
  const scrollRef = useRef(null);
  // Ocupação por sala|dia (o dia atual da reserva e o de destino), lida uma vez enquanto o
  // modal está aberto - 1 read por sala/dia.
  const cache = useRef(new Map());

  const chaveOrigem = `${reserva.salaId}|${reserva.data}`;
  const chaveAlvo = `${salaId}|${data}`;
  useEffect(() => {
    let cancelado = false;
    [...new Set([chaveOrigem, chaveAlvo])].filter((c) => !cache.current.has(c)).forEach((c) => {
      const [sId, d] = c.split("|");
      apiFetch(`/reservas-salas/ocupacao?salaId=${encodeURIComponent(sId)}&data=${d}`)
        .then(async (res) => {
          const body = await lerJson(res);
          if (!res.ok) throw new Error(body.error || "Erro ao carregar a ocupação");
          cache.current.set(c, body.ocupacao?.[sId] || []);
          if (!cancelado) setLidas((n) => n + 1);
        })
        .catch((e) => { if (!cancelado) toast.error(e.message); });
    });
    return () => { cancelado = true; };
  }, [chaveOrigem, chaveAlvo, recarregar]);

  const origemLista = cache.current.get(chaveOrigem) || null;
  const alvoLista = cache.current.get(chaveAlvo) || null;
  const pronto = !!(origemLista && alvoLista);

  const atual = { inicio: reserva.inicio, fim: reserva.fim };
  const pretendido = modoPedido ? pedido.horarioPretendido : null;
  const duracao = toMin(atual.fim) - toMin(atual.inicio);
  const requerente = modoPedido ? getNomeCurto(pedido.requerenteNome) : "";

  // Ao abrir (e ao mudar de sala/dia), a mini-agenda mostra a zona do dia que interessa.
  const focoMin = Math.min(toMin(atual.inicio), pretendido ? toMin(pretendido.inicio) : Infinity);
  useEffect(() => {
    if (!pronto || !scrollRef.current) return;
    scrollRef.current.scrollTop = Math.max(0, yy(focoMin - 60));
  }, [pronto, chaveAlvo, focoMin]);

  const outrasOrigem = (origemLista || []).filter((r) => r.id !== reserva.id);
  const outrasAlvo = (alvoLista || []).filter((r) => r.id !== reserva.id);
  const bloqueios = alvoLista ? [...outrasAlvo, ...(pretendido ? [{ id: "__pretendido", ...pretendido }] : [])] : [];
  const inicios = alvoLista ? opcoesInicio(bloqueios, data) : [];
  const fins = opcoesFim(bloqueios, inicio);
  const livres = segmentosDoDia(bloqueios).filter((s) => s.livre);

  // Encaixa a reserva (com a duração atual, ou o que couber) no espaço livre que contém
  // "minuto", sem começar no passado.
  const encaixar = (minuto) => {
    const gap = livres.find((s) => toMin(s.inicio) <= minuto && minuto < toMin(s.fim));
    if (!gap) return null;
    const gi = toMin(gap.inicio);
    const gf = toMin(gap.fim);
    const alvo = Math.max(gi, Math.min(Math.floor(minuto / PASSO_MINUTOS) * PASSO_MINUTOS, gf - duracao));
    const ini = inicios.map(toMin).find((m) => m >= alvo && m < gf);
    if (ini == null) return null;
    const novoH = { inicio: fromMin(ini), fim: fromMin(Math.min(gf, ini + duracao)) };
    return opcoesFim(bloqueios, novoH.inicio).includes(novoH.fim) ? novoH : null;
  };

  // Sugestões rápidas: horários livres com a mesma duração, os mais próximos do horário
  // atual (com pelo menos SEPARACAO_MIN entre si, para não serem quase iguais), mostrados
  // pela ordem do dia. Se nenhum couber com a mesma duração, os espaços livres que restam
  // (mais curtos), também pelos mais próximos.
  const durDe = (x) => toMin(x.fim) - toMin(x.inicio);
  const maisProximas = (lista) => {
    const distancia = (x) => Math.abs(toMin(x.inicio) - toMin(atual.inicio));
    const escolhidas = [];
    [...lista]
      .sort((a, b) => distancia(a) - distancia(b) || toMin(a.inicio) - toMin(b.inicio))
      .forEach((x) => {
        if (escolhidas.length < MAX_OPCOES && escolhidas.every((e) => Math.abs(toMin(e.inicio) - toMin(x.inicio)) >= SEPARACAO_MIN)) {
          escolhidas.push(x);
        }
      });
    return escolhidas.sort((a, b) => toMin(a.inicio) - toMin(b.inicio));
  };
  const inteiras = inicios
    .map((s) => ({ inicio: s, fim: fromMin(toMin(s) + duracao) }))
    .filter((x) => opcoesFim(bloqueios, x.inicio).includes(x.fim));
  const opcoes = inteiras.length
    ? maisProximas(inteiras)
    : maisProximas(livres.map((s) => encaixar(toMin(s.inicio))).filter(Boolean));

  const novo = inicio && fim ? { inicio, fim } : null;
  const conflitos = novo && alvoLista ? encontrarConflitos(bloqueios, novo) : [];
  const valido = !!novo && !conflitos.length && inicios.includes(inicio) && fins.includes(fim);
  const escolher = (x) => {
    if (!x) return;
    setInicio(x.inicio);
    setFim(x.fim);
  };
  // Mudar o início mantém a duração se couber; senão vai até onde o espaço livre deixar.
  const mudarInicio = (v) => {
    setInicio(v);
    const finsV = v ? opcoesFim(bloqueios, v) : [];
    const mesmo = v ? fromMin(toMin(v) + duracao) : "";
    setFim(finsV.includes(mesmo) ? mesmo : finsV[finsV.length - 1] || "");
  };

  const mudouSala = salaId !== reserva.salaId;
  const mudouData = data !== reserva.data;
  const mudouHora = inicio !== reserva.inicio || fim !== reserva.fim;
  const mudaHorario = mudouSala || mudouData || mudouHora;
  const mudou = mudaHorario || descricao.trim() !== (reserva.descricao || "").trim();
  const salaAlvo = salas.find((s) => s.id === salaId);
  const podeConfirmar = valido && !aEnviar && (modoPedido || (mudou && descricao.trim()));
  // Ao editar, as sugestões só aparecem quando o horário escolhido deixou de servir (ex.:
  // mudou de dia/sala e há sobreposição).
  const mostrarSugestoes = modoPedido || !valido;

  const confirmar = async () => {
    setAEnviar(true);
    try {
      const res = modoPedido
        ? await apiFetch(`/reservas-salas/pedidos/${pedido.salaId}/${pedido.id}/aceitar`, {
          method: "POST",
          body: JSON.stringify({ inicio, fim }),
        })
        : await apiFetch(`/reservas-salas/reservas/${reserva.salaId}/${reserva.data}/${reserva.id}`, {
          method: "PATCH",
          body: JSON.stringify({ salaId, data, inicio, fim, descricao: descricao.trim() }),
        });
      const body = await lerJson(res);
      if (!res.ok) {
        if (body.conflitos) {
          // Novo horário entretanto ocupado: volta a ler o dia para mostrar só opções válidas.
          toast.error(modoPedido
            ? body.error || "Não foi possível aceitar o pedido"
            : `Horário indisponível: sobrepõe-se a ${body.conflitos.map((c) => `${getNomeCurto(c.nome)} (${c.inicio}–${c.fim})`).join(", ")}`);
          if (modoPedido) {
            setInicio("");
            setFim("");
          }
          cache.current.delete(chaveAlvo);
          setRecarregar((n) => n + 1);
        } else {
          toast.error(body.error || (modoPedido ? "Não foi possível aceitar o pedido" : "Não foi possível guardar as alterações"));
          if (modoPedido) onConcluido(null);
        }
        return;
      }
      toast.success(body.message || (modoPedido ? "Pedido aceite" : "Reserva atualizada"));
      onConcluido(body);
    } catch {
      toast.error("Erro de ligação ao servidor");
    } finally {
      setAEnviar(false);
    }
  };

  const h = hoje();
  const passadoDe = (d) => (d < h ? FIM : d === h ? agoraMin() : INI);
  const outrosEnvolvidos = modoPedido ? pedido.envolvidos.filter((e) => e.reservaId !== pedido.reservaId) : [];
  const destinoDiferente = mudouSala || mudouData;

  let rodape = null;
  if (!modoPedido && !mudou) rodape = <span className="text-xs text-stone-400">Sem alterações</span>;
  else if (novo && conflitos.length) {
    rodape = (
      <span className="text-xs font-semibold text-red-600">
        Sobrepõe-se a {conflitos.map((c) => (c.id === "__pretendido" ? `${requerente} (${c.inicio}–${c.fim})` : `${getNomeCurto(c.nome)} (${c.inicio}–${c.fim})`)).join(", ")}
      </span>
    );
  }

  return (
    <Modal
      titulo={modoPedido ? "Aceitar pedido de alteração" : "Editar reserva"}
      subtitulo={`${reserva.salaNome} · ${reserva.sede} · ${formatarDataLonga(reserva.data)}`}
      onClose={onClose}
      largura="max-w-3xl"
    >
      {/* ---------- O pedido ---------- */}
      {modoPedido && (
        <div className="rounded-xl border border-[#EEDCB8] bg-[#FFFAF0] p-4 flex gap-3 mb-5">
          <UserAvatar nome={pedido.requerenteNome} size={40} fontSize={13} />
          <div className="min-w-0 flex-1">
            <p className="m-0 text-sm text-stone-700">
              <strong className="text-stone-900">{requerente}</strong> precisa da sala das{" "}
              <strong className="text-stone-900 tabular-nums">{horarioTxt(pretendido)}</strong>, que se sobrepõe à sua reserva das{" "}
              <strong className="text-stone-900 tabular-nums">{horarioTxt(atual)}</strong>.
            </p>
            {pedido.descricao && <p className="m-0 mt-1 text-sm text-stone-600">Motivo: {pedido.descricao}</p>}
            {pedido.mensagem && (
              <p className="m-0 mt-2 text-sm text-stone-600 italic flex gap-2">
                <FaQuoteLeft className="shrink-0 mt-0.5 not-italic" style={{ fontSize: 10, color: "#D9A443" }} />
                {pedido.mensagem}
              </p>
            )}
          </div>
        </div>
      )}

      {outrosEnvolvidos.length > 0 && (
        <div className="-mt-2 mb-5 flex gap-2.5 rounded-xl bg-sky-50 border border-sky-200 px-4 py-3 text-sm text-sky-900">
          <FaCircleInfo className="shrink-0 mt-0.5 text-sky-500" />
          <span>
            Este pedido envolve também {outrosEnvolvidos.map((e) => `a reserva de ${getNomeCurto(e.donoNome)} (${e.inicio}–${e.fim})`).join(", ")}.
            A alteração só é aplicada quando todos aceitarem - até lá a sua reserva mantém-se.
          </span>
        </div>
      )}

      {!pronto ? (
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_300px] gap-5">
          <div className="h-[360px] rounded-xl bg-stone-100 animate-pulse" />
          <div className="space-y-3">
            {[0, 1, 2].map((i) => <div key={i} className="h-12 rounded-xl bg-stone-100 animate-pulse" />)}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start">
          {/* ---------- Mini-agenda: agora vs depois ---------- */}
          <div className="order-2 md:order-1 rounded-xl border border-stone-200 overflow-hidden">
            <div className="grid grid-cols-[44px_1fr_1fr] bg-stone-50 border-b border-stone-200 text-[11px] font-bold uppercase tracking-wide text-stone-500">
              <div />
              <div className="px-2 py-2 border-l border-stone-200">Agora</div>
              <div className="px-2 py-2 border-l border-stone-200 text-[#9A6B17] min-w-0">
                {modoPedido ? "Depois de aceitar" : "Depois"}
                {destinoDiferente && (
                  <span className="block normal-case tracking-normal font-semibold text-[10px] text-stone-500 truncate">
                    {salaAlvo?.nome || reserva.salaNome} · {formatarData(data)}
                  </span>
                )}
              </div>
            </div>
            <div ref={scrollRef} className="max-h-[360px] overflow-y-auto">
              <div className="grid grid-cols-[44px_1fr_1fr]">
                <div className="relative" style={{ height: ALTURA }}>
                  {HORAS_ESCALA.map((m) => (
                    <span key={m} className="absolute right-1.5 text-[10px] text-stone-400 tabular-nums -translate-y-1/2" style={{ top: yy(m) || 6 }}>
                      {fromMin(m)}
                    </span>
                  ))}
                </div>

                <Faixa passadoAte={passadoDe(reserva.data)}>
                  {outrasOrigem.map((r) => (
                    <Bloco key={r.id} inicio={r.inicio} fim={r.fim} titulo={getNomeCurto(r.nome)} className="bg-stone-100 text-stone-600" />
                  ))}
                  <Bloco inicio={atual.inicio} fim={atual.fim} titulo="A sua reserva" className="text-white" style={{ background: DOURADO }} />
                </Faixa>

                <Faixa passadoAte={passadoDe(data)} clicavel onClick={(m) => escolher(encaixar(m))}>
                  {outrasAlvo.map((r) => (
                    <Bloco key={r.id} inicio={r.inicio} fim={r.fim} titulo={getNomeCurto(r.nome)} className="bg-stone-100 text-stone-600" />
                  ))}
                  {pretendido && (
                    <Bloco
                      inicio={pretendido.inicio}
                      fim={pretendido.fim}
                      titulo={requerente}
                      className="text-[#6B4A10]"
                      style={{ background: "#FBEFD8", boxShadow: "inset 3px 0 0 #D9A443" }}
                    />
                  )}
                  {novo && (
                    <Bloco
                      inicio={novo.inicio}
                      fim={novo.fim}
                      titulo="A sua reserva"
                      className="text-white ring-2 ring-[#7A5010]/30"
                      style={{ background: conflitos.length ? "repeating-linear-gradient(135deg, #ef4444 0 6px, #dc2626 6px 12px)" : DOURADO }}
                    />
                  )}
                </Faixa>
              </div>
            </div>
            <div className="px-3 py-2 bg-stone-50 border-t border-stone-200 text-[11px] text-stone-500 flex items-center gap-1.5">
              <FaArrowPointer style={{ fontSize: 10, color: GOLD }} />
              Clique num espaço livre da coluna "{modoPedido ? "Depois de aceitar" : "Depois"}" para mover a sua reserva para lá.
            </div>
          </div>

          {/* ---------- Escolha do novo horário (e, ao editar, sala/dia/descrição) ---------- */}
          <div className="order-1 md:order-2 space-y-5">
            {!modoPedido && (
              <div className="grid grid-cols-2 gap-3">
                {salas.length > 1 ? (
                  <Campo label="Sala">
                    <select className={selectClass} value={salaId} onChange={(e) => setSalaId(e.target.value)}>
                      {salas.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                    </select>
                  </Campo>
                ) : null}
                <Campo label="Dia">
                  <input
                    type="date"
                    className={`${selectClass} tabular-nums`}
                    value={data}
                    min={h}
                    onChange={(e) => e.target.value && e.target.value >= h && setData(e.target.value)}
                  />
                </Campo>
              </div>
            )}

            {!inicios.length ? (
              <div className="flex gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
                <FaTriangleExclamation className="shrink-0 mt-0.5 text-amber-500" />
                <span>
                  {modoPedido
                    ? "Não há nenhum horário livre nesta sala neste dia para onde mover a sua reserva. Pode recusar o pedido ou, se preferir libertar a sala, cancelar a sua reserva em \"As minhas reservas\"."
                    : "Não há nenhum horário livre nesta sala neste dia. Escolha outro dia ou outra sala."}
                </span>
              </div>
            ) : (
              <>
                {mostrarSugestoes && opcoes.length > 0 && (
                  <div>
                    <p className="m-0 mb-2 text-xs font-semibold text-stone-600 flex items-center gap-1.5">
                      <FaWandMagicSparkles style={{ fontSize: 11, color: GOLD }} /> Horários sugeridos
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {opcoes.map((o) => {
                        const ativo = novo && o.inicio === novo.inicio && o.fim === novo.fim;
                        const mesma = durDe(o) === duracao;
                        return (
                          <button
                            key={`${o.inicio}-${o.fim}`}
                            type="button"
                            onClick={() => escolher(o)}
                            className={`text-left px-3 py-2 rounded-xl border cursor-pointer transition-all ${ativo ? "border-[#C8932F] bg-[#FFFAF0] ring-4 ring-[#C8932F]/10" : "border-stone-200 bg-white hover:border-stone-300"}`}
                          >
                            <span className="block text-sm font-bold text-stone-900 tabular-nums">{o.inicio} – {o.fim}</span>
                            <span className={`block text-[11px] ${mesma ? "text-emerald-700" : "text-amber-700"}`}>
                              {mesma ? "Mesma duração" : `Mais curta (${duracaoTxt(durDe(o))})`}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div>
                  <p className="m-0 mb-2 text-xs font-semibold text-stone-600">{modoPedido ? "Ou escolha à sua medida" : "Horário"}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Campo label="Início">
                      <select className={`${selectClass} tabular-nums`} value={inicio} onChange={(e) => mudarInicio(e.target.value)}>
                        <option value="">--:--</option>
                        {inicio && !inicios.includes(inicio) && <option value={inicio} disabled>{inicio}</option>}
                        {inicios.map((hh) => <option key={hh} value={hh}>{hh}</option>)}
                      </select>
                    </Campo>
                    <Campo label="Fim">
                      <select className={`${selectClass} tabular-nums`} value={fim} onChange={(e) => setFim(e.target.value)} disabled={!inicio}>
                        <option value="">--:--</option>
                        {fim && !fins.includes(fim) && <option value={fim} disabled>{fim}</option>}
                        {fins.map((hh) => <option key={hh} value={hh}>{hh}</option>)}
                      </select>
                    </Campo>
                  </div>
                </div>
              </>
            )}

            {!modoPedido && (
              <Campo label="Descrição" extra={<span className="font-normal text-stone-400 tabular-nums">{descricao.length}/{MAX_DESCRICAO}</span>}>
                <textarea
                  className={`${selectClass} min-h-[72px] resize-y`}
                  maxLength={MAX_DESCRICAO}
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  placeholder="Ex.: Reunião de equipa, entrevista, formação..."
                />
              </Campo>
            )}

            {/* Antes -> depois */}
            <div className="rounded-xl bg-stone-50 p-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <div className="rounded-lg bg-white border border-stone-200 px-3 py-2 min-w-0">
                <div className="text-[11px] text-stone-500">Atual</div>
                <div className="text-sm font-bold text-stone-900 tabular-nums">{horarioTxt(atual)}</div>
                <div className="text-[11px] text-stone-400 truncate">{destinoDiferente ? `${formatarData(reserva.data)} · ${reserva.salaNome}` : duracaoTxt(duracao)}</div>
              </div>
              <FaArrowRightLong className="text-stone-300" />
              {novo ? (
                <div className="rounded-lg px-3 py-2 border min-w-0" style={{ borderColor: conflitos.length ? "#fca5a5" : "#E8C88A", background: conflitos.length ? "#fef2f2" : "#FFFAF0" }}>
                  <div className="text-[11px]" style={{ color: conflitos.length ? "#dc2626" : "#9A6B17" }}>Novo</div>
                  <div className="text-sm font-bold text-stone-900 tabular-nums">{horarioTxt(novo)}</div>
                  <div className={`text-[11px] truncate ${durDe(novo) < duracao ? "text-amber-700" : "text-stone-400"}`}>
                    {destinoDiferente ? `${formatarData(data)} · ${salaAlvo?.nome || reserva.salaNome}` : duracaoTxt(durDe(novo))}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg px-3 py-2 border border-dashed border-stone-300 text-[11px] text-stone-400 h-full flex items-center">
                  Escolha um horário
                </div>
              )}
            </div>
            <p className="m-0 -mt-3 text-[11px] text-stone-400">
              {modoPedido
                ? `Só aparecem horários livres que não tocam no horário pedido por ${requerente}.`
                : mudaHorario
                  ? "Se houver pedidos de alteração pendentes sobre esta reserva, são encerrados e quem os fez é avisado."
                  : "Só aparecem horários livres nesta sala neste dia."}
            </p>
          </div>
        </div>
      )}

      <div className="sticky bottom-0 -mx-6 -mb-5 mt-5 px-6 py-4 bg-white/95 backdrop-blur border-t border-stone-100 flex flex-wrap items-center justify-end gap-2">
        {rodape && <div className="mr-auto min-w-0">{rodape}</div>}
        <Botao variante="secundario" onClick={onClose}>Voltar</Botao>
        <Botao onClick={confirmar} disabled={!podeConfirmar}>
          {modoPedido
            ? aEnviar ? "A aceitar..." : novo ? `Aceitar e mudar para ${horarioTxt(novo)}` : "Aceitar e mudar a minha reserva"
            : aEnviar ? "A guardar..." : "Guardar alterações"}
        </Botao>
      </div>
    </Modal>
  );
}
