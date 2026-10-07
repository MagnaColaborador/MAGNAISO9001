const admin = require("firebase-admin");
const { normalizeUserId } = require("./helpers");
const { normalizeEntityId } = require("../../shared/lib/normalizeEntityId");
const { isSuperAdmin, isAdminOrHR, isGestorRH, isAdministrador, isGestorFinanceiro, entidadesGeridasPor, entidadeNoAmbito } = require("../../shared/middleware/auth");
const { sendMail, renderEmail } = require("../../shared/services/mailer");
const db = admin.firestore();

// Únicos valores válidos para o nível de acesso (controla permissões). Distinto
// de "role", que é só o cargo/título mostrado (texto livre) e nunca deve ser
// usado para decidir permissões.
const NIVEIS_ACESSO = ["SuperAdmin", "GestorRH", "Administrador", "GestorFinanceiro", "Colaborador"];
function normalizeNivelAcesso(nivelAcesso) {
  return NIVEIS_ACESSO.includes(nivelAcesso) ? nivelAcesso : "Colaborador";
}

// Um Administrador só gere colaboradores da sua própria entidade e nunca pode
// promover ninguém (incluindo a si próprio) a um nível igual ou superior ao seu
// (GestorRH/GestorFinanceiro/SuperAdmin)  -  isso continua exclusivo do SuperAdmin. Um
// GestorRH pode atribuir GestorFinanceiro (área diferente da sua, não é uma promoção a
// par/acima) mas nunca Administrador/GestorRH/SuperAdmin. Um SuperAdmin continua sem restrições.
function normalizeNivelAcessoForActor(actorNivelAcesso, requestedNivelAcesso) {
  const requested = normalizeNivelAcesso(requestedNivelAcesso);
  if (isSuperAdmin(actorNivelAcesso)) return requested;
  if (isGestorRH(actorNivelAcesso)) {
    if (requested === "GestorFinanceiro") return requested;
    if (requested === "Administrador" || requested === "GestorRH" || requested === "SuperAdmin") return "Colaborador";
    return requested;
  }
  if (requested === "GestorRH" || requested === "GestorFinanceiro" || requested === "SuperAdmin") return "Colaborador";
  return requested;
}

// Nomes legíveis das entidades adicionais (para além de "entidade") que um
// Administrador também gere (ver entidadesGeridasPor) - usado em userDetails/
// updateUserDetails para pré-preencher/devolver o formulário de atribuição, que só um
// SuperAdmin pode submeter.
async function resolveEntidadesGeridasNomes(refs) {
  if (!Array.isArray(refs) || !refs.length) return [];
  const nomes = await Promise.all(refs.map(async (ref) => {
    const entidadeId = typeof ref === "string" ? ref.replace("entidades/", "") : null;
    if (!entidadeId) return null;
    try {
      const entidadeDoc = await db.collection("entidades").doc(entidadeId).get();
      return entidadeDoc.exists ? (entidadeDoc.data().nome || entidadeId) : entidadeId;
    } catch (err) {
      console.error("⚠️ Erro ao buscar entidade:", err);
      return entidadeId;
    }
  }));
  return nomes.filter(Boolean);
}

// Nome legível da entidade para o email de boas-vindas - o formulário envia o nome, mas
// um Administrador envia o ID da sua; em ambos os casos lê o "nome" do doc da entidade e,
// se não existir, mostra o valor recebido.
async function resolveEntidadeNome(entidade) {
  if (!entidade) return null;
  try {
    const entidadeDoc = await db.collection("entidades").doc(normalizeEntityId(entidade)).get();
    return entidadeDoc.exists ? (entidadeDoc.data().nome || entidade) : entidade;
  } catch (err) {
    console.error("⚠️ Erro ao buscar entidade:", err);
    return entidade;
  }
}

async function sendWelcomeEmail({ to, nome, email, password, entidade, subjectPrefix = "" }) {
  await sendMail({
    to,
    subject: `${subjectPrefix}Bem-vindo(a) à plataforma MAGNA ISO 9001`,
    html: renderEmail("boas-vindas", {
      nome,
      email,
      password,
      entidadeNome: await resolveEntidadeNome(entidade),
      eyebrow: "Boas-vindas",
    }),
    entidade: entidade ? `entidades/${normalizeEntityId(entidade)}` : null,
  });
}

const createUser = async (req, res) => {
  try {
    const { nome, email, role, nivelAcesso, temporaryPassword } = req.body;
    const actorIsAdministrador = isAdministrador(req.user?.nivelAcesso);
    // Administrador só pode criar colaboradores dentro de uma entidade que gere. No caso
    // comum (uma só entidade) ignora qualquer "entidade" enviada no corpo e usa sempre a
    // sua; um Administrador de mais do que uma entidade (ver entidadesGeridasPor) tem de
    // indicar qual das suas é a do novo colaborador.
    const actorEntidades = actorIsAdministrador ? entidadesGeridasPor(req.user) : null;
    let entidade;
    if (actorIsAdministrador && actorEntidades.length > 1) {
      const requestedRef = req.body.entidade ? `entidades/${normalizeEntityId(req.body.entidade)}` : null;
      if (!requestedRef || !actorEntidades.includes(requestedRef)) {
        return res.status(400).json({ error: "Indique uma das entidades que administra para este colaborador" });
      }
      entidade = req.body.entidade;
    } else if (actorIsAdministrador) {
      entidade = (req.user?.entidade || "").replace("entidades/", "");
    } else {
      entidade = req.body.entidade;
    }

    // Validação básica
    if (!nome || !email || !entidade || !temporaryPassword) {
      return res.status(400).json({ error: 'Nome, email, entidade e senha temporária são obrigatórios' });
    }

    // Gerar ID único
    let baseUserId = normalizeUserId(nome);
    let userId = baseUserId;
    let counter = 1;

    // Verificar colisões no Firestore
    let userDocRef = db.collection('users').doc(userId);
    let docSnapshot = await userDocRef.get();

    while (docSnapshot.exists) {
      userId = `${baseUserId}-${String(++counter).padStart(2, '0')}`;
      userDocRef = db.collection('users').doc(userId);
      docSnapshot = await userDocRef.get();
    }

    // Criar colaborador no Firebase Authentication
    let authUser;
    try {
      authUser = await admin.auth().createUser({
        uid: userId,
        email,
        password: temporaryPassword,
        displayName: nome
      });
    } catch (authError) {
      if (authError.code === 'auth/email-already-exists') {
        return res.status(409).json({ error: 'Email já está em uso' });
      }
      throw authError;
    }

    // Criar colaborador no Firestore
    try {
      const entityId = normalizeEntityId(entidade);
      const entityRef = `entidades/${entityId}`;

      await userDocRef.set({
        nome,
        email,
        entidade: entityRef,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        role: role ? normalizeUserId(role) : 'user',
        nivelAcesso: normalizeNivelAcessoForActor(req.user?.nivelAcesso, nivelAcesso),
        isFirstLogin: true
      });
    } catch (firestoreError) {
      // Rollback: Apagar colaborador do Auth se o Firestore falhar
      await admin.auth().deleteUser(userId);
      throw firestoreError;
    }

    // Email de boas-vindas (por omissão ligado; o formulário pode desligá-lo). Só é enviado
    // depois de a conta existir e uma falha no envio nunca a desfaz - a resposta indica
    // welcomeEmailSent: false para a interface avisar que o email não seguiu.
    let welcomeEmailSent = null;
    if (req.body.sendWelcomeEmail !== false) {
      try {
        await sendWelcomeEmail({ to: email, nome, email, password: temporaryPassword, entidade });
        welcomeEmailSent = true;
      } catch (mailError) {
        console.error(`Erro ao enviar email de boas-vindas a ${email}:`, mailError);
        welcomeEmailSent = false;
      }
    }

    return res.status(201).json({
      message: 'colaborador criado com sucesso',
      id: userId,
      welcomeEmailSent
    });

  } catch (error) {
    console.error('Erro no processo completo:', error);
    return res.status(500).json({ error: 'Falha na criação do colaborador' });
  }
};

// Envia o email de boas-vindas, com dados à escolha, para um endereço de teste - para
// confirmar o aspeto antes de criar a conta. Não cria nem altera contas, por isso não
// verifica se o email já está em uso. Sem password, mostra-a oculta.
const sendWelcomeEmailTest = async (req, res) => {
  try {
    const { to, nome, email, password, entidade } = req.body;
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(400).json({ error: 'Indique um email de destino válido' });
    }

    await sendWelcomeEmail({
      to,
      nome: nome?.trim() || 'Nome do Colaborador',
      email: email?.trim() || 'colaborador@exemplo.pt',
      password: password?.trim() || '••••••••',
      entidade: entidade?.trim() || (req.user?.entidade || '').replace('entidades/', '') || null,
      subjectPrefix: '[Teste] ',
    });

    return res.json({ message: `Email de teste enviado para ${to}` });
  } catch (error) {
    console.error('Erro ao enviar email de boas-vindas de teste:', error);
    return res.status(500).json({ error: error.message || 'Falha ao enviar o email de teste' });
  }
};

const userDetails = async (req, res) => {
  try {
    const { uid } = req.body;

    if (!uid) {
      return res.status(400).json({ error: "O campo uid é obrigatório." });
    }

    const userDoc = await db.collection("users").doc(uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: "User não encontrado." });
    }

    const userData = userDoc.data();

    if (isAdministrador(req.user?.nivelAcesso) && !entidadeNoAmbito(req.user, userData.entidade)) {
      return res.status(403).json({ error: "Acesso restrito a colaboradores da sua entidade" });
    }

    let entidadeNome = "Desconhecida";

    if (userData.entidade && typeof userData.entidade === "string") {
      const entidadeParts = userData.entidade.split("/");

      if (entidadeParts.length === 2 && entidadeParts[0] === "entidades") {
        const entidadeId = entidadeParts[1];

        try {
          const entidadeRef = await db.collection("entidades").doc(entidadeId).get();
          if (entidadeRef.exists) {
            entidadeNome = entidadeRef.data().nome || "Desconhecida";
          }
        } catch (err) {
          console.error("⚠️ Erro ao buscar entidade:", err);
        }
      }
    }

    const entidadesGeridasNomes = await resolveEntidadesGeridasNomes(userData.entidadesGeridas);

    const userDetails = {
      uid,
      email: userData.email || "N/A",
      entidade: entidadeNome,
      nome: userData.nome || "N/A",
      role: userData.role || "N/A",
      nivelAcesso: normalizeNivelAcesso(userData.nivelAcesso),
      entidadesGeridasNomes,
      // Função de Gestor(a) de Qualidade  -  independente de nivelAcesso (ver
      // isGestorQualidade em auth.js).
      gestorQualidade: userData.gestorQualidade === true,
    };

    res.json(userDetails);
  } catch (error) {
    console.error("🚨 Erro ao buscar detalhes do user:", error);
    res.status(500).json({ error: "Erro ao buscar detalhes do user." });
  }
};

const getUsersByEntity = async (req, res) => {
  try {
    const { entidadeNome } = req.body;

    if (!entidadeNome) {
      return res.status(400).json({ error: "O campo entidadeNome é obrigatório." });
    }

    const entidadeId = normalizeEntityId(entidadeNome);

    if (isAdministrador(req.user?.nivelAcesso) && !entidadeNoAmbito(req.user, `entidades/${entidadeId}`)) {
      return res.status(403).json({ error: "Acesso restrito à sua entidade" });
    }

    const usersRef = db.collection("users");
    const snapshot = await usersRef.where("entidade", "==", `entidades/${entidadeId}`).get();

    if (snapshot.empty) {
      return res.status(200).json([]);
    }

    const users = snapshot.docs.map(doc => {
      return {
        uid: doc.id,
        ...doc.data(),
      };
    });

    return res.status(200).json(users);
  } catch (error) {
    console.error("Erro ao buscar users por entidade:", error);
    return res.status(500).json({ error: "Erro ao buscar users." });
  }
};

const updateUserDetails = async (req, res) => {
  try {
    const { uid, nome, role, nivelAcesso } = req.body;
    const actorIsAdministrador = isAdministrador(req.user?.nivelAcesso);

    const userDocRef = db.collection("users").doc(uid);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: "user não encontrado." });
    }

    if (actorIsAdministrador && !entidadeNoAmbito(req.user, userDoc.data().entidade)) {
      return res.status(403).json({ error: "Acesso restrito a colaboradores da sua entidade" });
    }
    // Um Administrador nunca pode editar um GestorRH/GestorFinanceiro/SuperAdmin que por
    // acaso partilhe a mesma entidade  -  evita conseguir despromovê-lo ou alterar os seus dados.
    if (actorIsAdministrador && (isAdminOrHR(userDoc.data().nivelAcesso) || isGestorFinanceiro(userDoc.data().nivelAcesso))) {
      return res.status(403).json({ error: "Acesso restrito a colaboradores da sua entidade" });
    }

    // Administrador nunca pode mandar um colaborador para uma entidade que não gere. No
    // caso comum (uma só entidade) mantém sempre a sua, para não conseguir "tirar"
    // ninguém dela; um Administrador de mais do que uma entidade (ver
    // entidadesGeridasPor) pode mover o colaborador entre as que gere, mas nunca para fora.
    const actorEntidades = actorIsAdministrador ? entidadesGeridasPor(req.user) : null;
    let entidade;
    if (actorIsAdministrador && actorEntidades.length > 1) {
      const requestedRef = req.body.entidade ? `entidades/${normalizeEntityId(req.body.entidade)}` : null;
      if (!requestedRef || !actorEntidades.includes(requestedRef)) {
        return res.status(400).json({ error: "Só pode atribuir uma das entidades que administra" });
      }
      entidade = req.body.entidade;
    } else if (actorIsAdministrador) {
      entidade = (req.user?.entidade || "").replace("entidades/", "");
    } else {
      entidade = req.body.entidade;
    }

    if (!uid || !nome || !entidade || !role) {
      return res.status(400).json({ error: "Todos os campos são obrigatórios." });
    }

    const entidadeId = normalizeEntityId(entidade);
    const entidadeRef = `entidades/${entidadeId}`;

    // O ID do documento (== UID do Firebase Auth) nunca muda, mesmo quando o
    // nome muda  -  os dados em "registo-ponto/{uid}" continuam válidos sem
    // precisar de nenhuma migração.
    const updatedData = { entidade: entidadeRef, nome, role, updatedAt: new Date() };
    // Ninguém pode alterar o seu próprio nível de acesso, nem o de outro GestorRH ou de
    // um Administrador (exceto SuperAdmin)  -  GestorRH nunca pode promover/despromover
    // um Administrador (só o SuperAdmin o faz), e é um nível de pares entre si; um
    // GestorRH/Administrador consegue chegar a qualquer ficha em /ponto/user-details
    // (requireAdminOrEntidadeAdmin não distingue "editar outro" de "editar-se a si
    // próprio"), por isso este bloqueio tem de ficar aqui e não só no formulário.
    const isSelfEdit = uid === req.user?.uid;
    const targetNivelAcesso = userDoc.data().nivelAcesso;
    const nivelAcessoBloqueado = !isSuperAdmin(req.user?.nivelAcesso)
      && (isSelfEdit || isGestorRH(targetNivelAcesso) || isAdministrador(targetNivelAcesso));
    if (nivelAcesso !== undefined && !nivelAcessoBloqueado) {
      updatedData.nivelAcesso = normalizeNivelAcessoForActor(req.user?.nivelAcesso, nivelAcesso);
    }

    // "entidadesGeridas" (entidades adicionais que um Administrador também gere, ver
    // entidadesGeridasPor) é um campo de permissões, não um dado normal do colaborador -
    // só um SuperAdmin pode defini-lo, nunca o próprio Administrador nem um GestorRH.
    // Quando ausente do pedido, não é tocado (mantém o que já lá estava).
    if (req.body.entidadesGeridas !== undefined) {
      if (!isSuperAdmin(req.user?.nivelAcesso)) {
        return res.status(403).json({ error: "Só um SuperAdmin pode definir as entidades geridas por um Administrador." });
      }
      if (!Array.isArray(req.body.entidadesGeridas)) {
        return res.status(400).json({ error: "entidadesGeridas deve ser uma lista de entidades." });
      }
      updatedData.entidadesGeridas = req.body.entidadesGeridas
        .filter((nome) => typeof nome === "string" && nome.trim())
        .map((nome) => `entidades/${normalizeEntityId(nome)}`);
    }

    // "gestorQualidade" é uma função transversal (dá acesso a todas as Não Conformidades
    // da organização, independentemente de entidade/nivelAcesso) - mesma sensibilidade de
    // "entidadesGeridas" acima, por isso só um SuperAdmin pode alterá-la. Ao contrário de
    // "entidadesGeridas" (só enviado pelo formulário nos casos em que faz sentido), o
    // formulário de edição envia sempre o valor atual deste campo; por isso, quando quem
    // pede não é SuperAdmin, ignora-se o valor em vez de rejeitar o pedido inteiro (mesmo
    // padrão de "nivelAcessoBloqueado" acima: os outros campos continuam a poder ser
    // gravados).
    if (req.body.gestorQualidade !== undefined && isSuperAdmin(req.user?.nivelAcesso)) {
      updatedData.gestorQualidade = req.body.gestorQualidade === true;
    }

    await userDocRef.update(updatedData);

    const entidadeDoc = await db.collection("entidades").doc(entidadeId).get();
    const entidadeNome = entidadeDoc.exists ? (entidadeDoc.data().nome || "Desconhecida") : "Desconhecida";
    // Devolve sempre o estado atual (já refletindo esta atualização, se "entidadesGeridas"
    // fez parte dela), para o formulário nunca ficar com uma versão desatualizada.
    const entidadesGeridasNomes = await resolveEntidadesGeridasNomes(
      updatedData.entidadesGeridas ?? userDoc.data().entidadesGeridas
    );

    return res.status(200).json({
      message: "colaborador atualizado com sucesso.",
      uid,
      nome,
      role,
      nivelAcesso: updatedData.nivelAcesso ?? normalizeNivelAcesso(userDoc.data().nivelAcesso),
      entidade: entidadeNome,
      entidadesGeridasNomes,
      gestorQualidade: updatedData.gestorQualidade ?? (userDoc.data().gestorQualidade === true),
    });
  } catch (error) {
    console.error("🚨 Erro ao atualizar colaborador:", error);
    res.status(500).json({ error: "Erro interno do servidor." });
  }
};

const deleteUser = async (req, res) => {
  const { uid } = req.body;

  if (!uid) {
    return res.status(400).json({ error: "O uid é obrigatório" });
  }

  console.log("A apagar user", uid, "e os seus dados");

  try {
    const userDocRef = db.collection("users").doc(uid);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: "user não encontrado." });
    }

    if (isAdministrador(req.user?.nivelAcesso)) {
      if (!entidadeNoAmbito(req.user, userDoc.data().entidade)) {
        return res.status(403).json({ error: "Acesso restrito a colaboradores da sua entidade" });
      }
      if (isAdminOrHR(userDoc.data().nivelAcesso) || isGestorFinanceiro(userDoc.data().nivelAcesso)) {
        return res.status(403).json({ error: "Acesso restrito a colaboradores da sua entidade" });
      }
    }

    const registoPontoRef = db.collection("registo-ponto").doc(uid);
    const subcollections = ["Registos", "Ferias", "BaixasMedicas", "HorasExtraManual", "DeducoesHorasExtras"];
    const CHUNK_SIZE = 400;
    for (const sub of subcollections) {
      const snapshot = await registoPontoRef.collection(sub).get();
      const docs = snapshot.docs;
      for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
        const chunk = docs.slice(i, i + CHUNK_SIZE);
        const batchDel = db.batch();
        chunk.forEach((doc) => batchDel.delete(doc.ref));
        await batchDel.commit();
      }
    }

    await registoPontoRef.delete();
    await userDocRef.delete();
    await admin.auth().deleteUser(uid);

    console.log("Utilizador", uid, "apagado com sucesso.");
    return res.status(200).json({ message: "Utilizador apagado com sucesso." });
  } catch (error) {
    console.error("Erro ao apagar utilizador:", error);
    return res.status(500).json({ error: "Erro ao apagar utilizador." });
  }
};

module.exports = {
  createUser,
  sendWelcomeEmailTest,
  userDetails,
  getUsersByEntity,
  updateUserDetails,
  deleteUser
};
