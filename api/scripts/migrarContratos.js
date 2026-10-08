// Script único: passa os contratos de trabalho de cada colaborador para a subcoleção
// users/{id}/contratos (um documento por contrato, ver api/domains/cadastro/contratos.js):
//   - os contratos anteriores (subcoleção users/{id}/contratosAnteriores), tal como estão;
//   - o contrato atual, que vivia no próprio documento do colaborador (tipo_contrato,
//     data_admissao, data_fim_contrato) + o PDF em users/{id}/docs/digitalizacao_contrato,
//     com a entidade do colaborador como entidade empregadora. Num contrato sem termo, a
//     data de fim guardada é descartada (o campo estava escondido no ecrã - é a de quando o
//     contrato ainda era a termo).
// Depois apaga a estrutura antiga e grava no documento do colaborador o resumo da nova
// lista (resumoContratos: tipo_contrato, data_admissao, data_fim_contrato - usados pelo
// mapa de férias e pelos relatórios de assiduidade). Os PDFs não mudam de sítio no
// Storage, só passa a ser o documento do contrato a apontar para eles.
//
// Sem argumentos só simula: mostra o que faria a cada colaborador e assinala o que precisa
// de atenção (data de admissão que muda, contratos sem data de início, contratos a termo certo
// sem data de fim, possíveis duplicados). Com --aplicar grava.
//
// Idempotente: colaboradores que já têm a subcoleção "contratos" ficam como estão.
//
// Uso: node api/scripts/migrarContratos.js [--aplicar]

const { db } = require("../shared/db/firebase");
const { TIPO_CONTRATO_A_TERMO_CERTO, idsPorDataInicio, resumoContratos } = require("../domains/cadastro/contratos");

const APLICAR = process.argv.includes("--aplicar");
const TIPO_CONTRATO_SEM_TERMO = "Contrato sem termo";

function fmt(c) {
  return `${c.dataInicio || "?"} a ${c.dataFim || "(sem fim)"} · ${c.tipo || "sem tipo"} · ${c.entidade || "sem entidade"}${c.pdf ? " · PDF" : ""}`;
}

async function main() {
  console.log(APLICAR ? "== A APLICAR ==\n" : "== SIMULAÇÃO (nada é gravado; usar --aplicar para gravar) ==\n");

  const entidadesSnap = await db.collection("entidades").get();
  const nomeEntidade = Object.fromEntries(entidadesSnap.docs.map(d => [`entidades/${d.id}`, d.data().nome || d.id]));

  const usersSnap = await db.collection("users").get();
  const totais = { migrados: 0, jaMigrados: 0, semContratos: 0, comAvisos: 0 };

  for (const userDoc of usersSnap.docs) {
    const data = userDoc.data();
    const ref = userDoc.ref;
    const nome = data.nome || data.email || userDoc.id;

    const [novosSnap, anterioresSnap, pdfAtualDoc] = await Promise.all([
      ref.collection("contratos").limit(1).get(),
      ref.collection("contratosAnteriores").get(),
      ref.collection("docs").doc("digitalizacao_contrato").get(),
    ]);

    if (!novosSnap.empty) {
      totais.jaMigrados++;
      continue;
    }

    const lista = anterioresSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const avisos = [];

    const pdfAtual = pdfAtualDoc.exists ? pdfAtualDoc.data() : null;
    if (data.tipo_contrato || data.data_admissao || data.data_fim_contrato || pdfAtual) {
      const semTermo = data.tipo_contrato === TIPO_CONTRATO_SEM_TERMO;
      if (semTermo && data.data_fim_contrato) {
        avisos.push(`contrato atual sem termo tinha data de fim escondida ${data.data_fim_contrato} (descartada)`);
      }
      lista.push({
        id: "~atual",
        tipo: data.tipo_contrato || "",
        entidade: nomeEntidade[data.entidade] || "",
        dataInicio: data.data_admissao || "",
        dataFim: semTermo ? "" : (data.data_fim_contrato || ""),
        observacao: "",
        pdf: pdfAtual || null,
      });
    }

    if (lista.length === 0) {
      totais.semContratos++;
      continue;
    }

    lista.forEach(c => {
      if (!c.dataInicio) {
        avisos.push(`contrato sem data de início (${fmt(c)}) - não conta para a antiguidade nem para a data de admissão`);
      } else if (c.tipo === TIPO_CONTRATO_A_TERMO_CERTO && !c.dataFim) {
        avisos.push(`contrato a termo certo sem data de fim (${fmt(c)}) - a ficha não grava até ser corrigido`);
      }
    });
    const vistos = new Set();
    lista.forEach(c => {
      const chave = `${c.dataInicio}|${c.tipo}`;
      if (c.dataInicio && vistos.has(chave)) avisos.push(`possível duplicado: ${fmt(c)}`);
      vistos.add(chave);
    });

    const resumo = resumoContratos(lista);
    const mudancas = Object.entries(resumo)
      .filter(([k, v]) => (data[k] || "") !== v)
      .map(([k, v]) => `${k}: ${data[k] || "(vazio)"} -> ${v || "(vazio)"}`);

    const comIds = idsPorDataInicio(lista);
    console.log(`${nome} (${userDoc.id})`);
    comIds.forEach(c => console.log(`   contratos/${c.id}: ${fmt(c)}`));
    if (mudancas.length) console.log(`   ficha: ${mudancas.join("; ")}`);
    avisos.forEach(a => console.log(`   ATENÇÃO: ${a}`));
    if (avisos.length) totais.comAvisos++;

    if (APLICAR) {
      const batch = db.batch();
      comIds.forEach(({ id, ...contrato }) => batch.set(ref.collection("contratos").doc(id), contrato));
      anterioresSnap.docs.forEach(d => batch.delete(d.ref));
      if (pdfAtualDoc.exists) batch.delete(pdfAtualDoc.ref);
      batch.update(ref, resumo);
      await batch.commit();
    }
    totais.migrados++;
  }

  console.log(`\n${APLICAR ? "Migrados" : "A migrar"}: ${totais.migrados} (${totais.comAvisos} com avisos) · já migrados: ${totais.jaMigrados} · sem contratos: ${totais.semContratos}`);
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
