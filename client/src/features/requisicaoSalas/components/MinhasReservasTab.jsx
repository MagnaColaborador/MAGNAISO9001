import React, { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { apiFetch } from "../../../shared/utils/apiFetch";
import { FaCalendarCheck, FaDoorOpen, FaLocationDot, FaClockRotateLeft, FaAlignLeft, FaXmark } from "react-icons/fa6";
import { Botao, Cartao, ConfirmModal, EstadoBadge, Vazio } from "./ui";
import { GOLD, formatarData, formatarDataLonga, hoje, somarDias, jaPassou, lerJson, toMin } from "../salasUtils";

// Estado mostrado: "ativa" divide-se em ativa/a decorrer/concluída consoante a hora.
const estadoVisivel = (r) => {
  if (r.estado !== "ativa") return r.estado;
  if (jaPassou(r.data, r.fim)) return "concluida";
  if (jaPassou(r.data, r.inicio)) return "decorrer";
  return "ativa";
};

const tituloDia = (data) => {
  if (data === hoje()) return "Hoje";
  if (data === somarDias(hoje(), 1)) return "Amanhã";
  return formatarDataLonga(data);
};

const duracao = (r) => {
  const min = toMin(r.fim) - toMin(r.inicio);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? (m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`) : `${m} min`;
};

const diaDe = (data) => {
  const [y, m, d] = data.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return {
    dia: d,
    semana: dt.toLocaleDateString("pt-PT", { weekday: "short" }).replace(".", ""),
    mes: dt.toLocaleDateString("pt-PT", { month: "short" }).replace(".", ""),
  };
};

export default function MinhasReservasTab({ reservas: proximas, aCarregar: proximasACarregar, onAlterada }) {
  const [aCancelar, setACancelar] = useState(null);
  const [aProcessar, setAProcessar] = useState(false);
  const [periodo, setPeriodo] = useState("proximas");
  // Reservas de dias anteriores: só pedidas quando o separador é aberto, uma vez (não mudam).
  const [anteriores, setAnteriores] = useState(null);

  useEffect(() => {
    if (periodo !== "anteriores" || anteriores !== null) return undefined;
    let cancelado = false;
    apiFetch("/reservas-salas/reservas/minhas?periodo=anteriores")
      .then(async (res) => {
        const body = await lerJson(res);
        if (cancelado) return;
        if (!res.ok) throw new Error(body.error || "Erro ao carregar as reservas anteriores");
        setAnteriores(body.reservas);
      })
      .catch((e) => { if (!cancelado) { toast.error(e.message); setAnteriores([]); } });
    return () => { cancelado = true; };
  }, [periodo, anteriores]);

  const verAnteriores = periodo === "anteriores";
  const reservas = verAnteriores ? anteriores || [] : proximas;
  const aCarregar = verAnteriores ? anteriores === null : proximasACarregar;

  const cancelar = async () => {
    setAProcessar(true);
    try {
      const res = await apiFetch(`/reservas-salas/reservas/${aCancelar.salaId}/${aCancelar.data}/${aCancelar.id}`, { method: "DELETE" });
      const body = await lerJson(res);
      if (!res.ok) {
        toast.error(body.error || "Não foi possível cancelar a reserva");
        return;
      }
      toast.success("Reserva cancelada");
      setACancelar(null);
      onAlterada();
    } catch {
      toast.error("Erro de ligação ao servidor");
    } finally {
      setAProcessar(false);
    }
  };

  const seletor = (
    <div className="inline-flex p-1 rounded-xl bg-stone-200/60">
      {[
        { id: "proximas", label: "Próximas", icon: FaCalendarCheck },
        { id: "anteriores", label: "Anteriores", icon: FaClockRotateLeft },
      ].map((o) => {
        const ativo = periodo === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => setPeriodo(o.id)}
            className={`inline-flex items-center gap-2 px-4 py-1.5 text-sm font-semibold rounded-lg border-0 cursor-pointer transition-all ${ativo ? "bg-white text-stone-900 shadow-sm" : "bg-transparent text-stone-500 hover:text-stone-800"}`}
          >
            <o.icon style={{ fontSize: 12, color: ativo ? GOLD : undefined }} />{o.label}
          </button>
        );
      })}
    </div>
  );

  if (aCarregar) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        {seletor}
        {[0, 1, 2].map((i) => <div key={i} className="h-28 rounded-2xl bg-white border border-stone-200/80 animate-pulse" />)}
      </div>
    );
  }
  if (!reservas.length) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        {seletor}
        <Cartao>
          {verAnteriores ? (
            <Vazio icon={FaClockRotateLeft} titulo="Não tem reservas em dias anteriores." />
          ) : (
            <Vazio icon={FaCalendarCheck} titulo="Não tem reservas a partir de hoje." texto="As salas que reservar aparecem aqui, organizadas por dia." />
          )}
        </Cartao>
      </div>
    );
  }

  // Agrupadas por dia (já vêm ordenadas por data/hora do backend).
  const dias = [];
  reservas.forEach((r) => {
    const g = dias.find((d) => d.data === r.data);
    if (g) g.reservas.push(r);
    else dias.push({ data: r.data, reservas: [r] });
  });
  const ativas = reservas.filter((r) => estadoVisivel(r) === "ativa").length;
  const proxima = reservas.find((r) => estadoVisivel(r) === "ativa");

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {seletor}
        {verAnteriores && reservas.length >= 100 && (
          <span className="text-xs text-stone-400">A mostrar as 100 reservas mais recentes.</span>
        )}
      </div>

      {!verAnteriores && proxima && (
        <div className="rounded-2xl p-5 sm:p-6 text-white flex flex-wrap items-center justify-between gap-4 shadow-sm" style={{ background: "linear-gradient(120deg, #1C1917 0%, #44403C 100%)" }}>
          <div className="min-w-0">
            <p className="m-0 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: "#E8C88A" }}>Próxima reserva</p>
            <p className="m-0 mt-1 text-xl font-bold truncate">{proxima.salaNome} <span className="font-normal text-white/60">· {proxima.sede}</span></p>
            <p className="m-0 mt-0.5 text-sm text-white/70 first-letter:uppercase">
              {tituloDia(proxima.data)}{proxima.data !== hoje() && proxima.data !== somarDias(hoje(), 1) ? "" : ` (${formatarData(proxima.data)})`}, {proxima.inicio} – {proxima.fim}
            </p>
          </div>
          <div className="flex gap-6">
            <div>
              <div className="text-2xl font-bold tabular-nums" style={{ color: "#E8C88A" }}>{ativas}</div>
              <div className="text-[11px] text-white/60">por realizar</div>
            </div>
            <div>
              <div className="text-2xl font-bold tabular-nums">{dias.length}</div>
              <div className="text-[11px] text-white/60">{dias.length === 1 ? "dia" : "dias"}</div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {dias.map(({ data, reservas: doDia }) => {
          const { dia, semana, mes } = diaDe(data);
          const eHoje = data === hoje();
          return (
            <Cartao key={data} className="flex overflow-hidden">
              <div className={`w-[76px] sm:w-[100px] shrink-0 flex flex-col items-center pt-5 pb-4 border-r border-stone-100 ${eHoje ? "bg-[#FFFAF0]" : "bg-stone-50/60"}`}>
                <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: eHoje ? GOLD : "#a8a29e" }}>{eHoje ? "Hoje" : semana}</span>
                <span className="text-3xl font-bold text-stone-900 tabular-nums leading-tight">{dia}</span>
                <span className="text-xs text-stone-500">{mes}</span>
              </div>
              <ul className="flex-1 min-w-0 m-0 p-0 list-none divide-y divide-stone-100">
                {doDia.map((r) => {
                  const estado = estadoVisivel(r);
                  const apagada = estado === "concluida";
                  return (
                    <li key={r.id} className={`px-4 sm:px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5 ${apagada ? "opacity-55" : ""}`}>
                      <div className="sm:w-[96px] shrink-0 flex sm:flex-col items-baseline sm:items-start gap-1.5 sm:gap-0">
                        <span className="text-base font-bold text-stone-900 tabular-nums leading-tight">{r.inicio}</span>
                        <span className="text-xs text-stone-500 tabular-nums">até {r.fim} · {duracao(r)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="inline-flex items-center gap-2 font-bold text-stone-900">
                            <FaDoorOpen style={{ color: GOLD, fontSize: 13 }} className="shrink-0" />
                            {r.salaNome}
                          </span>
                          <span className="inline-flex items-center gap-1 text-xs text-stone-500"><FaLocationDot style={{ fontSize: 10 }} />{r.sede}</span>
                        </div>
                        {r.descricao && (
                          <p className="m-0 mt-1 text-sm text-stone-600 flex items-start gap-1.5 break-words">
                            <FaAlignLeft className="mt-1 shrink-0 text-stone-300" style={{ fontSize: 10 }} />
                            <span className="line-clamp-2">{r.descricao}</span>
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 sm:justify-end shrink-0">
                        <EstadoBadge estado={estado} />
                        {estado === "ativa" && (
                          <Botao variante="fantasma" className="px-2.5 py-1.5 text-xs !text-red-600 hover:!bg-red-50" onClick={() => setACancelar(r)}>
                            <FaXmark style={{ fontSize: 11 }} /> Cancelar
                          </Botao>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Cartao>
          );
        })}
      </div>

      {aCancelar && (
        <ConfirmModal
          titulo="Cancelar reserva"
          mensagem={`Tem a certeza que pretende cancelar a reserva da ${aCancelar.salaNome} (${aCancelar.sede}) em ${formatarData(aCancelar.data)}, ${aCancelar.inicio}–${aCancelar.fim}?`}
          confirmar="Cancelar reserva"
          onConfirm={cancelar}
          onClose={() => setACancelar(null)}
          aCarregar={aProcessar}
        />
      )}
    </div>
  );
}
