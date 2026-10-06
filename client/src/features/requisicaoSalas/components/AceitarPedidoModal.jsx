import React, { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { apiFetch } from "../../../shared/utils/apiFetch";
import { getNomeCurto } from "../../../shared/utils/nomeCurto";
import { Modal, Botao, Campo, TabelaDia, selectClass } from "./ui";
import { formatarData, horarioTxt, opcoesInicio, opcoesFim, lerJson } from "../salasUtils";

// O dono da reserva aceita o pedido escolhendo o novo horário da SUA reserva. Só são
// oferecidos horários livres (sem contar com a própria reserva) e que não tocam no
// horário pedido; o backend volta a validar tudo no momento de aceitar.
export default function AceitarPedidoModal({ pedido, onClose, onRespondido }) {
  const [reservas, setReservas] = useState(null);
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [aEnviar, setAEnviar] = useState(false);
  const [recarregar, setRecarregar] = useState(0);

  useEffect(() => {
    let cancelado = false;
    setReservas(null);
    apiFetch(`/reservas-salas/ocupacao?salaId=${encodeURIComponent(pedido.salaId)}&data=${pedido.data}`)
      .then(async (res) => {
        const body = await lerJson(res);
        if (cancelado) return;
        if (!res.ok) throw new Error(body.error || "Erro ao carregar a ocupação");
        setReservas(body.ocupacao[pedido.salaId] || []);
      })
      .catch((e) => { if (!cancelado) toast.error(e.message); });
    return () => { cancelado = true; };
  }, [pedido.salaId, pedido.data, recarregar]);

  const bloqueios = reservas
    ? [...reservas.filter((r) => r.id !== pedido.reservaId), { id: "__pretendido", ...pedido.horarioPretendido }]
    : [];
  const inicios = reservas ? opcoesInicio(bloqueios, pedido.data) : [];
  const fins = opcoesFim(bloqueios, inicio);

  // Pré-preenche com a sugestão de quem pediu, se ainda for um horário possível.
  useEffect(() => {
    if (!reservas || !pedido.sugestao) return;
    const { inicio: si, fim: sf } = pedido.sugestao;
    if (inicios.includes(si) && opcoesFim(bloqueios, si).includes(sf)) {
      setInicio(si);
      setFim(sf);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservas]);

  const aceitar = async () => {
    setAEnviar(true);
    try {
      const res = await apiFetch(`/reservas-salas/pedidos/${pedido.salaId}/${pedido.id}/aceitar`, {
        method: "POST",
        body: JSON.stringify({ inicio, fim }),
      });
      const body = await lerJson(res);
      if (!res.ok) {
        toast.error(body.error || "Não foi possível aceitar o pedido");
        // Novo horário entretanto ocupado: recarrega para mostrar só opções válidas.
        if (body.conflitos) {
          setInicio("");
          setFim("");
          setRecarregar((n) => n + 1);
        } else {
          onRespondido();
        }
        return;
      }
      toast.success(body.message || "Pedido aceite");
      onRespondido();
    } catch {
      toast.error("Erro de ligação ao servidor");
    } finally {
      setAEnviar(false);
    }
  };

  return (
    <Modal titulo="Aceitar pedido de alteração" onClose={onClose} largura="max-w-xl">
      <div className="text-sm text-gray-700 space-y-1 mb-4">
        <p className="m-0"><strong>{pedido.salaNome}</strong> ({pedido.sede}) · {formatarData(pedido.data)}</p>
        <p className="m-0">A sua reserva atual: <strong>{horarioTxt(pedido.horarioAtual)}</strong></p>
        <p className="m-0">{getNomeCurto(pedido.requerenteNome)} pretende: <strong>{horarioTxt(pedido.horarioPretendido)}</strong></p>
        {pedido.descricao && <p className="m-0">Motivo: <strong>{pedido.descricao}</strong></p>}
        {pedido.sugestao && <p className="m-0">Sugestão para a sua reserva: <strong>{horarioTxt(pedido.sugestao)}</strong></p>}
      </div>

      {!reservas ? (
        <p className="text-sm text-gray-500">A carregar disponibilidade...</p>
      ) : (
        <>
          <div className="mb-4">
            <TabelaDia reservas={reservas} destacar={[pedido.reservaId]} />
          </div>
          {inicios.length ? (
            <div className="grid grid-cols-2 gap-3 mb-2">
              <Campo label="Novo início da sua reserva">
                <select className={selectClass} value={inicio} onChange={(e) => { setInicio(e.target.value); setFim(""); }}>
                  <option value="">--:--</option>
                  {inicios.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </Campo>
              <Campo label="Novo fim da sua reserva">
                <select className={selectClass} value={fim} onChange={(e) => setFim(e.target.value)} disabled={!inicio}>
                  <option value="">--:--</option>
                  {fins.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </Campo>
            </div>
          ) : (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              Não há nenhum horário livre nesta sala neste dia para onde mover a sua reserva. Pode recusar o pedido ou, se preferir libertar a sala, cancelar a sua reserva em "As minhas reservas".
            </p>
          )}
          <p className="text-xs text-gray-500 mt-2 mb-0">
            Só são mostrados horários livres que não se sobrepõem ao horário pedido.
            {pedido.envolvidos.length > 1 && " Este pedido envolve outras reservas: a alteração só é aplicada quando todos aceitarem."}
          </p>
        </>
      )}

      <div className="flex flex-wrap gap-2 justify-end mt-5">
        <Botao variante="secundario" onClick={onClose}>Voltar</Botao>
        <Botao onClick={aceitar} disabled={!inicio || !fim || aEnviar}>{aEnviar ? "A aceitar..." : "Aceitar e alterar a minha reserva"}</Botao>
      </div>
    </Modal>
  );
}
