import React, { useContext, useState, useRef, useEffect, useMemo } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { toast } from "react-toastify";
import { UserContext } from "../../../shared/context/userContext";
import Sidebar from "../../../shared/components/Sidebar";
import Topbar from "../../../shared/components/Topbar";
import AutocompleteInput from "../../../shared/components/AutocompleteInput";
import {
  FaUser, FaLocationDot, FaUsers, FaFileContract,
  FaGraduationCap, FaCloudArrowUp, FaArrowUpRightFromSquare,
  FaCircleMinus, FaPencil, FaCheck, FaArrowLeft,
  FaUserGraduate, FaPlus, FaChevronDown, FaNotesMedical,
  FaTriangleExclamation, FaPaperPlane,
} from "react-icons/fa6";
import { apiFetch } from "../../../shared/utils/apiFetch";
import { usePermissions } from "../../../shared/hooks/usePermissions";
import { useLocaisTrabalho } from "../../../shared/hooks/useLocaisTrabalho";
import { getNomeCurto } from "../../../shared/utils/nomeCurto";
import {
  validarNIF, validarNISS, validarIBAN, validarCodigoPostal, validarTelefone, validarCartaoCidadao,
} from "../../../shared/utils/validators";
import {
  SITUACAO_CONJUGAL_OPTIONS, GRAU_PARENTESCO_OPTIONS, IRS_JOVEM_OPTIONS,
  TIPO_CONTRATO_OPTIONS, SITUACAO_CONTRATUAL_OPTIONS, DEPARTAMENTO_OPTIONS,
  TIPO_BAIXA_OPTIONS, SITUACAO_CESSADO, MOTIVO_CESSACAO_OPTIONS,
  TIPO_CONTRATO_A_TERMO_CERTO,
  TIPO_ESTAGIO_OPTIONS, TIPO_ESTAGIO_PROFISSIONAL, HABILITACOES_OPTIONS, FUNCAO,
} from "../../../shared/utils/formOptions";

const GOLD = "#C8932F";

const DIA_MS = 24 * 60 * 60 * 1000;

// "aaaa-mm-dd" -> Date, ou null se faltar ou for inválida.
function parseData(str) {
  if (!str) return null;
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Diferença de calendário entre duas datas (fim >= inicio), em meses completos + dias restantes.
function diferencaMesesDias(inicio, fim) {
  let meses = (fim.getFullYear() - inicio.getFullYear()) * 12 + (fim.getMonth() - inicio.getMonth());
  let dias = fim.getDate() - inicio.getDate();
  if (dias < 0) {
    meses -= 1;
    dias += new Date(fim.getFullYear(), fim.getMonth(), 0).getDate();
  }
  return { meses, dias };
}

// Duração entre duas datas ("aaaa-mm-dd"), devolvida já formatada em meses e dias
// (ex: "9 meses e 12 dias")  -  ou null se as datas faltarem ou forem inválidas.
function formatDuracao(inicioStr, fimStr) {
  const inicio = parseData(inicioStr);
  const fim = parseData(fimStr);
  if (!inicio || !fim || fim < inicio) return null;

  const { meses, dias } = diferencaMesesDias(inicio, fim);
  const partes = [];
  if (meses > 0) partes.push(`${meses} ${meses === 1 ? "mês" : "meses"}`);
  if (dias > 0 || partes.length === 0) partes.push(`${dias} ${dias === 1 ? "dia" : "dias"}`);
  return partes.join(" e ");
}

// Nº total de meses em anos e meses (ex: "1 ano e 8 meses")  -  ao contrário de
// formatDuracao (meses/dias), pensado para durações longas como a antiguidade.
function formatAntiguidade(totalMeses) {
  if (totalMeses === null || totalMeses === undefined) return null;
  const anos = Math.floor(totalMeses / 12);
  const meses = totalMeses % 12;
  const partes = [];
  if (anos > 0) partes.push(`${anos} ${anos === 1 ? "ano" : "anos"}`);
  if (meses > 0 || partes.length === 0) partes.push(`${meses} ${meses === 1 ? "mês" : "meses"}`);
  return partes.join(" e ");
}

// Duração de um contrato em anos e meses (os dias que sobram não contam), com a data de
// fim inclusiva (01/01 a 31/12 dá "1 ano"). Sem data de fim, conta até hoje. Ao contrário da
// antiguidade, um fim no futuro conta por inteiro (é a duração do contrato, não o tempo já
// cumprido). null se faltar a data de início ou as datas forem inválidas.
function formatDuracaoContrato(inicioStr, fimStr, hojeStr) {
  const inicio = parseData(inicioStr);
  const fim = parseData(fimStr || hojeStr);
  if (!inicio || !fim || fim < inicio) return null;
  return formatAntiguidade(diferencaMesesDias(inicio, new Date(fim.getTime() + DIA_MS)).meses);
}

// Antiguidade total, em meses, a partir da lista de contratos ({dataInicio, dataFim}). Não é
// uma soma das durações: os períodos são unidos, por isso dias sobrepostos contam uma só vez
// e intervalos sem contrato não contam. Datas de fim são inclusivas e limitadas a hoje (um
// contrato com fim no futuro só conta até ao presente). Um contrato sem data de fim (sem
// termo, ou a termo incerto ainda sem fim) conta até hoje. null se não houver nenhum período.
function calcularAntiguidadeMeses(contratos, hojeStr) {
  const hoje = parseData(hojeStr);
  const periodos = (contratos || [])
    .map(c => ({ inicio: c.dataInicio, fim: c.dataFim || hojeStr }))
    .map(p => {
      const inicio = parseData(p.inicio);
      const fim = parseData(p.fim);
      if (!inicio || !fim || inicio > hoje) return null;
      const fimLimitado = fim > hoje ? hoje : fim;
      if (fimLimitado < inicio) return null;
      // Fim exclusivo (dia seguinte), para o último dia de cada contrato também contar.
      return { inicio, fim: new Date(fimLimitado.getTime() + DIA_MS) };
    })
    .filter(Boolean)
    .sort((a, b) => a.inicio - b.inicio);

  if (periodos.length === 0) return null;

  // Une períodos sobrepostos ou seguidos (ex: um contrato termina a 31/08 e o seguinte começa a 01/09).
  const unidos = [];
  periodos.forEach(p => {
    const ultimo = unidos[unidos.length - 1];
    if (ultimo && p.inicio <= ultimo.fim) {
      if (p.fim > ultimo.fim) ultimo.fim = p.fim;
    } else {
      unidos.push({ ...p });
    }
  });

  // Soma meses de calendário de cada período; os dias que sobram de todos os períodos
  // juntos convertem-se em meses a 30 dias por mês.
  let totalMeses = 0;
  let totalDias = 0;
  unidos.forEach(p => {
    const { meses, dias } = diferencaMesesDias(p.inicio, p.fim);
    totalMeses += meses;
    totalDias += dias;
  });
  return totalMeses + Math.floor(totalDias / 30);
}

const SECTIONS = [
  {
    title: "Dados pessoais",
    Icon: FaUser,
    fields: [
      { key: "nome_completo", label: "Nome completo", type: "text" },
      { key: "data_nascimento", label: "Data de nascimento", type: "date" },
      { key: "nacionalidade", label: "Nacionalidade", type: "text" },
      { key: "n_cartao_cidadao", label: "Nº cartão de cidadão", type: "text" },
      { key: "validade_cc", label: "Validade do CC", type: "date" },
      { key: "nif", label: "NIF", type: "text", newRow: true },
      { key: "n_seguranca_social", label: "Nº segurança social", type: "text" },
      { key: "digitalizacao_cc", label: "Digitalização CC (frente e verso)", type: "file", storageName: "CC_Frente_Verso" },
    ],
  },
  {
    title: "Morada e contactos",
    Icon: FaLocationDot,
    fields: [
      { key: "morada", label: "Morada", type: "text" },
      { key: "codigo_postal", label: "Código postal", type: "text", placeholder: "0000-000" },
      { key: "localidade", label: "Localidade", type: "text" },
      { key: "telefone", label: "Contacto", type: "tel" },
      { key: "telefone_emergencia", label: "Contacto de emergência", type: "tel" },
      { key: "grau_parentesco_emergencia", label: "Grau de parentesco (contacto de emergência)", type: "select", options: GRAU_PARENTESCO_OPTIONS },
      { key: "email", label: "Email", type: "email", readOnly: true },
    ],
  },
  {
    title: "Dados fiscais/IRS",
    Icon: FaUsers,
    fields: [
      { key: "situacao_conjugal", label: "Situação conjugal", type: "select", options: SITUACAO_CONJUGAL_OPTIONS, newRow: true },
      { key: "n_titulares", label: "Nº titulares do agregado familiar", type: "number" },
      { key: "n_dependentes", label: "Nº dependentes", type: "number" },
      { key: "tem_dependentes_deficientes", label: "Dependentes com deficiência", type: "toggle" },
      { key: "n_dependentes_deficientes", label: "Nº dependentes com deficiência", type: "number", showIf: f => f.tem_dependentes_deficientes === true },
      { key: "declarante_deficiente", label: "Tem incapacidade superior a 60%", type: "toggle" },
      { key: "irs_jovem", label: "IRS jovem", type: "toggle", newRow: true },
      { key: "escalao_irs_jovem", label: "Escalão de isenção", type: "select", options: IRS_JOVEM_OPTIONS, showIf: f => f.irs_jovem === true },
      { key: "digitalizacao_pedido_irs_jovem", label: "Pedido de aplicação de IRS Jovem (PDF)", type: "file", showIf: f => f.irs_jovem === true, storageName: "Pedido_IRS_Jovem" },
      { key: "IBAN", label: "IBAN", type: "text", newRow: true },
      { key: "IBAN_digitalizacao", label: "Comprovativo do IBAN", type: "file", storageName: "Comprovativo_IBAN" },
    ],
  },
  {
    title: "Formação e habilitações",
    Icon: FaGraduationCap,
    fields: [
      { key: "area_formacao", label: "Área de formação", type: "text" },
      { key: "habilitacoes", label: "Habilitações literárias", type: "text", list: "habilitacoes" },
      { key: "ccp", label: "CCP (Certificado de Competências Pedagógicas)", type: "toggle" },
      { key: "certificado_habilitacoes", label: "Certificado de habilitações", type: "file", storageName: "Certificado_Habilitacoes" },
      { key: "digitalizacao_ccp", label: "Comprovativo do CCP", type: "file", showIf: f => f.ccp === true, storageName: "CCP" },
      { key: "ficha_dgert_atualizada", label: "Ficha curricular DGERT atualizada", type: "file", storageName: "Ficha_DGERT" },
      { key: "cv_atualizado", label: "CV atualizado", type: "file", storageName: "CV" },
    ],
  },
  {
    title: "Dados contratuais ",
    Icon: FaFileContract,
    restricted: true,
    fields: [
      { key: "situacao_contratual", label: "Situação contratual", type: "select", options: SITUACAO_CONTRATUAL_OPTIONS },
      { key: "antiguidade", label: "Antiguidade", type: "tenure", historyKey: "contratos" },
      { key: "motivo_cessacao", label: "Motivo da cessação", type: "select", options: MOTIVO_CESSACAO_OPTIONS, showIf: f => f.situacao_contratual === SITUACAO_CESSADO },
      { key: "role", label: "Função", type: "text", list: "funcao", newRow: true },
      { key: "departamento", label: "Departamento", type: "select", options: DEPARTAMENTO_OPTIONS },
      // Opções vindas do backend (GET /config/locais-trabalho, ver useLocaisTrabalho) - a
      // lista de locais de trabalho não existe no frontend.
      { key: "sede", label: "Local de trabalho", type: "select", optionsSource: "locaisTrabalho" },
      // Todos os contratos de trabalho, atual incluído (subcoleção users/{id}/contratos, um
      // bloco por contrato). O backend resume a lista nos campos tipo_contrato/data_admissao/
      // data_fim_contrato do documento do user, usados pelo mapa de férias e pelos relatórios
      // (ver resumoContratos em api/domains/cadastro/contratos.js).
      {
        key: "contratos", label: "Contratos de trabalho", type: "blocks", apiKey: "contratos",
        storageFolder: "contratos",
        showDuracao: true,
        itemSingular: "contrato", addLabel: "Adicionar contrato", emptyLabel: "Sem contratos de trabalho registados",
        tipoLabel: "Tipo de contrato", tipoOptions: TIPO_CONTRATO_OPTIONS,
        // "entidadePadrao": um contrato novo já vem com a entidade do colaborador preenchida.
        entidadeLabel: "Entidade empregadora", list: "entidades", entidadePadrao: true,
        dataFimLabel: "Data de fim", pdfName: "contrato", observacaoLabel: "Observação",
        sortByDataInicio: true,
      },
      {
        key: "cedencias_temporarias", label: "Cedências temporárias", type: "blocks", apiKey: "cedencias",
        storageFolder: "cedenciasTemporarias",
        itemSingular: "cedência", entidadeLabel: "Entidade de céssionária", dataFimLabel: "Data de fim", pdfName: "PDF",
        observacaoLabel: "Observação", list: "entidades",
      },
      { key: "digitalizacao_acordos_desvinculacao", label: "Digitalização de acordos de desvinculação", type: "file", storageName: "Acordo_Desvinculacao" },
    ],
  },
  {
    title: "Baixas/Licenças",
    Icon: FaNotesMedical,
    restricted: false,
    fields: [
      {
        key: "baixas_medicas", label: "Registos", type: "blocks", apiKey: "baixasMedicas",
        storageFolder: "baixasMedicas",
        itemSingular: "baixa médica", dataFimLabel: "Data de fim (prevista)", pdfName: "comprovativo médico",
        tipoLabel: "Tipo", tipoOptions: TIPO_BAIXA_OPTIONS,
      },
    ],
  },
  {
    title: "Dados de estágio",
    Icon: FaUserGraduate,
    restricted: true,
    isEstagio: true,
    fields: [
      { key: "tipo_estagio", label: "Tipo de estágio", type: "select", options: TIPO_ESTAGIO_OPTIONS },
      { key: "n_processo_estagio", label: "Nº de processo", type: "text", showIf: f => f.tipo_estagio === TIPO_ESTAGIO_PROFISSIONAL },
      { key: "id_processo_estagio", label: "ID do processo", type: "text", showIf: f => f.tipo_estagio === TIPO_ESTAGIO_PROFISSIONAL },
      { key: "entidade_medida", label: "Entidade/Medida", type: "text", newRow: true },
      { key: "area_funcao", label: "Área/função", type: "text" },
      { key: "habilitacoes_estagio", label: "Habilitações", type: "text", list: "habilitacoes" },
      { key: "data_inicio_estagio", label: "Data de início do estágio", type: "date" },
      { key: "data_fim_estagio", label: "Data de fim do estágio", type: "date" },
      { key: "duracao_estagio", label: "Duração", type: "duration", fromKey: "data_inicio_estagio", toKey: "data_fim_estagio" },
      { key: "entidade_estagio", label: "Entidade de estágio", type: "text", list: "entidades" },
      { key: "orientador", label: "Orientador", type: "text", list: "colaboradores" },
      { key: "observacao_estagio", label: "Observações", type: "textarea" },
      { key: "digitalizacao_contrato_estagio", label: "Digitalização do contrato de estágio", type: "file", storageName: "Contrato_Estagio" },
      { key: "outra_documentacao_estagio", label: "Outra documentação de estágio", type: "file", multiple: true },
    ],
  },
];

// Tipos que não correspondem a um campo guardado no "form": "file" vive à parte em
// docRefs, "duration"/"tenure" são sempre calculados a partir de outro campo (nunca
// editáveis), "blocks" vive à parte em blockLists (cada um numa subcoleção própria  -  ver BLOCK_FIELDS)
const NON_STORED_TYPES = ["file", "duration", "blocks", "tenure"];
const ESTAGIO_SECTION = SECTIONS.find(s => s.isEstagio);
const ESTAGIO_FIELD_KEYS = ESTAGIO_SECTION.fields.filter(f => f.type !== "duration").map(f => f.key);

const ALL_FIELDS = SECTIONS.flatMap(s => s.fields);
const FIELD_BY_KEY = Object.fromEntries(ALL_FIELDS.map(f => [f.key, f]));
// Título da secção a que cada campo pertence - usado para reabrir automaticamente a
// secção certa quando se tenta gravar com erros de validação lá dentro.
const SECTION_BY_FIELD_KEY = Object.fromEntries(SECTIONS.flatMap(s => s.fields.map(f => [f.key, s.title])));
const INITIAL_FORM = ALL_FIELDS.filter(f => !NON_STORED_TYPES.includes(f.type)).reduce((acc, f) => {
  acc[f.key] = f.type === "toggle" ? false : "";
  return acc;
}, {});

// Campos que contam para "perfil completo": todos os das secções não-restritas (o próprio
// colaborador pode preenchê-los  -  excluem-se "Dados contratuais"/"Estágio", que são só de
// RH), à exceção de "toggle" (um booleano está sempre "respondido", mesmo a false), "email"
// (conta da plataforma, não é preenchido no cadastro), "duration"/"tenure"/"blocks" (não
// vivem no "form" - "blocks" em particular, como "Registos" de baixas médicas, não ter
// nenhum registo é um estado válido, não um campo por preencher) e dos campos em
// COMPLETENESS_EXCLUDED_KEYS (não são obrigatórios apesar de estarem numa secção não-restrita).
const COMPLETENESS_EXCLUDED_TYPES = ["duration", "tenure", "blocks"];
const COMPLETENESS_EXCLUDED_KEYS = ["email", "ficha_dgert_atualizada", "digitalizacao_pedido_irs_jovem"];
const COMPLETENESS_FIELDS = SECTIONS
  .filter(s => !s.restricted)
  .flatMap(s => s.fields)
  .filter(f => f.type !== "toggle" && !COMPLETENESS_EXCLUDED_KEYS.includes(f.key) && !COMPLETENESS_EXCLUDED_TYPES.includes(f.type));

// Campos em falta (respeitando "showIf"  -  um campo escondido pelas respostas atuais não
// conta) de entre os COMPLETENESS_FIELDS, dado o form e os documentos já carregados.
function getMissingFields(dataSource, docs) {
  return COMPLETENESS_FIELDS.filter(f => {
    if (f.showIf && !f.showIf(dataSource)) return false;
    if (f.type === "file") return !docs[f.key];
    const value = dataSource[f.key];
    return value === undefined || value === null || value === "";
  });
}

// Erros de validação por campo (chave -> { message, blocking }), a partir do form/documentos
// atuais. "blocking: true" impede o "Guardar" (dado ativamente errado: formato inválido,
// datas invertidas, números que não batem certo); "blocking: false" é só um aviso visual
// (campo que a política atual pede mas que fichas antigas podem legitimamente não ter -
// nunca trava quem só está a editar outra coisa na mesma ficha). Um campo simplesmente por
// preencher (sem essa inconsistência) não entra aqui - isso já é tratado à parte por
// getMissingFields. Só assinala formato quando o valor já está "aparentemente completo"
// (evita mostrar "NIF inválido" enquanto o utilizador ainda está a escrever o 3º dígito).
function getFieldErrors(form, docs) {
  const errors = {};
  const hoje = new Date().toISOString().slice(0, 10);
  const set = (key, message, blocking) => { errors[key] = { message, blocking }; };

  const nifDigitos = (form.nif || "").replace(/\D/g, "");
  if (nifDigitos.length >= 9 && !validarNIF(form.nif)) set("nif", "NIF inválido", true);

  const nissDigitos = (form.n_seguranca_social || "").replace(/\D/g, "");
  if (nissDigitos.length >= 11 && !validarNISS(form.n_seguranca_social)) set("n_seguranca_social", "Nº de segurança social inválido", true);

  const ccLimpo = (form.n_cartao_cidadao || "").replace(/\s/g, "");
  if (ccLimpo.length >= 12 && !validarCartaoCidadao(form.n_cartao_cidadao)) set("n_cartao_cidadao", "Nº de cartão de cidadão inválido", true);

  if ((form.codigo_postal || "").length >= 8 && !validarCodigoPostal(form.codigo_postal)) set("codigo_postal", "Formato esperado: 0000-000", true);

  const telDigitos = (form.telefone || "").replace(/\D/g, "");
  if (telDigitos.length >= 9 && !validarTelefone(form.telefone)) set("telefone", "Contacto inválido", true);

  const telEmergDigitos = (form.telefone_emergencia || "").replace(/\D/g, "");
  if (telEmergDigitos.length >= 9 && !validarTelefone(form.telefone_emergencia)) set("telefone_emergencia", "Contacto inválido", true);

  const ibanLimpo = (form.IBAN || "").replace(/\s/g, "");
  if (ibanLimpo.length >= 25 && !validarIBAN(form.IBAN)) set("IBAN", "IBAN inválido", true);

  if (form.data_nascimento && form.data_nascimento > hoje) set("data_nascimento", "Data de nascimento no futuro", true);
  if (form.validade_cc && form.data_nascimento && form.validade_cc < form.data_nascimento) set("validade_cc", "Anterior à data de nascimento", true);

  if (form.n_titulares !== "" && (!Number.isInteger(Number(form.n_titulares)) || Number(form.n_titulares) < 1)) set("n_titulares", "Tem de ser um número inteiro ≥ 1", true);
  if (form.n_dependentes !== "" && (!Number.isInteger(Number(form.n_dependentes)) || Number(form.n_dependentes) < 0)) set("n_dependentes", "Tem de ser um número inteiro ≥ 0", true);

  if (form.tem_dependentes_deficientes === true) {
    const nDef = form.n_dependentes_deficientes;
    if (nDef === "" || nDef === undefined || nDef === null) {
      set("n_dependentes_deficientes", "Obrigatório", false);
    } else if (!Number.isInteger(Number(nDef)) || Number(nDef) < 1) {
      set("n_dependentes_deficientes", "Tem de ser um número inteiro ≥ 1", true);
    } else if (Number(nDef) > Number(form.n_dependentes || 0)) {
      set("n_dependentes_deficientes", "Não pode exceder o nº de dependentes", true);
    }
  }

  // Estas condições "obrigatório se X" são política a incentivar, não dados errados - fichas
  // já guardadas antes desta validação existir não podem ficar presas por causa delas.
  if (form.irs_jovem === true && !form.escalao_irs_jovem) set("escalao_irs_jovem", "Obrigatório", false);
  if (form.ccp === true && !docs.digitalizacao_ccp) set("digitalizacao_ccp", "Documento obrigatório", false);

  if (form.situacao_contratual === SITUACAO_CESSADO && !form.motivo_cessacao) set("motivo_cessacao", "Obrigatório", false);

  if (form.tipo_estagio === TIPO_ESTAGIO_PROFISSIONAL) {
    if (!form.n_processo_estagio) set("n_processo_estagio", "Obrigatório", false);
    if (!form.id_processo_estagio) set("id_processo_estagio", "Obrigatório", false);
  }
  if (form.data_fim_estagio && form.data_inicio_estagio && form.data_fim_estagio < form.data_inicio_estagio) set("data_fim_estagio", "Anterior à data de início", true);

  return errors;
}

// Erros de validação dos campos "blocks" (cedências temporárias, baixas médicas, contratos):
// por chave do campo, um mapa de id de bloco -> { message, blocking } (ordem das datas e,
// nos contratos a termo certo, as duas datas preenchidas - ver getFieldErrors para o que significa
// "blocking"). Ao contrário dos outros "obrigatório se X", um contrato a termo certo sem as duas
// datas não se grava, mesmo numa ficha antiga  -  mas só trava quem pode editar os dados
// contratuais (um colaborador a editar a sua própria ficha não tem como corrigir isto).
function getBlockErrors(blockLists, podeEditarContrato) {
  const errors = {};
  BLOCK_FIELDS.forEach(f => {
    const porBloco = {};
    (blockLists[f.key] || []).forEach(b => {
      if (b.dataInicio && b.dataFim && b.dataFim < b.dataInicio) {
        porBloco[b.id] = { message: "Data de fim anterior à data de início", blocking: true };
      } else if (b.tipo === TIPO_CONTRATO_A_TERMO_CERTO && (!b.dataInicio || !b.dataFim)) {
        porBloco[b.id] = { message: "Contrato a termo certo: indique a data de início e a de fim", blocking: podeEditarContrato };
      }
    });
    if (Object.keys(porBloco).length > 0) errors[f.key] = porBloco;
  });
  return errors;
}

// Erros bloqueantes ({key: {message, blocking}} ou {key: {blocoId: {message, blocking}}})
// -> lista de mensagens a mostrar ao utilizador (rótulo do campo, quando existir).
function listarErrosBloqueantes(fieldErrors, blockErrors) {
  const labels = [];
  Object.entries(fieldErrors).forEach(([key, err]) => {
    if (err.blocking) labels.push(FIELD_BY_KEY[key]?.label || key);
  });
  Object.entries(blockErrors).forEach(([key, porBloco]) => {
    const temBloqueante = Object.values(porBloco).some(e => e.blocking);
    if (temBloqueante) labels.push(FIELD_BY_KEY[key]?.label || key);
  });
  return labels;
}

// Extensão do ficheiro original (com o ponto, ex: ".pdf")  -  "" se não tiver extensão.
function extensaoFicheiro(filename) {
  const i = filename.lastIndexOf(".");
  return i > 0 ? filename.slice(i) : "";
}

// Campos "blocks" (cedências temporárias, baixas médicas): cada um vive numa subcoleção
// própria em users/{id}/{apiKey} (ver BLOCK_COLLECTIONS no ca DOdastroController), não no
// documento do user  -  por isso ficam fora do "form" e são geridos em blockLists.
const BLOCK_FIELDS = ALL_FIELDS.filter(f => f.type === "blocks");
const INITIAL_BLOCK_LISTS = BLOCK_FIELDS.reduce((acc, f) => { acc[f.key] = []; return acc; }, {});

function novoBlocoId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export default function Cadastro() {
  const navigate = useNavigate();
  const { id } = useParams();
  const location = useLocation();
  const { username, uid, setUsername } = useContext(UserContext);
  const { isSuperAdmin, isGestorRH, isAdministrador, isGestorFinanceiro, canViewCadastro, canEditCadastro, canEditCadastroRestrito } = usePermissions();
  const locaisTrabalho = useLocaisTrabalho();
  const isViewingOther = !!id;
  const targetKey = id || uid;
  const targetLabel = isViewingOther ? (location.state?.nome || id) : username;
  // Nome da entidade do colaborador-alvo (devolvido por GET /cadastro/:id, ver
  // fetchCadastro) - só é preciso para decidir, para um Administrador, se o alvo está
  // dentro do seu âmbito de gestão (ver isEntidadeInScope em usePermissions.js).
  // Continua null até a ficha carregar; para o próprio utilizador isso não afeta nada
  // (canView/canEdit são sempre true sobre si próprio, ver canViewCadastro/canEditCadastro),
  // só atrasa a decisão fina quando isViewingOther && isAdministrador.
  const [targetEntidadeNome, setTargetEntidadeNome] = useState(null);
  // Verificação grosseira (só por nível de acesso, sem ainda saber a entidade do alvo)
  // usada só para decidir se vale a pena tentar carregar a ficha de outro colaborador -
  // quem não passa nem esta verificação nunca teria acesso a mais ninguém, seja qual for
  // a entidade. A decisão fina (com âmbito de entidade) é canView/canEdit abaixo; o
  // backend continua a validar sempre as duas, isto é só para poupar um pedido inútil.
  const canAttemptViewOther = isSuperAdmin || isGestorRH || isGestorFinanceiro || isAdministrador;
  const canView = canViewCadastro(targetKey, targetEntidadeNome);
  const canEdit = canEditCadastro(targetKey, targetEntidadeNome);
  const canEditRestricted = canEditCadastroRestrito(targetEntidadeNome);

  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(INITIAL_FORM);
  const [docRefs, setDocRefs] = useState({});
  const [blockLists, setBlockLists] = useState(INITIAL_BLOCK_LISTS);
  // Estado local (não persistido) de que blocos de "blocks" (cedências, baixas médicas)
  // estão colapsados  -  por chave de bloco (id), true = colapsado.
  const [collapsedBlocks, setCollapsedBlocks] = useState({});
  const toggleBlockCollapsed = (id) => setCollapsedBlocks(prev => ({ ...prev, [id]: !prev[id] }));
  // Estado local (não persistido) de que secções ("zonas") estão colapsadas  -  por título
  // de secção, true = colapsada. Começam todas abertas.
  const [collapsedSections, setCollapsedSections] = useState({});
  const toggleSectionCollapsed = (title) => setCollapsedSections(prev => ({ ...prev, [title]: !prev[title] }));
  const nomeCurto = getNomeCurto(form.nome_completo) || targetLabel;
  const [uploading, setUploading] = useState({});
  const [viewing, setViewing] = useState({});
  const [notifying, setNotifying] = useState(false);
  // Só recalcula quando form/docRefs mudam  -  evita percorrer COMPLETENESS_FIELDS a cada render.
  const missingFields = useMemo(() => (loading ? [] : getMissingFields(form, docRefs)), [loading, form, docRefs]);
  const missingCount = missingFields.length;
  // Erros de validação (formato/consistência)  -  só interessam em modo de edição.
  const fieldErrors = useMemo(() => (editMode ? getFieldErrors(form, docRefs) : {}), [editMode, form, docRefs]);
  const blockErrors = useMemo(() => (editMode ? getBlockErrors(blockLists, canEditRestricted) : {}), [editMode, blockLists, canEditRestricted]);
  const fileInputRefs = useRef({});
  // Só usado para revelar a caixa "Dados de estágio" antes de haver qualquer dado guardado
  // (ex: acabou de clicar "Adicionar dados de estágio"). Uma vez que existam dados, a caixa
  // mostra-se sozinha (ver hasEstagioData) e este estado deixa de ser necessário.
  const [estagioAdding, setEstagioAdding] = useState(false);
  // Opções carregadas da BD para os selects de "Entidade de estágio" e "Orientador".
  const [entidadesOptions, setEntidadesOptions] = useState([]);
  const [colaboradoresOptions, setColaboradoresOptions] = useState([]);

  useEffect(() => {
    if (isViewingOther && !canAttemptViewOther) {
      navigate("/cadastro", { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isViewingOther, canAttemptViewOther]);

  useEffect(() => {
    setEstagioAdding(false);
  }, [targetKey, editMode]);

  // Carregadas uma vez para quem pode editar os dados de estágio (as únicas pessoas que
  // vão ver estes selects preenchidos com opções em vez de só o valor guardado em texto).
  useEffect(() => {
    if (!canEditRestricted) return;
    (async () => {
      try {
        const res = await apiFetch("/users/getColaboradores");
        if (!res.ok) return;
        const data = await res.json();
        const nomes = Array.from(new Set((data || []).map(c => c.nome).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pt"));
        setColaboradoresOptions(nomes);
      } catch (e) {
        console.error(e);
      }
    })();
    (async () => {
      try {
        const res = await apiFetch("/entities/showEntities", { method: "POST" });
        if (!res.ok) return;
        const data = await res.json();
        setEntidadesOptions(Array.isArray(data.entityNames) ? data.entityNames : []);
      } catch (e) {
        console.error(e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEditRestricted]);

  const hasEstagioData = (dataSource, docs) => {
    if (!dataSource) return false;
    return ESTAGIO_FIELD_KEYS.some(k => {
      const v = dataSource[k];
      return v !== undefined && v !== "" && v !== false;
    }) || ESTAGIO_SECTION.fields.some(f => f.type === "file" && !!docs?.[f.key]);
  };

  const fetchCadastro = async () => {
    const res = await apiFetch(`/cadastro/${targetKey}`);
    if (res.ok) {
      const data = await res.json();
      setForm({ ...INITIAL_FORM, ...(data.form || {}), email: data.email || "" });
      setDocRefs(data.docs || {});
      setTargetEntidadeNome(data.entidade || null);
      // "sortByDataInicio" (contratos anteriores): mostra o histórico por ordem cronológica
      // em vez da ordem dos ids na subcoleção; blocos sem data de início ficam no fim.
      const novosBlockLists = BLOCK_FIELDS.reduce((acc, f) => {
        const lista = data[f.apiKey] || [];
        acc[f.key] = f.sortByDataInicio
          ? [...lista].sort((a, b) => (a.dataInicio || "9999").localeCompare(b.dataInicio || "9999"))
          : lista;
        return acc;
      }, {});
      setBlockLists(novosBlockLists);
      // Blocos já com data de início preenchida (ou seja, já existiam antes desta consulta)
      // começam colapsados, para a lista não ficar comprida por omissão. Um bloco novo,
      // acabado de adicionar em modo de edição, não passa por aqui e fica expandido.
      setCollapsedBlocks(Object.values(novosBlockLists).flat().reduce((acc, b) => {
        if (b.dataInicio) acc[b.id] = true;
        return acc;
      }, {}));
      return true;
    }
    return false;
  };

  useEffect(() => {
    if (!targetKey) return;
    setLoading(true);
    (async () => {
      try {
        const ok = await fetchCadastro();
        if (!ok) toast.error("Não foi possível carregar a ficha de cadastro", { position: "top-right" });
      } catch (e) {
        console.error(e);
        toast.error("Não foi possível carregar a ficha de cadastro", { position: "top-right" });
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  const handleChange = (key, value) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    const camposBloqueantes = listarErrosBloqueantes(fieldErrors, blockErrors);
    if (camposBloqueantes.length > 0) {
      // Reabre as secções/blocos com erros bloqueantes para o utilizador os poder ver e corrigir.
      setCollapsedSections(prev => {
        const next = { ...prev };
        Object.entries(fieldErrors).forEach(([key, err]) => { if (err.blocking) delete next[SECTION_BY_FIELD_KEY[key]]; });
        Object.entries(blockErrors).forEach(([key, porBloco]) => {
          if (Object.values(porBloco).some(e => e.blocking)) delete next[SECTION_BY_FIELD_KEY[key]];
        });
        return next;
      });
      setCollapsedBlocks(prev => {
        const next = { ...prev };
        Object.values(blockErrors).forEach(porBloco => {
          Object.entries(porBloco).forEach(([blockId, err]) => { if (err.blocking) delete next[blockId]; });
        });
        return next;
      });
      toast.error(`Corrija antes de guardar: ${camposBloqueantes.join(", ")}`, { position: "top-right" });
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch(`/cadastro/${targetKey}`, {
        method: "PUT",
        body: JSON.stringify({
          form, docs: docRefs,
          ...BLOCK_FIELDS.reduce((acc, f) => { acc[f.apiKey] = blockLists[f.key] || []; return acc; }, {}),
        }),
      });
      if (!res.ok) {
        toast.error("Falha ao guardar a ficha de cadastro", { position: "top-right" });
        return;
      }

      await fetchCadastro();
      setEditMode(false);
      if (!isViewingOther && nomeCurto) setUsername(nomeCurto);
      toast.success("Ficha de cadastro guardada", { position: "top-right", autoClose: 2500 });
    } catch (e) {
      console.error(e);
      toast.error("Falha ao guardar a ficha de cadastro", { position: "top-right" });
    } finally {
      setSaving(false);
    }
  };

  const handleNotifyIncomplete = async () => {
    setNotifying(true);
    try {
      const res = await apiFetch(`/cadastro/${targetKey}/notify-incomplete`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Falha ao enviar notificação", { position: "top-right" });
        return;
      }
      toast.success("Colaborador notificado por email", { position: "top-right", autoClose: 2500 });
    } catch (e) {
      console.error(e);
      toast.error("Falha ao enviar notificação", { position: "top-right" });
    } finally {
      setNotifying(false);
    }
  };

  // Campos "multiple" guardam { files: [{name, path}, ...] } em vez de {name, path}  -  o
  // backend não olha para a forma do doc (só faz set/delete por chave), por isso não precisa
  // de mudar nada para suportar isto (ver saveCadastro em cadastroController.js).
  const handleDocUpload = async (docKey, file, multiple = false) => {
    if (!file) return;
    setUploading(prev => ({ ...prev, [docKey]: true }));
    try {
      const storageName = FIELD_BY_KEY[docKey]?.storageName;
      const formData = new FormData();
      formData.append("file", file);
      formData.append("folderPath", `Cadastro/${targetKey}/`);
      if (storageName) formData.append("filename", `${storageName}${extensaoFicheiro(file.name)}`);
      const res = await apiFetch(`/files/upload-document`, { method: "POST", body: formData });
      if (res.ok) {
        const data = await res.json();
        const newRef = { name: file.name, path: data.path };
        setDocRefs(prev => {
          if (!multiple) return { ...prev, [docKey]: newRef };
          const files = prev[docKey]?.files || [];
          return { ...prev, [docKey]: { files: [...files, newRef] } };
        });
      } else {
        toast.error("Falha ao enviar ficheiro", { position: "top-right" });
      }
    } catch (e) {
      console.error(e);
      toast.error("Falha ao enviar ficheiro", { position: "top-right" });
    } finally {
      setUploading(prev => ({ ...prev, [docKey]: false }));
    }
  };

  const handleRemoveMultiDoc = (docKey, index) => {
    setDocRefs(prev => {
      const files = (prev[docKey]?.files || []).filter((_, i) => i !== index);
      const next = { ...prev };
      if (files.length) next[docKey] = { files };
      else delete next[docKey];
      return next;
    });
  };

  const handleViewDoc = async (viewKey, path) => {
    if (!path) return;
    setViewing(prev => ({ ...prev, [viewKey]: true }));
    try {
      const res = await apiFetch(`/files/download`, {
        method: "POST",
        body: JSON.stringify({ path: encodeURIComponent(path) }),
      });
      if (res.ok) {
        const blob = await res.blob();
        window.open(URL.createObjectURL(blob), "_blank");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setViewing(prev => ({ ...prev, [viewKey]: false }));
    }
  };

  // Campos "blocks" (cedências temporárias, baixas médicas, ...): em vez de um único
  // bloco sim/não, guardam uma lista de {id, entidade?, dataInicio, dataFim, pdf} em
  // blockLists  -  cada uma vive na sua própria subcoleção no backend (ver BLOCK_COLLECTIONS
  // no cadastroController), não no documento do user, por isso ficam fora do "form".
  // "entidade" só é usado pelos campos que definem `entidadeLabel`.
  const handleAddBlock = (key) => {
    const entidade = FIELD_BY_KEY[key]?.entidadePadrao ? (targetEntidadeNome || "") : "";
    setBlockLists(prev => ({
      ...prev,
      [key]: [...(prev[key] || []), { id: novoBlocoId(), tipo: "", entidade, dataInicio: "", dataFim: "", observacao: "", pdf: null }],
    }));
  };

  const handleChangeBlock = (key, id, patch) => {
    setBlockLists(prev => ({
      ...prev,
      [key]: (prev[key] || []).map(c => (c.id === id ? { ...c, ...patch } : c)),
    }));
  };

  const handleRemoveBlock = (key, id) => {
    setBlockLists(prev => ({ ...prev, [key]: (prev[key] || []).filter(c => c.id !== id) }));
  };

  const handleBlockPdfUpload = async (key, id, file) => {
    if (!file) return;
    const uploadKey = `${key}_${id}`;
    setUploading(prev => ({ ...prev, [uploadKey]: true }));
    try {
      const field = FIELD_BY_KEY[key];
      const bloco = (blockLists[key] || []).find(b => b.id === id);
      // Nome do ficheiro = intervalo de datas do bloco (ex: "2024-01-15_a_2024-06-30.pdf"),
      // só a data de início se ainda não tiver fim (ex: contrato sem termo), ou o id do
      // bloco se ainda não houver datas preenchidas.
      const baseName = bloco?.dataInicio
        ? (bloco.dataFim ? `${bloco.dataInicio}_a_${bloco.dataFim}` : bloco.dataInicio)
        : `sem_data_${id}`;
      const formData = new FormData();
      formData.append("file", file);
      formData.append("folderPath", `Cadastro/${targetKey}/${field.storageFolder}/`);
      formData.append("filename", `${baseName}${extensaoFicheiro(file.name)}`);
      const res = await apiFetch(`/files/upload-document`, { method: "POST", body: formData });
      if (res.ok) {
        const data = await res.json();
        handleChangeBlock(key, id, { pdf: { name: file.name, path: data.path } });
      } else {
        toast.error("Falha ao enviar ficheiro", { position: "top-right" });
      }
    } catch (e) {
      console.error(e);
      toast.error("Falha ao enviar ficheiro", { position: "top-right" });
    } finally {
      setUploading(prev => ({ ...prev, [uploadKey]: false }));
    }
  };

  // "borderWidth/borderStyle/borderColor" em vez do atalho "border"  -  assim
  // fieldInputStyle pode substituir só o "borderColor" (campo com erro) sem misturar
  // propriedade abreviada com a sua versão longa no mesmo objeto de estilo (o React
  // avisa disso entre re-renders, ex: ao remover o erro ao corrigir o campo).
  const inputStyle = {
    width: "100%", fontSize: 13, color: "#111827", fontWeight: 500,
    borderWidth: 1, borderStyle: "solid", borderColor: "#e5e7eb", borderRadius: 6, padding: "7px 9px",
    outline: "none", background: editMode ? "#fafafa" : "#fff",
    boxSizing: "border-box",
  };

  const labelStyle = { fontSize: 11, color: "#6b7280", marginBottom: 4, display: "block" };

  // Célula "Duração" dos contratos de trabalho (só de leitura, calculada das datas).
  const renderDuracaoContrato = (inicio, fim) => {
    const duracao = formatDuracaoContrato(inicio, fim, new Date().toISOString().slice(0, 10));
    return (
      <div key="__duracao" style={{ minWidth: 0 }}>
        <span style={labelStyle}>Duração</span>
        <div style={{ fontSize: 13, color: duracao ? "#111827" : "#9ca3af", fontWeight: 500 }}>
          {duracao ? `${duracao}${fim ? "" : " (até hoje)"}` : " - "}
        </div>
      </div>
    );
  };

  const renderValue = (field, dataSource) => {
    const value = dataSource[field.key];
    if (field.type === "date" && value) {
      const [y, m, d] = value.split("-");
      return `${d}/${m}/${y}`;
    }
    if (field.type === "text" || field.type === "email" || field.type === "tel" || field.type === "number") {
      return value || " - ";
    }
    return " - ";
  };

  const renderField = (field, editable, dataSource = form, errors = {}, blockErrs = {}) => {
    const { key, label, type, placeholder } = field;
    const options = field.optionsSource === "locaisTrabalho" ? locaisTrabalho.nomes : field.options;
    if (field.readOnly) editable = false;
    // "newRow" força o campo a começar numa linha nova mesmo que a linha anterior tenha um
    // número variável de campos (por causa de showIf)  -  ver os campos das secções em SECTIONS.
    const layoutStyle = field.newRow ? { minWidth: 0, gridColumnStart: 1 } : { minWidth: 0 };
    const errorMsg = editable ? errors[key]?.message : null;
    const fieldInputStyle = errorMsg ? { ...inputStyle, borderColor: "#dc2626" } : inputStyle;
    const errorText = errorMsg ? <div style={{ fontSize: 11, color: "#dc2626", marginTop: 4 }}>{errorMsg}</div> : null;

    if (type === "toggle") {
      const value = !!dataSource[key];
      return (
        <div key={key} style={layoutStyle}>
          <span style={labelStyle}>{label}</span>
          {editable ? (
            <div style={{ display: "flex", gap: 6 }}>
              {[["Sim", true], ["Não", false]].map(([txt, v]) => (
                <button
                  key={txt}
                  type="button"
                  onClick={() => handleChange(key, v)}
                  style={{
                    flex: 1, padding: "6px 0", fontSize: 12, fontWeight: 600, cursor: "pointer",
                    borderRadius: 6, border: `1px solid ${value === v ? GOLD : "#e5e7eb"}`,
                    background: value === v ? GOLD : "#fff",
                    color: value === v ? "#fff" : "#6b7280",
                    transition: "all 0.15s",
                  }}
                >
                  {txt}
                </button>
              ))}
            </div>
          ) : (
            <span style={{
              display: "inline-block", fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 20,
              background: value ? "#DCFCE7" : "#F3F4F6", color: value ? "#15803D" : "#374151",
            }}>
              {value ? "Sim" : "Não"}
            </span>
          )}
        </div>
      );
    }

    if (type === "blocks") {
      const blocks = blockLists[key] || [];
      const errosDoBloco = blockErrs[key] || {};
      const fmtDate = v => {
        if (!v) return " - ";
        const [y, m, d] = v.split("-");
        return `${d}/${m}/${y}`;
      };
      const dataFimLabel = field.dataFimLabel || "Data de fim";
      const pdfName = field.pdfName || "ficheiro";
      return (
        <div key={key} style={{ gridColumn: "1 / -1" }}>
          <span style={labelStyle}>{label}</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {blocks.map(c => {
              const uploadKey = `${key}_${c.id}`;
              const isUploading = uploading[uploadKey];
              const isViewing = viewing[uploadKey];
              const hasPdf = !!c.pdf;
              const isCollapsed = !!collapsedBlocks[c.id];
              const summaryExtra = [field.tipoOptions && c.tipo, field.entidadeLabel && c.entidade].filter(Boolean).join(" · ");
              const summary = c.dataInicio || c.dataFim
                ? `${fmtDate(c.dataInicio)} - ${fmtDate(c.dataFim)}${summaryExtra ? ` · ${summaryExtra}` : ""}`
                : `Adicionar ${field.itemSingular}`;
              const blocoErro = errosDoBloco[c.id]?.message;
              return (
                <div key={c.id} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12, background: "#fafafa" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div
                      onClick={() => toggleBlockCollapsed(c.id)}
                      style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, cursor: "pointer" }}
                    >
                      <FaChevronDown style={{
                        fontSize: 11, color: "#9ca3af", flexShrink: 0, transition: "transform 0.15s",
                        transform: isCollapsed ? "rotate(-90deg)" : "none",
                      }} />
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {summary}
                      </span>
                    </div>
                    {editable && (
                      <button
                        type="button"
                        onClick={() => handleRemoveBlock(key, c.id)}
                        title={`Remover ${field.itemSingular}`}
                        style={{ border: "none", background: "transparent", cursor: "pointer", color: "#9ca3af", fontSize: 14, padding: 4, display: "flex", flexShrink: 0 }}
                      >
                        <FaCircleMinus />
                      </button>
                    )}
                  </div>
                  {!isCollapsed && (
                    <div style={{ marginTop: 10 }}>
                      {/* Tipo/Entidade + as duas datas juntos na mesma grelha  -  quando o bloco tem
                          os dois (contratos anteriores), as datas começam numa linha nova, para a
                          data de início e a de fim ficarem sempre lado a lado. */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3">
                        {field.tipoOptions && (
                          <div style={{ minWidth: 0 }}>
                            <span style={labelStyle}>{field.tipoLabel || "Tipo"}</span>
                            {editable ? (
                              <select value={c.tipo || ""} onChange={e => handleChangeBlock(key, c.id, { tipo: e.target.value })} style={inputStyle}>
                                <option value="">Selecionar...</option>
                                {field.tipoOptions.map(o => <option key={o} value={o}>{o}</option>)}
                              </select>
                            ) : (
                              <div style={{ fontSize: 13, color: "#111827", fontWeight: 500 }}>{c.tipo || " - "}</div>
                            )}
                          </div>
                        )}
                        {field.entidadeLabel && (
                          <div style={{ minWidth: 0 }}>
                            <span style={labelStyle}>{field.entidadeLabel}</span>
                            {editable ? (
                              <AutocompleteInput
                                value={c.entidade}
                                onChange={v => handleChangeBlock(key, c.id, { entidade: v })}
                                options={entidadesOptions}
                                inputStyle={inputStyle}
                              />
                            ) : (
                              <div style={{ fontSize: 13, color: "#111827", fontWeight: 500 }}>{c.entidade || " - "}</div>
                            )}
                          </div>
                        )}
                        <div style={field.tipoOptions && field.entidadeLabel ? { minWidth: 0, gridColumnStart: 1 } : { minWidth: 0 }}>
                          <span style={labelStyle}>Data de início</span>
                          {editable ? (
                            <input type="date" value={c.dataInicio} onChange={e => handleChangeBlock(key, c.id, { dataInicio: e.target.value })} style={inputStyle} />
                          ) : (
                            <div style={{ fontSize: 13, color: "#111827", fontWeight: 500 }}>{fmtDate(c.dataInicio)}</div>
                          )}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <span style={labelStyle}>{dataFimLabel}</span>
                          {editable ? (
                            <>
                              <input
                                type="date" value={c.dataFim}
                                onChange={e => handleChangeBlock(key, c.id, { dataFim: e.target.value })}
                                style={blocoErro ? { ...inputStyle, borderColor: "#dc2626" } : inputStyle}
                              />
                              {blocoErro && <div style={{ fontSize: 11, color: "#dc2626", marginTop: 4 }}>{blocoErro}</div>}
                            </>
                          ) : (
                            <div style={{ fontSize: 13, color: "#111827", fontWeight: 500 }}>{fmtDate(c.dataFim)}</div>
                          )}
                        </div>
                        {field.showDuracao && renderDuracaoContrato(c.dataInicio, c.dataFim)}
                      </div>
                      {field.observacaoLabel && (
                        <div style={{ marginTop: 10 }}>
                          <span style={labelStyle}>{field.observacaoLabel}</span>
                          {editable ? (
                            <textarea
                              value={c.observacao || ""}
                              rows={2}
                              onChange={e => handleChangeBlock(key, c.id, { observacao: e.target.value })}
                              style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
                            />
                          ) : (
                            <div style={{ fontSize: 13, color: "#111827", fontWeight: 500, whiteSpace: "pre-wrap" }}>{c.observacao || " - "}</div>
                          )}
                        </div>
                      )}
                      <div style={{ marginTop: 10 }}>
                        <input
                          type="file"
                          accept=".pdf"
                          style={{ display: "none" }}
                          ref={el => { fileInputRefs.current[uploadKey] = el; }}
                          onChange={e => {
                            const f = e.target.files[0];
                            if (f) handleBlockPdfUpload(key, c.id, f);
                            e.target.value = "";
                          }}
                        />
                        <div
                          onClick={() => {
                            if (isUploading || isViewing) return;
                            if (editable) fileInputRefs.current[uploadKey]?.click();
                            else if (hasPdf) handleViewDoc(uploadKey, c.pdf.path);
                          }}
                          style={{
                            display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
                            border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff",
                            cursor: isUploading || isViewing ? "wait" : editable || hasPdf ? "pointer" : "default",
                          }}
                        >
                          <FaCloudArrowUp style={{ color: hasPdf ? GOLD : "#d1d5db", fontSize: 14, flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: hasPdf ? "#6b7280" : "#b0b7c3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {isUploading ? "A enviar..." : isViewing ? "A abrir..." : hasPdf ? c.pdf.name : editable ? `Clique para enviar ${pdfName}` : `Sem ${pdfName} enviado`}
                          </div>
                          {hasPdf && !editable && <FaArrowUpRightFromSquare style={{ fontSize: 11, color: GOLD, flexShrink: 0 }} />}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {editable && (
              <div
                onClick={() => handleAddBlock(key)}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "10px 12px",
                  border: "1px dashed #d1d5db", borderRadius: 8, cursor: "pointer",
                  color: "#6b7280", fontSize: 12.5, fontWeight: 500, background: "#fafafa",
                }}
              >
                <FaPlus style={{ fontSize: 11 }} /> {field.addLabel || "REGISTAR"}
              </div>
            )}
            {!editable && blocks.length === 0 && (
              <div style={{ fontSize: 11.5, color: "#9ca3af" }}>{field.emptyLabel || `Sem ${label.toLowerCase()} registadas`}</div>
            )}
          </div>
        </div>
      );
    }

    if (type === "file" && field.multiple) {
      const files = docRefs[key]?.files || [];
      const isUploading = uploading[key];
      return (
        <div key={key} style={{ gridColumn: "1 / -1" }}>
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
            style={{ display: "none" }}
            ref={el => { fileInputRefs.current[key] = el; }}
            onChange={e => {
              const f = e.target.files[0];
              if (f) handleDocUpload(key, f, true);
              e.target.value = "";
            }}
          />
          <span style={labelStyle}>{label}</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {files.map((f, i) => {
              const viewKey = `${key}__${i}`;
              const isViewing = viewing[viewKey];
              return (
                <div
                  key={`${f.path}-${i}`}
                  onClick={() => { if (!isViewing) handleViewDoc(viewKey, f.path); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "10px 12px",
                    border: "1px solid #e5e7eb", borderRadius: 8,
                    cursor: isViewing ? "wait" : "pointer", background: "#fafafa",
                  }}
                >
                  <FaCloudArrowUp style={{ color: GOLD, fontSize: 15, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: "#111827", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.name}
                    </div>
                    <div style={{ fontSize: 11, marginTop: 2, color: "#6b7280" }}>
                      {isViewing ? "A abrir..." : "Clique para abrir"}
                    </div>
                  </div>
                  {editable ? (
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); handleRemoveMultiDoc(key, i); }}
                      title="Remover ficheiro"
                      style={{ flexShrink: 0, border: "none", background: "transparent", cursor: "pointer", color: "#9ca3af", fontSize: 14, padding: 4, display: "flex" }}
                    >
                      <FaCircleMinus />
                    </button>
                  ) : (
                    <FaArrowUpRightFromSquare style={{ fontSize: 12, color: GOLD, flexShrink: 0 }} />
                  )}
                </div>
              );
            })}
            {editable && (
              <div
                onClick={() => { if (!isUploading) fileInputRefs.current[key]?.click(); }}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "10px 12px",
                  border: "1px dashed #d1d5db", borderRadius: 8,
                  cursor: isUploading ? "wait" : "pointer", color: "#6b7280", fontSize: 12.5, fontWeight: 500, background: "#fafafa",
                }}
              >
                <FaPlus style={{ fontSize: 11 }} />
                {isUploading ? "A enviar..." : "Adicionar ficheiro"}
              </div>
            )}
            {!editable && files.length === 0 && (
              <div style={{ fontSize: 11.5, color: "#9ca3af" }}>Sem ficheiros enviados</div>
            )}
          </div>
        </div>
      );
    }

    if (type === "file") {
      const ref = docRefs[key];
      const isUploading = uploading[key];
      const isViewing = viewing[key];
      const hasFile = !!ref;
      const isActive = editable || hasFile;
      return (
        <div key={key} style={{ gridColumn: "1 / -1" }}>
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
            style={{ display: "none" }}
            ref={el => { fileInputRefs.current[key] = el; }}
            onChange={e => {
              const f = e.target.files[0];
              if (f) handleDocUpload(key, f);
              e.target.value = "";
            }}
          />
          <div
            onClick={() => {
              if (isUploading || isViewing) return;
              if (editable) fileInputRefs.current[key]?.click();
              else if (hasFile) handleViewDoc(key, ref.path);
            }}
            style={{
              display: "flex", alignItems: "center", gap: 12, padding: "10px 12px",
              border: `1px solid ${errorMsg ? "#dc2626" : "#e5e7eb"}`, borderRadius: 8,
              cursor: isUploading || isViewing ? "wait" : isActive ? "pointer" : "default",
              background: "#fafafa", transition: "background 0.12s",
            }}
          >
            <FaCloudArrowUp style={{ color: hasFile ? GOLD : "#d1d5db", fontSize: 15, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: "#111827", fontWeight: 500 }}>{label}</div>
              <div style={{ fontSize: 11, marginTop: 2, color: hasFile ? "#6b7280" : "#b0b7c3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {isUploading ? "A enviar..." : isViewing ? "A abrir..." : hasFile ? ref.name : editable ? "Clique para enviar ficheiro" : "Sem ficheiro enviado"}
              </div>
            </div>
            <div style={{ flexShrink: 0 }}>
              {hasFile && !editable ? <FaArrowUpRightFromSquare style={{ fontSize: 12, color: GOLD }} />
                : !hasFile && !editable ? <FaCircleMinus style={{ fontSize: 13, color: "#e5e7eb" }} />
                : null}
            </div>
          </div>
          {errorText}
        </div>
      );
    }

    if (type === "select") {
      const currentValue = dataSource[key];
      // "optionLabels" (opcional) mostra um texto mais descritivo por opção  -  ex: "Local de
      // trabalho" mostra a morada de cada sede junto ao nome, sem precisar de um campo à parte.
      const optionLabels = field.optionsSource === "locaisTrabalho" ? locaisTrabalho.labels : field.optionLabels;
      const optionLabel = o => optionLabels?.[o] || o;
      return (
        <div key={key} style={layoutStyle}>
          <span style={labelStyle}>{label}</span>
          {editable ? (
            <>
              <select value={currentValue} onChange={e => handleChange(key, e.target.value)} style={fieldInputStyle}>
                <option value="">Selecionar...</option>
                {options.map(o => <option key={o} value={o}>{optionLabel(o)}</option>)}
              </select>
              {errorText}
            </>
          ) : (
            <div style={{ fontSize: 13, color: "#111827", fontWeight: 500 }}>{currentValue ? optionLabel(currentValue) : " - "}</div>
          )}
        </div>
      );
    }

    if (type === "duration") {
      const duracao = formatDuracao(dataSource[field.fromKey], dataSource[field.toKey]);
      return (
        <div key={key} style={layoutStyle}>
          <span style={labelStyle}>{label}</span>
          <div style={{ fontSize: 13, color: duracao ? "#111827" : "#9ca3af", fontWeight: 500 }}>
            {duracao || "Preenche as datas de início e fim"}
          </div>
        </div>
      );
    }

    if (type === "tenure") {
      // Lista de contratos (blockLists[historyKey], por isso atualiza-se logo ao adicionar/
      // editar/remover um contrato)  -  ver calcularAntiguidadeMeses.
      const hoje = new Date().toISOString().slice(0, 10);
      const tempo = formatAntiguidade(calcularAntiguidadeMeses(blockLists[field.historyKey], hoje));
      return (
        <div key={key} style={layoutStyle}>
          <span style={labelStyle}>{label}</span>
          <div style={{ fontSize: 13, color: tempo ? "#111827" : "#9ca3af", fontWeight: 500 }}>
            {tempo || "Preenche a data de admissão ou os contratos anteriores"}
          </div>
        </div>
      );
    }

    if (type === "textarea") {
      return (
        <div key={key} style={{ gridColumn: "1 / -1", minWidth: 0 }}>
          <span style={labelStyle}>{label}</span>
          {editable ? (
            <textarea
              value={dataSource[key]}
              placeholder={placeholder}
              rows={3}
              onChange={e => handleChange(key, e.target.value)}
              style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
            />
          ) : (
            <div style={{ fontSize: 13, color: "#111827", fontWeight: 500, whiteSpace: "pre-wrap" }}>{dataSource[key] || " - "}</div>
          )}
        </div>
      );
    }

    // text, email, tel, number, date (+ autocomplete estilizado, quando o campo tem "list")
    const listOptions = field.list === "colaboradores" ? colaboradoresOptions
      : field.list === "entidades" ? entidadesOptions
      : field.list === "habilitacoes" ? HABILITACOES_OPTIONS
      : field.list === "funcao" ? FUNCAO
      : null;
    return (
      <div key={key} style={layoutStyle}>
        <span style={labelStyle}>{label}</span>
        {editable ? (
          <>
            {listOptions ? (
              <AutocompleteInput
                value={dataSource[key]}
                onChange={v => handleChange(key, v)}
                options={listOptions}
                placeholder={placeholder}
                inputStyle={fieldInputStyle}
              />
            ) : (
              <input
                type={type}
                value={dataSource[key]}
                placeholder={placeholder}
                onChange={e => handleChange(key, e.target.value)}
                style={fieldInputStyle}
              />
            )}
            {errorText}
          </>
        ) : (
          <div style={{ fontSize: 13, color: "#111827", fontWeight: 500 }}>{renderValue(field, dataSource)}</div>
        )}
      </div>
    );
  };

  const handleSelectFile = (filePath) => {
    const formattedPath = filePath.replace(/\s/g, "-").replace(/\//g, "__");
    navigate(`/file/${formattedPath}`, { state: { originalFilename: filePath } });
  };

  return (
    <div className="flex min-h-screen">
      <Sidebar onSelectFile={handleSelectFile} />

      <div className="ml-[var(--sidebar-w,230px)] transition-[margin-left] duration-200 flex-1 min-w-0 flex flex-col min-h-screen">
        <Topbar icon="🪪" title="Cadastro" />

        <div className="p-4 sm:p-6" style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Header */}
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "18px 24px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
            {isViewingOther && (
              <button
                onClick={() => navigate("/colaboradores")}
                title="Voltar à lista de colaboradores"
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 32, height: 32, border: "1px solid #e5e7eb", borderRadius: 7,
                  background: "#fff", color: "#6b7280", cursor: "pointer", flexShrink: 0,
                }}
              >
                <FaArrowLeft style={{ fontSize: 12 }} />
              </button>
            )}
            <div style={{ flex: "1 1 200px", minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: "#111827" }}>
                Ficha de cadastro  -  {nomeCurto}
              </div>
              <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 3 }}>
                Dados pessoais, contratuais e documentação associados ao processo individual do colaborador.
              </div>
              {!loading && missingCount > 0 && (() => {
                const nomesFaltam = missingFields.map(f => f.label);
                const LIMITE = 6;
                const resumo = nomesFaltam.length > LIMITE
                  ? `${nomesFaltam.slice(0, LIMITE).join(", ")} e mais ${nomesFaltam.length - LIMITE}`
                  : nomesFaltam.join(", ");
                return (
                  <div
                    title={nomesFaltam.join(", ")}
                    style={{
                      display: "inline-flex", alignItems: "flex-start", gap: 6, marginTop: 8, maxWidth: "100%",
                      padding: "3px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600,
                      background: "#FEF3C7", color: "#92400E",
                    }}
                  >
                    <FaTriangleExclamation style={{ fontSize: 10.5, marginTop: 2, flexShrink: 0 }} />
                    <span>Cadastro incompleto  -  falta: {resumo}</span>
                  </div>
                );
              })()}
            </div>
            {isViewingOther && canView && !loading && missingCount > 0 && (
              <button
                disabled={notifying}
                onClick={handleNotifyIncomplete}
                title="Enviar email a avisar que o cadastro está incompleto"
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "8px 16px", fontSize: 13, fontWeight: 500, cursor: notifying ? "wait" : "pointer",
                  border: "1px solid #e5e7eb", borderRadius: 7, background: "#fff",
                  color: "#6b7280", transition: "all 0.15s", flexShrink: 0, opacity: notifying ? 0.6 : 1,
                }}
              >
                {notifying
                  ? "A enviar..."
                  : <><FaPaperPlane style={{ fontSize: 12 }} /> Notificar cadastro incompleto</>}
              </button>
            )}
            {/* !loading: para um Administrador, canEdit só fica definitivo depois de
                targetEntidadeNome carregar (ver fetchCadastro) - evita mostrar o botão e
                escondê-lo logo a seguir. O backend (canWrite) continua a ser sempre a
                validação final, isto só decide se o botão aparece. */}
            {!loading && canEdit && (
              <button
                disabled={saving}
                onClick={() => { if (editMode) handleSave(); else setEditMode(true); }}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "8px 16px", fontSize: 13, fontWeight: 500, cursor: saving ? "wait" : "pointer",
                  border: `1px solid ${editMode ? "#22c55e" : GOLD}`,
                  borderRadius: 7, background: "#fff",
                  color: editMode ? "#22c55e" : GOLD,
                  transition: "all 0.15s", flexShrink: 0, opacity: saving ? 0.6 : 1,
                }}
              >
                {saving
                  ? "A guardar..."
                  : editMode ? <><FaCheck style={{ fontSize: 12 }} /> Guardar</> : <><FaPencil style={{ fontSize: 12 }} /> Editar</>}
              </button>
            )}
          </div>

          {loading && (
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 40, textAlign: "center", fontSize: 13, color: "#9ca3af" }}>
              A carregar ficha de cadastro...
            </div>
          )}

          {/* Sections */}
          {!loading && SECTIONS.map(section => {
            const sectionEditable = editMode && (!section.restricted || canEditRestricted);
            const sectionData = form;
            const visibleFields = section.fields.filter(f => !f.showIf || f.showIf(sectionData));

            if (section.isEstagio) {
              const estagioHasData = hasEstagioData(sectionData, docRefs);
              const canAddEstagio = sectionEditable;
              if (!estagioHasData && !estagioAdding) {
                if (!canAddEstagio) return null;
                return (
                  <button
                    key={section.title}
                    type="button"
                    onClick={() => setEstagioAdding(true)}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      padding: "12px 18px", fontSize: 13, fontWeight: 500, cursor: "pointer",
                      border: "1px dashed #d1d5db", borderRadius: 10, background: "#fafafa",
                      color: "#6b7280", width: "100%",
                    }}
                  >
                    <FaPlus style={{ fontSize: 11 }} /> Adicionar dados de estágio
                  </button>
                );
              }
            }

            const isCollapsed = !!collapsedSections[section.title];

            return (
              // Sem "overflow: hidden"  -  o dropdown do AutocompleteInput (Orientador, Entidade de estágio, Habilitações) é posicionado absolutamente e não pode ser cortado pela caixa.
              <div key={section.title} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10 }}>
                <div
                  onClick={() => toggleSectionCollapsed(section.title)}
                  style={{ padding: "14px 18px", borderBottom: isCollapsed ? "none" : "1px solid #f3f4f6", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, cursor: "pointer" }}
                >
                  <FaChevronDown style={{
                    fontSize: 11, color: "#9ca3af", flexShrink: 0, transition: "transform 0.15s",
                    transform: isCollapsed ? "rotate(-90deg)" : "none",
                  }} />
                  <section.Icon style={{ color: GOLD, fontSize: 13 }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{section.title}</span>
                  <div style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                    {section.restricted && editMode && !canEditRestricted && (
                      <span style={{ fontSize: 10.5, fontWeight: 500, color: "#9ca3af" }}>
                        Apenas Administradores pode editar
                      </span>
                    )}
                  </div>
                </div>
                {!isCollapsed && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-4 p-[18px]">
                    {visibleFields.map(f => renderField(f, sectionEditable, sectionData, fieldErrors, blockErrors))}
                  </div>
                )}
              </div>
            );
          })}

        </div>
      </div>
    </div>
  );
}
