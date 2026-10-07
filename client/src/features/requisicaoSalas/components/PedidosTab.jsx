import React, { useState } from "react";
import { toast } from "react-toastify";
import { apiFetch } from "../../../shared/utils/apiFetch";
import { getNomeCurto } from "../../../shared/utils/nomeCurto";
import { FaInbox, FaPaperPlane, FaDoorOpen, FaArrowRightLong, FaLocationDot, FaCalendarDays } from "react-icons/fa6";
import UserAvatar from "../../../shared/components/UserAvatar";
import { Botao, Cartao, ConfirmModal, EstadoBadge, Vazio } from "./ui";
import AlterarReservaModal from "./AlterarReservaModal";
import { GOLD, formatarData, horarioTxt, lerJson } from "../salasUtils";

function Linha({ label, children }) {
  return (
    <div className="flex flex-col sm:flex-row sm:gap-3 text-sm py-1.5">
      <span className="text-stone-500 sm:min-w-[140px] text-xs sm:text-sm">{label}</span>
      <span className="text-stone-800 font-medium tabular-nums break-words">{children}</span>
    </div>
  );
}

// Sala, local e dia de um pedido.
function Contexto({ p }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <span className="inline-flex items-center gap-1.5 font-bold text-stone-900"><FaDoorOpen style={{ fontSize: 12, color: GOLD }} />{p.salaNome}</span>
      <span className="inline-flex items-center gap-1.5 text-stone-500"><FaLocationDot style={{ fontSize: 11 }} />{p.sede}</span>
      <span className="inline-flex items-center gap-1.5 text-stone-500 tabular-nums"><FaCalendarDays style={{ fontSize: 11 }} />{formatarData(p.data)}</span>
    </div>
  );
}

// Estado global de um grupo de pedidos enviados (um por cada reserva em conflito).
function estadoGrupo(pedidos) {
  const estados = pedidos.map((p) => p.estado);
  if (pedidos.every((p) => p.estado === "aceite" && !p.ativo)) return "aceite";
  if (estados.includes("recusado")) return "recusado";
  if (estados.includes("expirado")) return "expirado";
  if (pedidos.some((p) => p.ativo)) return "pendente";
  return "cancelado";
}

export default function PedidosTab({ pedidos, aCarregar, onAlterado }) {
  const [vista, setVista] = useState("recebidos");
  const [aAceitar, setAAceitar] = useState(null);
  const [aRecusar, setARecusar] = useState(null);
  const [aCancelar, setACancelar] = useState(null);
  const [aProcessar, setAProcessar] = useState(false);

  const acao = async (url, sucesso, fechar) => {
    setAProcessar(true);
    try {
      const res = await apiFetch(url, { method: "POST" });
      const body = await lerJson(res);
      if (!res.ok) toast.error(body.error || "Não foi possível concluir a operação");
      else toast.success(body.message || sucesso);
      fechar();
      onAlterado();
    } catch {
      toast.error("Erro de ligação ao servidor");
    } finally {
      setAProcessar(false);
    }
  };

  if (aCarregar && !pedidos) {
    return (
      <div className="max-w-4xl mx-auto space-y-3">
        {[0, 1].map((i) => <div key={i} className="h-36 rounded-2xl bg-white border border-stone-200/80 animate-pulse" />)}
      </div>
    );
  }
  const { recebidos = [], enviados = [] } = pedidos || {};

  const grupos = [];
  enviados.forEach((p) => {
    const g = grupos.find((x) => x.grupoId === p.grupoId);
    if (g) g.pedidos.push(p);
    else grupos.push({ grupoId: p.grupoId, pedidos: [p] });
  });
  const porResponder = recebidos.filter((p) => p.estado === "pendente").length;

  const opcoes = [
    { id: "recebidos", label: "Recebidos", icon: FaInbox, total: recebidos.length, alerta: porResponder },
    { id: "enviados", label: "Enviados", icon: FaPaperPlane, total: grupos.length },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex p-1 rounded-xl bg-stone-200/60">
          {opcoes.map((o) => {
            const ativo = vista === o.id;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => setVista(o.id)}
                className={`inline-flex items-center gap-2 px-4 py-1.5 text-sm font-semibold rounded-lg border-0 cursor-pointer transition-all ${ativo ? "bg-white text-stone-900 shadow-sm" : "bg-transparent text-stone-500 hover:text-stone-800"}`}
              >
                <o.icon style={{ fontSize: 12, color: ativo ? GOLD : undefined }} />
                {o.label}
                <span className={`min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center ${o.alerta ? "bg-red-500 text-white" : "bg-stone-200 text-stone-600"}`}>
                  {o.alerta || o.total}
                </span>
              </button>
            );
          })}
        </div>
        <p className="m-0 text-xs text-stone-500">
          {vista === "recebidos" ? "Pedidos de colegas para alterar o horário das suas reservas." : "Pedidos que fez para libertarem um horário já reservado."}
        </p>
      </div>

      {vista === "recebidos" && (
        !recebidos.length ? (
          <Cartao>
            <Vazio icon={FaInbox} titulo="Não tem pedidos de alteração por responder." texto="Quando alguém precisar de uma sala que reservou, o pedido aparece aqui." />
          </Cartao>
        ) : (
          <div className="space-y-4">
            {recebidos.map((p) => (
              <Cartao key={p.id} className={`overflow-hidden ${p.estado === "pendente" ? "ring-1 ring-amber-200" : ""}`}>
                <div className="px-5 sm:px-6 pt-5 pb-4 flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <UserAvatar nome={p.requerenteNome} size={40} fontSize={13} />
                    <div className="min-w-0">
                      <p className="m-0 text-sm text-stone-700">
                        <strong className="text-stone-900">{getNomeCurto(p.requerenteNome)}</strong> pergunta se pode alterar o horário da sua reserva
                      </p>
                      <div className="mt-1"><Contexto p={p} /></div>
                    </div>
                  </div>
                  <EstadoBadge estado={p.estado} />
                </div>

                <div className="mx-5 sm:mx-6 grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-xl bg-stone-50 p-3">
                  <div className="rounded-lg bg-white border border-stone-200 px-3 py-2.5">
                    <div className="text-[11px] text-stone-500">A sua reserva</div>
                    <div className="text-base font-bold text-stone-900 tabular-nums">{horarioTxt(p.horarioAtual)}</div>
                  </div>
                  <FaArrowRightLong className="text-stone-300" />
                  <div className="rounded-lg px-3 py-2.5 border" style={{ borderColor: "#E8C88A", background: "#FFFAF0" }}>
                    <div className="text-[11px] truncate" style={{ color: "#9A6B17" }}>Pretendido por {getNomeCurto(p.requerenteNome)}</div>
                    <div className="text-base font-bold text-stone-900 tabular-nums">{horarioTxt(p.horarioPretendido)}</div>
                  </div>
                </div>

                <div className="px-5 sm:px-6 pt-3">
                  {p.descricao && <Linha label="Motivo">{p.descricao}</Linha>}                  {p.envolvidos.length > 1 && (
                    <Linha label="Também envolve">
                      {p.envolvidos.filter((e) => e.reservaId !== p.reservaId).map((e) => `${getNomeCurto(e.donoNome)} (${e.inicio}–${e.fim})`).join(", ")}
                    </Linha>
                  )}
                  {p.mensagem && (
                    <blockquote className="m-0 mt-2 text-sm text-stone-600 italic rounded-lg bg-stone-50 px-4 py-3 border-l-4" style={{ borderLeftColor: "#E8C88A" }}>
                      "{p.mensagem}"
                    </blockquote>
                  )}
                </div>

                {p.estado === "pendente" ? (
                  <div className="flex flex-wrap gap-2 justify-end mt-5 px-5 sm:px-6 py-4 bg-stone-50/70 border-t border-stone-100">
                    <Botao variante="perigo" onClick={() => setARecusar(p)}>Recusar</Botao>
                    <Botao onClick={() => setAAceitar(p)}>Aceitar e escolher novo horário</Botao>
                  </div>
                ) : (
                  <p className="text-xs text-stone-500 mt-5 mb-0 px-5 sm:px-6 py-4 bg-stone-50/70 border-t border-stone-100">
                    Aceitou mudar a sua reserva para {horarioTxt(p.novoHorario)}. Aguarda a resposta das outras pessoas envolvidas - até lá a sua reserva mantém-se.
                  </p>
                )}
              </Cartao>
            ))}
          </div>
        )
      )}

      {vista === "enviados" && (
        !grupos.length ? (
          <Cartao>
            <Vazio icon={FaPaperPlane} titulo="Não enviou pedidos de alteração para hoje ou dias seguintes." texto="Ao tentar reservar um horário ocupado, pode pedir a quem o reservou que o altere." />
          </Cartao>
        ) : (
          <div className="space-y-4">
            {grupos.map(({ grupoId, pedidos: ps }) => {
              const p = ps[0];
              const estado = estadoGrupo(ps);
              return (
                <Cartao key={grupoId} className="overflow-hidden">
                  <div className="px-5 sm:px-6 pt-5 pb-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] text-stone-500">Horário pretendido</div>
                      <div className="text-xl font-bold text-stone-900 tabular-nums">{horarioTxt(p.horarioPretendido)}</div>
                      <div className="mt-1"><Contexto p={p} /></div>
                    </div>
                    <EstadoBadge estado={estado} />
                  </div>
                  <ul className="m-0 mx-5 sm:mx-6 p-0 list-none rounded-xl bg-stone-50 divide-y divide-stone-200/60">
                    {ps.map((x) => (
                      <li key={x.id} className="flex flex-wrap items-center gap-2 text-sm px-3 py-2.5">
                        <UserAvatar nome={x.donoNome} size={24} fontSize={9} />
                        <span className="text-stone-700 flex-1 min-w-0">Reserva de <strong className="text-stone-900">{getNomeCurto(x.donoNome)}</strong> <span className="tabular-nums text-stone-500">({horarioTxt(x.horarioAtual)})</span></span>
                        {x.estado === "aceite" && x.novoHorario && <span className="text-xs text-stone-500 tabular-nums">→ {horarioTxt(x.novoHorario)}</span>}
                        <EstadoBadge estado={x.estado} />
                      </li>
                    ))}
                  </ul>
                  <div className="px-5 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs">
                      {p.motivo && estado !== "aceite" && <span className="text-stone-500">{p.motivo}</span>}
                      {estado === "aceite" && <span className="text-emerald-700">A reserva foi criada em seu nome - veja "As minhas reservas".</span>}
                    </div>
                    {estado === "pendente" && (
                      <Botao variante="perigo" className="px-3 py-1.5 text-xs" onClick={() => setACancelar({ salaId: p.salaId, grupoId })}>Cancelar pedido</Botao>
                    )}
                  </div>
                </Cartao>
              );
            })}
          </div>
        )
      )}

      {aAceitar && (
        <AlterarReservaModal
          pedido={aAceitar}
          onClose={() => setAAceitar(null)}
          onConcluido={() => { setAAceitar(null); onAlterado(); }}
        />
      )}
      {aRecusar && (
        <ConfirmModal
          titulo="Recusar pedido"
          mensagem={`A sua reserva (${horarioTxt(aRecusar.horarioAtual)}) mantém-se exatamente igual e ${getNomeCurto(aRecusar.requerenteNome)} será informado(a) de que recusou. Continuar?`}
          confirmar="Recusar"
          onConfirm={() => acao(`/reservas-salas/pedidos/${aRecusar.salaId}/${aRecusar.id}/recusar`, "Pedido recusado", () => setARecusar(null))}
          onClose={() => setARecusar(null)}
          aCarregar={aProcessar}
        />
      )}
      {aCancelar && (
        <ConfirmModal
          titulo="Cancelar pedido"
          mensagem="O pedido de alteração será retirado e as pessoas envolvidas serão avisadas. Continuar?"
          confirmar="Cancelar pedido"
          onConfirm={() => acao(`/reservas-salas/pedidos/${aCancelar.salaId}/grupo/${aCancelar.grupoId}/cancelar`, "Pedido cancelado", () => setACancelar(null))}
          onClose={() => setACancelar(null)}
          aCarregar={aProcessar}
        />
      )}
    </div>
  );
}
