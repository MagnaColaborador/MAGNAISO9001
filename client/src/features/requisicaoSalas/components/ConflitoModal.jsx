import React, { useState } from "react";
import { toast } from "react-toastify";
import { apiFetch } from "../../../shared/utils/apiFetch";
import { getNomeCurto } from "../../../shared/utils/nomeCurto";
import { Modal, Botao, Campo, selectClass } from "./ui";
import { formatarData, horarioTxt, lerJson } from "../salasUtils";

const juntarNomes = (nomes) =>
  nomes.length <= 1 ? nomes.join("") : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;

// Horário pretendido em conflito: em vez de só dizer "indisponível", explica quem tem a
// sala e quando, e oferece perguntar ao(s) dono(s) se podem alterar o horário da reserva.
export default function ConflitoModal({ sala, sede, data, horario, conflitos, descricao, onClose, onEnviado }) {
  const [mensagem, setMensagem] = useState("");
  const [aEnviar, setAEnviar] = useState(false);

  const propria = conflitos.find((c) => c.propria);
  const nomes = [...new Set(conflitos.map((c) => getNomeCurto(c.nome)))];

  const enviar = async () => {
    setAEnviar(true);
    try {
      const res = await apiFetch("/reservas-salas/pedidos", {
        method: "POST",
        body: JSON.stringify({
          salaId: sala.id,
          data,
          ...horario,
          descricao,
          mensagem,
        }),
      });
      const body = await lerJson(res);
      if (!res.ok) {
        toast.error(body.error || "Não foi possível enviar o pedido");
        if (body.livre) onEnviado(false);
        return;
      }
      toast.success(conflitos.length > 1 ? "Pedidos enviados - será avisado(a) por email das respostas" : "Pedido enviado - será avisado(a) por email da resposta");
      onEnviado(true);
    } catch (e) {
      toast.error("Erro de ligação ao servidor");
    } finally {
      setAEnviar(false);
    }
  };

  return (
    <Modal titulo="Horário indisponível" onClose={onClose}>
      <div className="space-y-2 mb-4">
        {conflitos.map((c) => (
          <div key={c.id} className="text-sm text-gray-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            A <strong>{sala.nome}</strong> já está reservada {c.propria ? <strong>por si</strong> : <>por <strong>{getNomeCurto(c.nome)}</strong></>} entre as <strong>{c.inicio}</strong> e as <strong>{c.fim}</strong>.
          </div>
        ))}
      </div>

      {propria ? (
        <>
          <p className="text-sm text-gray-600 mb-5">Já tem uma reserva sua que se sobrepõe a este horário. Escolha outro horário.</p>
          <div className="flex justify-end"><Botao variante="secundario" onClick={onClose}>Voltar</Botao></div>
        </>
      ) : (
        <>
          <p className="text-sm text-gray-700 mb-1">
            Pretende perguntar a <strong>{juntarNomes(nomes)}</strong> se {nomes.length > 1 ? "podem" : "pode"} alterar o horário da reserva?
          </p>
          <p className="text-xs text-gray-500 mb-4">
            Pedido: {sala.nome} ({sede}) · {formatarData(data)} · {horarioTxt(horario)} · "{descricao}".
            {conflitos.length > 1 && " Como envolve várias reservas, só é aplicado se todos aceitarem."}
            {" "}Nenhuma reserva é alterada sem a confirmação do respetivo dono.
          </p>

          <Campo label="Mensagem (opcional)">
            <textarea
              className={`${selectClass} min-h-[70px]`}
              maxLength={500}
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value)}
              placeholder="Ex.: Tenho uma reunião com um cliente que só pode a esta hora."
            />
          </Campo>

          <div className="flex flex-wrap gap-2 justify-end mt-5">
            <Botao variante="secundario" onClick={onClose}>Voltar</Botao>
            <Botao onClick={enviar} disabled={aEnviar}>
              {aEnviar ? "A enviar..." : "Perguntar se pode alterar o horário"}
            </Botao>
          </div>
        </>
      )}
    </Modal>
  );
}
