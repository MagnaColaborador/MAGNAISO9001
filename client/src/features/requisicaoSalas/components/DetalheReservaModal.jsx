import React from "react";
import { FaClock, FaDoorOpen, FaAlignLeft, FaUser, FaPen, FaXmark } from "react-icons/fa6";
import UserAvatar from "../../../shared/components/UserAvatar";
import { Modal, Botao } from "./ui";
import { toMin, hoje, agoraMin, formatarDataLonga } from "../salasUtils";

const duracaoTxt = (min) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? (m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`) : `${m} min`;
};

function Linha({ icon: Icon, children }) {
  return (
    <div className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <Icon className="mt-1 shrink-0 text-stone-400" style={{ fontSize: 13 }} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// Detalhes de uma reserva clicada na agenda. "onEditar"/"onCancelar" só são passados
// quando a reserva é do próprio e ainda não começou.
export default function DetalheReservaModal({ reserva, salaNome, sede, data, onClose, onEditar, onCancelar }) {
  const aDecorrer = data === hoje() && toMin(reserva.inicio) <= agoraMin() && agoraMin() < toMin(reserva.fim);

  return (
    <Modal
      titulo={reserva.propria ? "A sua reserva" : "Reserva"}
      subtitulo={`${salaNome} · ${sede}`}
      onClose={onClose}
      largura="max-w-md"
    >
      <div className="divide-y divide-stone-100">
        <Linha icon={FaClock}>
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-stone-900 tabular-nums">{reserva.inicio} – {reserva.fim}</span>
            {aDecorrer && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />a decorrer
              </span>
            )}
          </div>
          <div className="text-sm text-stone-500 first-letter:uppercase">
            {formatarDataLonga(data)} · {duracaoTxt(toMin(reserva.fim) - toMin(reserva.inicio))}
          </div>
        </Linha>
        <Linha icon={FaDoorOpen}>
          <div className="text-sm font-semibold text-stone-900">{salaNome}</div>
          <div className="text-sm text-stone-500">{sede}</div>
        </Linha>
        <Linha icon={FaUser}>
          <div className="flex items-center gap-2 min-w-0">
            <UserAvatar nome={reserva.nome} size={22} fontSize={9} />
            <span className="text-sm font-semibold text-stone-900 truncate">{reserva.nome}</span>
          </div>
        </Linha>
        <Linha icon={FaAlignLeft}>
          <div className={`text-sm whitespace-pre-wrap break-words ${reserva.descricao ? "text-stone-700" : "text-stone-400 italic"}`}>
            {reserva.descricao || "Sem descrição"}
          </div>
        </Linha>
      </div>

      {(onEditar || onCancelar) && (
        <div className="flex items-center gap-2 mt-5 pt-4 border-t border-stone-100">
          {onCancelar && (
            <Botao variante="fantasma" className="!text-red-600 hover:!bg-red-50 px-3" onClick={onCancelar}>
              <FaXmark style={{ fontSize: 11 }} /> Cancelar reserva
            </Botao>
          )}
          {onEditar && (
            <Botao className="ml-auto" onClick={onEditar}>
              <FaPen style={{ fontSize: 11 }} /> Editar
            </Botao>
          )}
        </div>
      )}
    </Modal>
  );
}
