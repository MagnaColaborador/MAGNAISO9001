import React, { useEffect } from "react";
import { FaXmark } from "react-icons/fa6";
import { GOLD, segmentosDoDia } from "../salasUtils";
import { getNomeCurto } from "../../../shared/utils/nomeCurto";
import UserAvatar from "../../../shared/components/UserAvatar";

export const selectClass =
  "w-full px-3 py-2.5 text-sm rounded-lg border border-stone-200 bg-white text-stone-900 transition-colors hover:border-stone-300 focus:outline-none focus:border-[#C8932F] focus:ring-4 focus:ring-[#C8932F]/10 disabled:bg-stone-50 disabled:text-stone-400 disabled:cursor-not-allowed";

export function Botao({ variante = "primario", className = "", ...props }) {
  const estilos = {
    primario: "bg-[#C8932F] text-white hover:bg-[#B5832A] border-0 shadow-[0_1px_2px_rgba(122,80,16,0.25)]",
    escuro: "bg-stone-900 text-white hover:bg-stone-800 border-0",
    secundario: "bg-white text-stone-700 hover:bg-stone-50 border border-stone-200",
    fantasma: "bg-transparent text-stone-600 hover:bg-stone-100 hover:text-stone-900 border-0",
    perigo: "bg-white text-red-600 border border-red-200 hover:bg-red-50",
  };
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer transition-all duration-150 active:scale-[0.98] disabled:opacity-45 disabled:cursor-not-allowed disabled:active:scale-100 ${estilos[variante]} ${className}`}
      {...props}
    />
  );
}

// Fecha com Escape (modais e painel lateral).
export function useEscape(onClose) {
  useEffect(() => {
    const tecla = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onClose]);
}

export function Modal({ titulo, subtitulo, onClose, children, largura = "max-w-lg" }) {
  useEscape(onClose);
  return (
    <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm flex justify-center items-end sm:items-center z-[1000] sm:p-4" onClick={onClose}>
      <div
        className={`bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full ${largura} max-h-[92vh] overflow-y-auto animate-fadeInUp`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-5 pb-4 flex items-start justify-between gap-3 sticky top-0 bg-white/95 backdrop-blur z-10 border-b border-stone-100">
          <div className="min-w-0">
            <h3 className="m-0 text-[17px] font-bold text-stone-900">{titulo}</h3>
            {subtitulo && <p className="m-0 mt-0.5 text-xs text-stone-500">{subtitulo}</p>}
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 -mr-2 rounded-lg flex items-center justify-center text-stone-400 hover:text-stone-800 hover:bg-stone-100 bg-transparent border-0 cursor-pointer transition-colors shrink-0">
            <FaXmark />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmModal({ titulo, mensagem, confirmar = "Confirmar", variante = "perigo", onConfirm, onClose, aCarregar }) {
  return (
    <Modal titulo={titulo} onClose={onClose} largura="max-w-sm">
      <p className="m-0 mb-6 text-sm text-stone-600 leading-relaxed">{mensagem}</p>
      <div className="flex gap-2 justify-end">
        <Botao variante="secundario" onClick={onClose}>Voltar</Botao>
        <Botao variante={variante} onClick={onConfirm} disabled={aCarregar}>{aCarregar ? "A processar..." : confirmar}</Botao>
      </div>
    </Modal>
  );
}

export function Campo({ label, children, extra }) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-xs font-semibold text-stone-600 mb-1.5">
        {label}
        {extra}
      </span>
      {children}
    </label>
  );
}

// Cartão base das secções da página.
export function Cartao({ className = "", children }) {
  return <div className={`bg-white rounded-2xl border border-stone-200/80 shadow-[0_1px_2px_rgba(28,25,23,0.04)] ${className}`}>{children}</div>;
}

// Título pequeno de secção (dentro ou fora de cartões).
export function Rotulo({ icon: Icon, children, className = "" }) {
  return (
    <h3 className={`m-0 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-stone-400 ${className}`}>
      {Icon && <Icon style={{ fontSize: 11, color: GOLD }} />}
      {children}
    </h3>
  );
}

// Estado vazio com ícone.
export function Vazio({ icon: Icon, titulo, texto, children }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-4">
      <div className="relative mb-4">
        <div className="absolute inset-0 rounded-full blur-xl opacity-60" style={{ background: "#F5E3C0" }} />
        <div className="relative w-14 h-14 rounded-2xl flex items-center justify-center bg-white border border-[#EEDCB8]" style={{ color: GOLD }}>
          <Icon style={{ fontSize: 22 }} />
        </div>
      </div>
      <p className="m-0 text-[15px] font-semibold text-stone-800">{titulo}</p>
      {texto && <p className="m-0 mt-1 text-sm text-stone-500 max-w-sm">{texto}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

// Agenda vertical de uma sala num dia - deixa claro quando está livre, quando está
// ocupada, por quem e em que período. Clicar num bloco livre (se onEscolherLivre
// existir) pré-preenche o horário da reserva.
export function TabelaDia({ reservas, onEscolherLivre, destacar }) {
  const segmentos = segmentosDoDia(reservas);
  return (
    <ol className="m-0 p-0 list-none space-y-1.5">
      {segmentos.map((s) => {
        const destacado = destacar && s.reserva && destacar.includes(s.reserva.id);
        const clicavel = s.livre && onEscolherLivre;
        return (
          <li
            key={`${s.inicio}-${s.fim}`}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              s.livre
                ? `border border-dashed border-emerald-200 bg-emerald-50/40 ${clicavel ? "cursor-pointer hover:bg-emerald-50 hover:border-emerald-300" : ""}`
                : destacado ? "bg-amber-100/70 ring-1 ring-amber-300" : "bg-stone-50"
            }`}
            onClick={clicavel ? () => onEscolherLivre(s) : undefined}
            title={clicavel ? "Usar este horário livre" : undefined}
          >
            <span className="w-[96px] shrink-0 font-semibold text-stone-800 tabular-nums">{s.inicio} – {s.fim}</span>
            {s.livre ? (
              <span className="text-xs font-semibold text-emerald-700">Disponível</span>
            ) : (
              <span className="inline-flex items-center gap-2 min-w-0 text-stone-700">
                <UserAvatar nome={s.reserva.nome} size={20} fontSize={8} />
                <span className="truncate">{getNomeCurto(s.reserva.nome)}</span>
                {s.reserva.propria && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full" style={{ color: "#7A5010", background: "#FBF0DC" }}>sua</span>}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function EstadoBadge({ estado }) {
  const cores = {
    ativa: ["bg-emerald-50 text-emerald-700 ring-emerald-200", "Ativa"],
    decorrer: ["bg-sky-50 text-sky-700 ring-sky-200", "A decorrer"],
    concluida: ["bg-stone-100 text-stone-500 ring-stone-200", "Concluída"],
    pendente: ["bg-amber-50 text-amber-700 ring-amber-200", "Pendente"],
    aceite: ["bg-emerald-50 text-emerald-700 ring-emerald-200", "Aceite"],
    recusado: ["bg-red-50 text-red-600 ring-red-200", "Recusado"],
    cancelado: ["bg-stone-100 text-stone-500 ring-stone-200", "Cancelado"],
    expirado: ["bg-stone-100 text-stone-500 ring-stone-200", "Expirado"],
  };
  const [classes, texto] = cores[estado] || ["bg-stone-100 text-stone-500 ring-stone-200", estado];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ring-1 ring-inset ${classes}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {texto}
    </span>
  );
}
