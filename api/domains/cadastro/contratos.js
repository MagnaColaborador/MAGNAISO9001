// Contratos de trabalho de um colaborador (subcoleção users/{id}/contratos, um documento
// por contrato: {tipo, entidade, dataInicio, dataFim, observacao, pdf}). Funções puras,
// usadas pelo cadastroController e pelo script de migração (scripts/migrarContratos.js).

// Mesmo valor de TIPO_CONTRATO_A_TERMO_CERTO em client/src/shared/utils/formOptions.js. Um
// contrato a termo certo tem sempre data de início e de fim (não se grava um sem as duas);
// um a termo incerto, tal como um sem termo, pode ficar sem data de fim.
const TIPO_CONTRATO_A_TERMO_CERTO = "Contrato a termo certo";

// Ids "AAAA-MM" a partir da data de início de cada bloco (ex: "2022-08"), com sufixo
// (_2, _3, ...) quando há mais do que um no mesmo mês - mesma ideia dos "registo_DDMMAAAA"
// das Ferias/deslocações. Blocos sem data de início ficam "sem_data". Os ids são
// recalculados a cada gravação (os blocos chegam do frontend com um id temporário, e
// mudar a data de início muda o id), por ordem de data de início e, em empate, do id
// recebido, para o mesmo conjunto de contratos dar sempre os mesmos ids.
function idsPorDataInicio(items) {
  const ordenados = [...items].sort((a, b) =>
    (a.dataInicio || "9999").localeCompare(b.dataInicio || "9999") || String(a.id).localeCompare(String(b.id)));
  const usados = {};
  return ordenados.map(item => {
    const base = /^\d{4}-\d{2}/.test(item.dataInicio || "") ? item.dataInicio.slice(0, 7) : "sem_data";
    usados[base] = (usados[base] || 0) + 1;
    return { ...item, id: usados[base] === 1 ? base : `${base}_${usados[base]}` };
  });
}

// "aaaa-mm-dd" do dia seguinte.
function diaSeguinte(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Contratos do período seguido que termina no contrato atual (o que começa mais tarde),
// por ordem cronológica. Dois contratos são seguidos quando o segundo começa até ao dia a
// seguir ao fim do primeiro (ou se sobrepõem); um contrato sem data de fim (sem termo, ou
// a termo incerto ainda sem fim) fica em aberto, por isso qualquer contrato depois dele continua o mesmo período. Basta
// um dia sem contrato para o período recomeçar. Mudar de entidade empregadora não
// interrompe o período (regra do RH: a data de admissão original mantém-se).
function periodoAtual(contratos) {
  const ordenados = (contratos || [])
    .filter(c => /^\d{4}-\d{2}-\d{2}$/.test(c?.dataInicio || ""))
    .sort((a, b) => a.dataInicio.localeCompare(b.dataInicio) || (a.dataFim || "9999").localeCompare(b.dataFim || "9999"));

  let periodo = [];
  let fim = null; // fim do período em curso; null = em aberto (algum contrato sem data de fim)
  ordenados.forEach(c => {
    if (periodo.length > 0 && fim !== null && c.dataInicio > diaSeguinte(fim)) periodo = [];
    if (periodo.length === 0) fim = c.dataFim || null;
    else if (fim !== null) fim = !c.dataFim ? null : (c.dataFim > fim ? c.dataFim : fim);
    periodo.push(c);
  });
  return periodo;
}

// Campos do documento do colaborador que resumem a lista de contratos, para quem não lê a
// subcoleção: data_admissao (mapa de férias - dias no ano de admissão) é o início do período
// seguido que termina no contrato atual, para uma renovação/mudança de contrato não contar
// como nova admissão; tipo_contrato e data_fim_contrato (relatórios de assiduidade - dias
// depois do fim de um colaborador cessado) são os do contrato atual. Vazios sem contratos.
function resumoContratos(contratos) {
  const periodo = periodoAtual(contratos);
  const atual = periodo[periodo.length - 1];
  return {
    tipo_contrato: atual?.tipo || "",
    data_admissao: periodo[0]?.dataInicio || "",
    data_fim_contrato: atual?.dataFim || "",
  };
}

module.exports = { TIPO_CONTRATO_A_TERMO_CERTO, idsPorDataInicio, periodoAtual, resumoContratos };
