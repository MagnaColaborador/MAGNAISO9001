const admin = require("firebase-admin");
const db = require("../../shared/db/firebase").db;
const { isAdminOrHR, isAdministrador, isGestorFinanceiro, entidadeNoAmbito } = require("../../shared/middleware/auth");
const { sendMail, renderEmail } = require("../../shared/services/mailer");
const {
  validarNIF, validarNISS, validarCodigoPostal, validarTelefone, validarCartaoCidadao, validarIBAN,
} = require("../../shared/utils/validators");
const { TIPO_CONTRATO_A_TERMO_CERTO, idsPorDataInicio, resumoContratos } = require("./contratos");

// Um Administrador só vê/edita colaboradores das entidades que administra (nunca de
// outra) - mesmo critério (entidadeNoAmbito) usado para ler e para escrever, só muda o
// que cada operação decide fazer com esse resultado.
function isAdminInScope(req, targetEntidade) {
  return isAdministrador(req.user?.nivelAcesso) && entidadeNoAmbito(req.user, targetEntidade);
}

// Leitura: admin/RH vê qualquer colaborador; GestorFinanceiro também vê qualquer
// colaborador (precisa de consultar o cadastro para o processamento de salários), mas
// nunca ganha direito de escrita sobre o de outra pessoa (ver canWrite); Administrador
// vê os colaboradores das entidades que administra; um colaborador comum só vê o seu
// próprio cadastro.
function canRead(req, id, targetEntidade) {
  return req.user?.uid === id
    || isAdminOrHR(req.user?.nivelAcesso)
    || isGestorFinanceiro(req.user?.nivelAcesso)
    || isAdminInScope(req, targetEntidade);
}

// Escrita (campos não-restritos): admin/RH sem restrições; Administrador só dentro do
// seu âmbito de entidade; GestorFinanceiro NUNCA edita o cadastro de outro colaborador
// (só o seu próprio, coberto pelo "uid === id" abaixo) - separação deliberada entre ver
// e editar para este nível.
function canWrite(req, id, targetEntidade) {
  return req.user?.uid === id
    || isAdminOrHR(req.user?.nivelAcesso)
    || isAdminInScope(req, targetEntidade);
}

// Campos de "Contrato de trabalho"/"Estágio" e as subcoleções de cedências/baixas
// médicas: GestorRH/SuperAdmin sem restrições; Administrador só dentro do seu âmbito de
// entidade (mesmo critério de canWrite, incluindo agora estes campos antes reservados a
// RH) - sem atalho por "é o próprio": um Colaborador ou GestorFinanceiro continuam sem
// poder editar isto na sua própria ficha, exatamente como já acontecia antes.
function canEditRestricted(req, targetEntidade) {
  return isAdminOrHR(req.user?.nivelAcesso) || isAdminInScope(req, targetEntidade);
}

// Campos de "Contrato de trabalho" e "Estágio": só quem passa canEditRestricted pode
// alterá-los, mesmo que o próprio colaborador tenha acesso de escrita ao resto do seu cadastro.
// (tipo_contrato/data_admissao/data_fim_contrato não estão aqui: já não vêm do formulário,
// são calculados a partir da subcoleção "contratos" - ver resumoContratos em saveCadastro.)
const RESTRICTED_FORM_KEYS = [
  "role", "departamento", "situacao_contratual", "motivo_cessacao",
  "tipo_estagio", "n_processo_estagio", "id_processo_estagio", "entidade_medida",
  "data_inicio_estagio", "data_fim_estagio", "area_funcao", "habilitacoes_estagio",
  "entidade_estagio", "orientador", "observacao_estagio",
];
// "sede" também só é editável por quem passa canEditRestricted, mas é um simples campo
// do colaborador (usado pelo livro de ponto/mapa de férias para saber que feriados
// regionais aplicar).
const RESTRICTED_KEYS = [...RESTRICTED_FORM_KEYS, "sede"];
const RESTRICTED_DOC_KEYS = [
  "digitalizacao_acordos_desvinculacao",
  "digitalizacao_contrato_estagio", "outra_documentacao_estagio",
];

// Cedências temporárias e baixas médicas: cada uma é uma lista de blocos independentes
// (data início/fim + PDF), por isso vivem em subcoleções (um documento por bloco) em vez
// de um campo no documento do user  -  só quem passa canEditRestricted (GestorRH/
// SuperAdmin, ou um Administrador dentro do seu âmbito de entidade) pode alterá-las.
// "collection" é o nome da subcoleção em users/{id}/{collection}/{blocoId};
// "requestKey" é a chave correspondente no corpo do pedido (ver saveCadastro) e na resposta
// de getCadastro.
const BLOCK_COLLECTIONS = [
  { collection: "cedencias", requestKey: "cedencias" },
  { collection: "baixasMedicas", requestKey: "baixasMedicas" },
  // Todos os contratos de trabalho, atual incluído (ver contratos.js). Subcoleção com nome
  // próprio para não entrar nos collectionGroup('cedencias') usados no estado de hoje dos
  // colaboradores. "idPorDataInicio": o id de cada documento é o ano-mês de início.
  { collection: "contratos", requestKey: "contratos", idPorDataInicio: true },
];

// Situações contratuais que tiram o colaborador do quadro ativo - mesmo critério de
// ColaboradoresGroupedList.jsx (só colaboradores ativos aparecem agrupados por entidade,
// os restantes ficam à parte em "Inativos"), usado para não notificar quem já não está
// nesta entidade.
const INACTIVE_STATUSES = ["Cessado", "Suspenso", "Reformado"];

// Substitui o conteúdo de uma subcoleção de "blocos" pelos itens recebidos (cada um
// identificado pelo seu próprio id de documento)  -  cria/atualiza os que vieram no
// pedido e apaga os que já não constam da lista. Só é chamada quando o pedido traz a lista
// (ver saveCadastro): sem ela, apagaria a subcoleção toda.
async function syncBlockCollection(collectionRef, items, { idPorDataInicio = false } = {}) {
  const recebidos = items.filter(it => it && it.id);
  const incoming = idPorDataInicio ? idsPorDataInicio(recebidos) : recebidos;
  const existingSnap = await collectionRef.get();
  const existingIds = new Set(existingSnap.docs.map(doc => doc.id));
  const incomingIds = new Set(incoming.map(it => it.id));

  const batch = db.batch();
  let ops = 0;
  incoming.forEach(({ id, ...blocoData }) => {
    batch.set(collectionRef.doc(id), blocoData);
    ops++;
  });
  existingIds.forEach(docId => {
    if (!incomingIds.has(docId)) {
      batch.delete(collectionRef.doc(docId));
      ops++;
    }
  });
  if (ops > 0) await batch.commit();
}

// "nome" (conta) guarda o nome curto  -  primeiro e último nome do "nome_completo" do cadastro.
function getNomeCurto(nomeCompleto) {
  const partes = (nomeCompleto || "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "";
  if (partes.length === 1) return partes[0];
  return `${partes[0]} ${partes[partes.length - 1]}`;
}

// Únicos campos que os endpoints de cadastro podem ler/escrever no documento do colaborador
// (outras funcionalidades, como o processamento de salários, guardam os seus próprios campos
// no mesmo documento  -  sem esta lista explícita, ficariam a "vazar" para dentro do cadastro).
const CADASTRO_FIELD_KEYS = [
  "nome_completo", "data_nascimento", "nacionalidade",
  "morada", "codigo_postal", "localidade", "telefone", "telefone_emergencia", "grau_parentesco_emergencia",
  "n_cartao_cidadao", "validade_cc", "nif", "n_seguranca_social",
  "situacao_conjugal", "irs_jovem", "escalao_irs_jovem", "n_titulares",
  "n_dependentes", "tem_dependentes_deficientes", "n_dependentes_deficientes", "declarante_deficiente", "IBAN",
  "area_formacao", "habilitacoes", "ccp", "cv_atualizado", "ficha_dgert_atualizada",
  "sede", "role", "departamento", "situacao_contratual", "motivo_cessacao",
  "tipo_estagio", "n_processo_estagio", "id_processo_estagio", "entidade_medida",
  "data_inicio_estagio", "data_fim_estagio", "area_funcao", "habilitacoes_estagio",
  "entidade_estagio", "orientador", "observacao_estagio",
];

const getCadastro = async (req, res) => {
  try {
    const { id } = req.params;

    // Quando o pedido é sobre o próprio utilizador, o middleware (requireAuth) já leu
    // este mesmo documento - reaproveita-lo em vez de o reler (ver req.userDocExists).
    const userDocRef = db.collection("users").doc(id);
    let data;
    if (req.user?.uid === id && req.userDocExists) {
      data = req.userData;
    } else {
      const userDoc = await userDocRef.get();
      if (!userDoc.exists) {
        return res.status(404).json({ error: "Colaborador não encontrado" });
      }
      data = userDoc.data();
    }

    if (!canRead(req, id, data.entidade)) {
      return res.status(403).json({ error: "Sem permissão para consultar este cadastro" });
    }

    const form = {};
    CADASTRO_FIELD_KEYS.forEach(key => {
      if (data[key] !== undefined) form[key] = data[key];
    });

    // Documentos digitalizados  -  um documento por chave (ex: "digitalizacao_cc") em users/{id}/docs/{docKey}.
    const docsSnap = await userDocRef.collection("docs").get();
    const docs = {};
    docsSnap.forEach(doc => { docs[doc.id] = doc.data(); });

    // Cedências temporárias / baixas médicas  -  cada uma numa subcoleção própria (ver BLOCK_COLLECTIONS).
    const blocks = {};
    await Promise.all(BLOCK_COLLECTIONS.map(async ({ collection, requestKey }) => {
      const snap = await userDocRef.collection(collection).get();
      blocks[requestKey] = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }));

    // Nome da entidade do colaborador-alvo (não é um campo de cadastro, não entra em
    // CADASTRO_FIELD_KEYS) - o frontend usa-o só para decidir se mostra o botão de
    // editar a um Administrador (ver isEntidadeInScope/canEditCadastro em
    // usePermissions.js); a autorização real de escrita é sempre revalidada aqui no
    // servidor (canWrite/canEditRestricted), nunca decidida só por esse botão aparecer.
    let entidadeNome = null;
    if (data.entidade) {
      const entidadeDoc = await db.collection("entidades").doc(data.entidade.replace("entidades/", "")).get();
      entidadeNome = entidadeDoc.exists ? (entidadeDoc.data().nome || null) : null;
    }

    // "email" não é um campo de cadastro (não entra em CADASTRO_FIELD_KEYS)  -  é o
    // email da conta, devolvido à parte só para consulta no ecrã de cadastro.
    res.json({ form, docs, ...blocks, email: data.email || null, entidade: entidadeNome });
  } catch (error) {
    console.error("Erro ao buscar cadastro:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
};

// Rede de segurança do lado do servidor  -  o frontend já bloqueia o "Guardar" com estes
// mesmos problemas (ver getFieldErrors/getBlockErrors em Cadastro.jsx), mas a API não
// deve confiar apenas nisso. Só valida formato/consistência de campos preenchidos - um
// campo em branco não é aqui rejeitado (isso é tratado à parte, como "cadastro incompleto").
// Tal como no frontend, só rejeita um formato quando o valor já "parece completo" (mesmo
// nº de carateres do formato esperado) - fichas antigas com um valor mais curto do que o
// exigido hoje (nunca validado até agora) não podem ficar impedidas de gravar por causa
// de um campo que a pessoa nem está a editar.
function validarCadastroForm(form) {
  const erros = [];
  if ((form.nif || "").replace(/\D/g, "").length >= 9 && !validarNIF(form.nif)) erros.push("NIF inválido");
  if ((form.n_seguranca_social || "").replace(/\D/g, "").length >= 11 && !validarNISS(form.n_seguranca_social)) erros.push("Nº de segurança social inválido");
  if ((form.n_cartao_cidadao || "").replace(/\s/g, "").length >= 12 && !validarCartaoCidadao(form.n_cartao_cidadao)) erros.push("Nº de cartão de cidadão inválido");
  if ((form.codigo_postal || "").length >= 8 && !validarCodigoPostal(form.codigo_postal)) erros.push("Código postal inválido");
  if ((form.telefone || "").replace(/\D/g, "").length >= 9 && !validarTelefone(form.telefone)) erros.push("Contacto inválido");
  if ((form.telefone_emergencia || "").replace(/\D/g, "").length >= 9 && !validarTelefone(form.telefone_emergencia)) erros.push("Contacto de emergência inválido");
  if ((form.IBAN || "").replace(/\s/g, "").length >= 25 && !validarIBAN(form.IBAN)) erros.push("IBAN inválido");
  if (form.data_nascimento && form.validade_cc && form.validade_cc < form.data_nascimento) erros.push("Validade do CC anterior à data de nascimento");
  if (form.data_inicio_estagio && form.data_fim_estagio && form.data_fim_estagio < form.data_inicio_estagio) erros.push("Data de fim de estágio anterior à data de início");
  return erros;
}

const saveCadastro = async (req, res) => {
  try {
    const { id } = req.params;

    const userDocRef = db.collection("users").doc(id);
    // Precisa da entidade do colaborador-alvo antes de decidir a permissão (âmbito do
    // Administrador, ver canWrite) - idem getCadastro, reaproveita a existência já
    // confirmada pelo middleware quando o pedido é sobre o próprio utilizador, em vez
    // de reler o mesmo documento.
    let targetData;
    if (req.user?.uid === id && req.userDocExists) {
      targetData = req.userData;
    } else {
      const userDoc = await userDocRef.get();
      if (!userDoc.exists) {
        return res.status(404).json({ error: "Colaborador não encontrado" });
      }
      targetData = userDoc.data();
    }

    if (!canWrite(req, id, targetData.entidade)) {
      return res.status(403).json({ error: "Sem permissão para editar este cadastro" });
    }

    const { form, docs } = req.body;
    if (!form || typeof form !== "object") {
      return res.status(400).json({ error: "Dados de cadastro inválidos" });
    }

    const erros = validarCadastroForm(form);
    if (erros.length > 0) {
      return res.status(400).json({ error: erros.join("; ") });
    }

    const privileged = canEditRestricted(req, targetData.entidade);

    // Só para quem pode editar os blocos (são os únicos cujas subcoleções são gravadas): a
    // ordem das datas e, nos contratos a termo certo, as duas datas preenchidas.
    if (privileged) {
      const errosBlocos = [];
      BLOCK_COLLECTIONS.forEach(({ requestKey }) => {
        (Array.isArray(req.body[requestKey]) ? req.body[requestKey] : []).forEach(bloco => {
          if (bloco.dataInicio && bloco.dataFim && bloco.dataFim < bloco.dataInicio) {
            errosBlocos.push(`Data de fim anterior à data de início (${requestKey})`);
          } else if (bloco.tipo === TIPO_CONTRATO_A_TERMO_CERTO && (!bloco.dataInicio || !bloco.dataFim)) {
            errosBlocos.push(`Contrato a termo certo sem data de início ou de fim (${requestKey})`);
          }
        });
      });
      if (errosBlocos.length > 0) {
        return res.status(400).json({ error: errosBlocos.join("; ") });
      }
    }

    const update = {};
    CADASTRO_FIELD_KEYS.forEach(key => {
      if (!(key in form)) return;
      if (!privileged && RESTRICTED_KEYS.includes(key)) return;
      update[key] = form[key];
    });
    // Resumo da lista de contratos no próprio documento do colaborador (mapa de férias,
    // relatórios de assiduidade - ver resumoContratos), sempre que a lista é gravada.
    if (privileged && Array.isArray(req.body.contratos)) Object.assign(update, resumoContratos(req.body.contratos));

    const incomingDocs = docs || {};
    const existingDocsSnap = await userDocRef.collection("docs").get();
    const existingDocs = {};
    existingDocsSnap.forEach(doc => { existingDocs[doc.id] = doc.data(); });

    let finalDocs;
    if (privileged) {
      finalDocs = incomingDocs;
    } else {
      const mergedDocs = { ...incomingDocs };
      RESTRICTED_DOC_KEYS.forEach(key => {
        if (key in existingDocs) mergedDocs[key] = existingDocs[key];
        else delete mergedDocs[key];
      });
      finalDocs = mergedDocs;
    }

    update.cadastroUpdatedAt = admin.firestore.FieldValue.serverTimestamp();
    update.cadastroUpdatedBy = req.user.uid;

    const nomeCurto = getNomeCurto(form.nome_completo);
    if (nomeCurto) update.nome = nomeCurto;

    await userDocRef.update(update);

    const docsBatch = db.batch();
    const allDocKeys = new Set([...Object.keys(existingDocs), ...Object.keys(finalDocs)]);
    allDocKeys.forEach(key => {
      const docRef = userDocRef.collection("docs").doc(key);
      if (key in finalDocs) docsBatch.set(docRef, finalDocs[key]);
      else docsBatch.delete(docRef);
    });
    if (allDocKeys.size > 0) await docsBatch.commit();

    // Cedências temporárias / baixas médicas / contratos: só quem pode editar dados restritos
    // altera estas subcoleções  -  um utilizador sem privilégio pode enviá-las de volta tal como
    // as recebeu (o campo continua "só de leitura" no frontend), por isso ignoramo-las aqui.
    // Uma lista que não venha no pedido fica como está (ex: um separador aberto com uma
    // versão antiga do ecrã, que ainda não conhece a subcoleção "contratos").
    if (privileged) {
      await Promise.all(BLOCK_COLLECTIONS
        .filter(({ requestKey }) => Array.isArray(req.body[requestKey]))
        .map(({ collection, requestKey, idPorDataInicio }) =>
          syncBlockCollection(userDocRef.collection(collection), req.body[requestKey], { idPorDataInicio })
        ));
    }

    res.json({ message: "Cadastro guardado com sucesso" });
  } catch (error) {
    console.error("Erro ao guardar cadastro:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
};

// Notifica por email um colaborador cujo cadastro o frontend detetou como incompleto
// (contagem de campos em falta é calculada no cliente - ver COMPLETENESS_FIELDS em
// Cadastro.jsx - este endpoint só envia o aviso, sem repetir essa lógica no servidor).
// Mesma permissão de leitura do cadastro: quem pode consultar a ficha de alguém pode avisá-lo.
const notifyPerfilIncompleto = async (req, res) => {
  try {
    const { id } = req.params;

    let userData;
    if (req.user?.uid === id && req.userDocExists) {
      userData = req.userData;
    } else {
      const userDoc = await db.collection("users").doc(id).get();
      if (!userDoc.exists) {
        return res.status(404).json({ error: "Colaborador não encontrado" });
      }
      userData = userDoc.data();
    }

    if (!canRead(req, id, userData.entidade)) {
      return res.status(403).json({ error: "Sem permissão para notificar este colaborador" });
    }

    if (!userData.email) {
      return res.status(400).json({ error: "Colaborador sem email associado" });
    }

    await sendMail({
      to: userData.email,
      subject: "O seu cadastro na MAGNA ISO 9001 está incompleto",
      html: renderEmail("perfil-incompleto", { nome: userData.nome || "", eyebrow: "Cadastro incompleto" }),
      entidade: userData.entidade,
    });

    res.json({ message: "Notificação enviada com sucesso" });
  } catch (error) {
    console.error("Erro ao notificar perfil incompleto:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
};

// Notifica de uma só vez todos os colaboradores ativos de uma entidade que ainda não têm
// NIF registado - mesmo aviso de notifyPerfilIncompleto, mas disparado a partir do botão
// junto ao nome da entidade em ColaboradoresGroupedList (ver Colaboradores.jsx) em vez de
// perfil a perfil. "entidade" vem pelo nome (tal como devolvido por getColaboradores/
// ColaboradoresGroupedList, que só conhece o nome, nunca o id do documento - mesmo padrão
// de GET /salario/export/:mes).
const notifyEntidadeSemNif = async (req, res) => {
  try {
    const entidadeNome = typeof req.body?.entidade === "string" ? req.body.entidade.trim() : "";
    if (!entidadeNome) {
      return res.status(400).json({ error: "Entidade não especificada" });
    }

    const entidadesSnap = await db.collection("entidades").get();
    const entidadeDoc = entidadesSnap.docs.find(doc => (doc.data().nome || doc.id) === entidadeNome);
    if (!entidadeDoc) {
      return res.status(404).json({ error: "Entidade não encontrada" });
    }
    const entidadeRef = `entidades/${entidadeDoc.id}`;

    if (!isAdminOrHR(req.user?.nivelAcesso) && !isAdminInScope(req, entidadeRef)) {
      return res.status(403).json({ error: "Sem permissão para notificar colaboradores desta entidade" });
    }

    const usersSnap = await db.collection("users").where("entidade", "==", entidadeRef).get();
    const alvos = usersSnap.docs
      .map(doc => doc.data())
      // Administradores não contam para este aviso - o "cadastro incompleto" é dirigido
      // aos colaboradores da entidade, não a quem a gere.
      .filter(data => !isAdministrador(data.nivelAcesso)
        && !INACTIVE_STATUSES.includes(data.situacao_contratual)
        && !(data.nif || "").trim()
        && data.email);

    await Promise.all(alvos.map(data => sendMail({
      to: data.email,
      subject: "O seu cadastro na MAGNA ISO 9001 está incompleto",
      html: renderEmail("perfil-incompleto", { nome: data.nome || "", eyebrow: "Cadastro incompleto" }),
      entidade: entidadeRef,
    })));

    res.json({ message: `Notificação enviada a ${alvos.length} colaborador(es) sem NIF`, count: alvos.length });
  } catch (error) {
    console.error("Erro ao notificar colaboradores sem NIF:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
};

module.exports = { getCadastro, saveCadastro, notifyPerfilIncompleto, notifyEntidadeSemNif };