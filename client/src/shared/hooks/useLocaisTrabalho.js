import { useEffect, useState } from "react";
import { apiFetch } from "../utils/apiFetch";

// Locais de trabalho (sedes) - a fonte de verdade é o backend
// (api/shared/lib/locaisTrabalho.js); o frontend nunca tem uma cópia própria da lista.
// Cache ao nível do módulo: o pedido a /config/locais-trabalho é feito uma única vez por
// sessão da app e partilhado por todos os componentes que usam este hook (Cadastro,
// Requisição de Salas, Gerir salas), mesmo que montem ao mesmo tempo. Se o pedido falhar,
// a cache é limpa para o próximo componente voltar a tentar.
let cache = null;
let pedidoEmCurso = null;

function carregarLocais() {
  if (!pedidoEmCurso) {
    pedidoEmCurso = apiFetch("/config/locais-trabalho")
      .then(async (res) => {
        if (!res.ok) throw new Error("Erro ao carregar os locais de trabalho");
        const body = await res.json();
        cache = body.locaisTrabalho || [];
        return cache;
      })
      .catch((error) => {
        pedidoEmCurso = null;
        throw error;
      });
  }
  return pedidoEmCurso;
}

// Devolve { locais: [{ nome, morada }], nomes: ["Porto", ...], labels: { Porto: "Porto - morada" },
// aCarregar, erro }. "nomes" é o equivalente direto da antiga LOCAL_OPTIONS.
export function useLocaisTrabalho() {
  const [locais, setLocais] = useState(cache);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    if (cache) return undefined;
    let ativo = true;
    carregarLocais()
      .then((lista) => { if (ativo) setLocais(lista); })
      .catch((e) => { if (ativo) setErro(e); });
    return () => { ativo = false; };
  }, []);

  const lista = locais || [];
  return {
    locais: lista,
    nomes: lista.map((l) => l.nome),
    labels: Object.fromEntries(lista.map((l) => [l.nome, l.morada ? `${l.nome} - ${l.morada}` : l.nome])),
    aCarregar: !locais && !erro,
    erro,
  };
}
