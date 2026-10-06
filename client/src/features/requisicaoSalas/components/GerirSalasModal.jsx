import React, { useState } from "react";
import { toast } from "react-toastify";
import { apiFetch } from "../../../shared/utils/apiFetch";
import { useLocaisTrabalho } from "../../../shared/hooks/useLocaisTrabalho";
import { Modal, Botao, selectClass } from "./ui";
import { lerJson } from "../salasUtils";

// Gestão de salas (SuperAdmin/GestorRH - requireAdminOrHR no backend). Os locais de
// trabalho não se gerem aqui: são os do Cadastro, vindos do backend
// (GET /config/locais-trabalho), e o backend volta a validar o local de cada sala. Nunca
// se apaga uma sala: desativar esconde-a e impede novas reservas, sem partir reservas e
// pedidos já existentes.
function LinhaSala({ sala, locais, onGuardar, onAlternar }) {
  const [editar, setEditar] = useState(false);
  const [nome, setNome] = useState(sala.nome);
  const [sede, setSede] = useState(sala.sede);

  if (editar) {
    return (
      <div className="flex flex-wrap items-center gap-2 py-1.5">
        <input className={`${selectClass} py-1 flex-1 min-w-[160px]`} value={nome} onChange={(e) => setNome(e.target.value)} maxLength={100} autoFocus />
        <select className={`${selectClass} py-1 w-auto`} value={sede} onChange={(e) => setSede(e.target.value)}>
          {!locais.includes(sede) && <option value={sede}>{sede || "Selecionar..."}</option>}
          {locais.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <Botao
          className="px-3 py-1 text-xs"
          disabled={!nome.trim() || !locais.includes(sede)}
          onClick={async () => {
            const alteracoes = {};
            if (nome.trim() !== sala.nome) alteracoes.nome = nome.trim();
            if (sede !== sala.sede) alteracoes.sede = sede;
            if (!Object.keys(alteracoes).length || await onGuardar(alteracoes)) setEditar(false);
          }}
        >Guardar</Botao>
        <Botao variante="secundario" className="px-3 py-1 text-xs" onClick={() => { setNome(sala.nome); setSede(sala.sede); setEditar(false); }}>Cancelar</Botao>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className={`flex-1 text-sm text-gray-700 ${sala.ativa ? "" : "line-through text-gray-400"}`}>{sala.nome}</span>
      {!sala.ativa && <span className="text-xs text-gray-400">desativada</span>}
      <Botao variante="secundario" className="px-2 py-1 text-xs" onClick={() => setEditar(true)}>Editar</Botao>
      <Botao variante={sala.ativa ? "perigo" : "secundario"} className="px-2 py-1 text-xs" onClick={onAlternar}>{sala.ativa ? "Desativar" : "Ativar"}</Botao>
    </div>
  );
}

export default function GerirSalasModal({ estrutura, onClose, onAlterada }) {
  const { nomes: locais, aCarregar } = useLocaisTrabalho();
  const [novasSalas, setNovasSalas] = useState({});

  const pedir = async (url, method, body, sucesso) => {
    try {
      const res = await apiFetch(url, { method, body: JSON.stringify(body) });
      const resposta = await lerJson(res);
      if (!res.ok) {
        toast.error(resposta.error || "Não foi possível guardar");
        return false;
      }
      toast.success(sucesso);
      onAlterada();
      return true;
    } catch {
      toast.error("Erro de ligação ao servidor");
      return false;
    }
  };

  // Salas cujo local deixou de existir na lista do backend - continuam visíveis aqui para
  // poderem ser movidas para um local válido.
  const semLocal = estrutura.salas.filter((s) => !locais.includes(s.sede));
  const grupos = [
    ...locais.map((l) => ({ local: l, salas: estrutura.salas.filter((s) => s.sede === l) })),
    ...(semLocal.length && !aCarregar ? [{ local: null, salas: semLocal }] : []),
  ];

  const renderSala = (sala) => (
    <LinhaSala
      key={sala.id}
      sala={sala}
      locais={locais}
      onGuardar={(alteracoes) => pedir(`/reservas-salas/salas/${sala.id}`, "PATCH", alteracoes, "Sala atualizada")}
      onAlternar={() => pedir(`/reservas-salas/salas/${sala.id}`, "PATCH", { ativa: !sala.ativa }, sala.ativa ? "Sala desativada" : "Sala ativada")}
    />
  );

  return (
    <Modal titulo="Gerir salas" onClose={onClose} largura="max-w-2xl">
      <p className="text-xs text-gray-500 mt-0 mb-4">
        Os locais de trabalho são os mesmos do Cadastro. Cada sala pertence a um local.
      </p>
      {aCarregar && <p className="text-sm text-gray-500">A carregar locais de trabalho...</p>}

      <div className="space-y-4">
        {grupos.map(({ local, salas }) => (
          <div key={local || "__sem_local"} className="border border-gray-200 rounded-md p-4">
            <div className="text-sm font-semibold text-gray-800">{local || "Local inválido"}</div>
            <div className="pl-4 border-l-2 border-[#EDE0C4] mt-2">
              {!salas.length && <p className="text-xs text-gray-400 my-1">Ainda sem salas.</p>}
              {salas.map(renderSala)}
              {local && (
                <div className="flex gap-2 mt-2">
                  <input
                    className={`${selectClass} py-1`}
                    placeholder="Nome da nova sala"
                    maxLength={100}
                    value={novasSalas[local] || ""}
                    onChange={(e) => setNovasSalas((n) => ({ ...n, [local]: e.target.value }))}
                  />
                  <Botao className="px-3 py-1 text-xs whitespace-nowrap" disabled={!(novasSalas[local] || "").trim()} onClick={async () => {
                    const ok = await pedir("/reservas-salas/salas", "POST", { nome: novasSalas[local].trim(), sede: local }, "Sala criada");
                    if (ok) setNovasSalas((n) => ({ ...n, [local]: "" }));
                  }}>Adicionar sala</Botao>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
