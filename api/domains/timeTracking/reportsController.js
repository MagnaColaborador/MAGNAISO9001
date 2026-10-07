const admin = require("firebase-admin");
const { resolveTargetUid } = require("./helpers");
const { getHolidaysDDMM } = require("./holidays");
const { isBlocoAtivoEm, labelBaixaOuLicenca } = require("../../shared/lib/absenceBlocks");
const { isHoraExtraAprovada, camposAprovacao } = require("./overtimeApprovalController");
const db = admin.firestore();

// Função auxiliar para calcular horas (igual a calcularHoras no frontend). Devolve o
// tempo real de ponto do dia (sem limite de 8h): tempo além das 8h / fora das
// 08:30-17:00 conta como trabalhado mas NÃO é hora extra - horas extra são apenas as
// registadas explicitamente em HorasExtraManual.
function calcularHorasHelper(horaEntrada, horaSaida) {
  if (!horaEntrada || !horaSaida) return { minutos: 0 };

  const [hEntrada, mEntrada] = horaEntrada.split(':').map(Number);
  const [hSaida, mSaida] = horaSaida.split(':').map(Number);

  if (isNaN(hEntrada) || isNaN(mEntrada) || isNaN(hSaida) || isNaN(mSaida)) {
    return { minutos: 0 };
  }

  let minutosTrabalhados = (hSaida * 60 + mSaida) - (hEntrada * 60 + mEntrada);

  if (minutosTrabalhados > 300) {
    minutosTrabalhados -= 30;
  }

  // Fins de semana são tratados como dias normais
  return { minutos: minutosTrabalhados };
}

// Horas extra manuais de um ano. Filtra pelo ano embutido em "date" (DD-MM-YYYY),
// que todos os documentos têm, em vez de .where("year", "==", ...): registos antigos,
// criados antes de existir o campo "year", ficavam de fora do total anual e do saldo
// (o mensal via /calendar filtra por "date" e mostrava-os, daí a discrepância).
async function getManualOvertimeDocsForYear(uid, year) {
  const snapshot = await db
    .collection("registo-ponto")
    .doc(uid)
    .collection("HorasExtraManual")
    .get();
  const ano = String(year);
  return snapshot.docs.filter(doc => (doc.data().date || "").split("-")[2] === ano);
}

// Função auxiliar para formatar minutos
function formatarMinutosHelper(totalMinutos) {
  if (totalMinutos <= 0) return "0h 0m";
  const horas = Math.floor(totalMinutos / 60);
  const minutos = totalMinutos % 60;
  return `${horas}h ${minutos}m`;
}

// Função auxiliar para obter nome do mês
function getMonthName(month) {
  const months = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ];
  return months[month - 1];
}

// getUserCreatedAt/getUserSede/getUserCadastroAusencias liam cada uma, de forma
// independente, o mesmo documento users/{uid}  -  3 leituras redundantes sempre que um
// chamador precisava das 3. Os dois chamadores (getUserRecords e
// calculateMonthlyAttendanceSummary, mais abaixo) agora leem esse documento uma única
// vez e passam userData às funções puras abaixo; só getUserCadastroAusencias continua
// assíncrona, por causa da subcoleção baixasMedicas que lhe é própria.

// Data de criação do colaborador, a partir de um users/{uid} já lido.
function extractUserCreatedAt(userData) {
  const createdAt = userData?.createdAt;
  if (!createdAt) return null;

  // Verificar se é um Timestamp do Firestore
  if (typeof createdAt.toDate === 'function') {
    return createdAt.toDate();
  }

  // Verificar se é uma string ISO
  if (typeof createdAt === 'string') {
    const dateFromString = new Date(createdAt);
    if (!isNaN(dateFromString.getTime())) {
      return dateFromString;
    }
  }

  return null;
}

// Sede do colaborador (users/{uid}.sede)  -  usada para saber que feriado
// municipal aplicar no cálculo de faltas (ver ./holidays.js), a partir de um
// users/{uid} já lido.
function extractUserSede(userData) {
  return userData?.sede || null;
}

// Situação contratual e ausências geridas no módulo de Cadastro (situacao_contratual/
// data_fim_contrato no próprio documento do colaborador, já lido pelo chamador, e a
// subcoleção users/{uid}/baixasMedicas  -  ver cadastroController.js). Distintas das
// coleções Ferias/BaixasMedicas do livro de ponto acima, e até agora nunca cruzadas com
// o cálculo de faltas (ver isDiaForaDeAtivo, usado em calculateMonthlyAttendanceSummary).
// As cedências temporárias (users/{uid}/cedencias) ficam de fora de propósito: o
// colaborador cedido continua a bater o ponto, por isso o livro de ponto trata-o como ativo.
async function getUserCadastroAusencias(uid, userData) {
  const data = userData || {};

  const licencasSnap = await db.collection("users").doc(uid).collection("baixasMedicas").get();

  return {
    situacaoContratual: data.situacao_contratual || "Ativo",
    dataFimContrato: data.data_fim_contrato || null,
    licencasOuBaixas: licencasSnap.docs.map(doc => doc.data()),
  };
}

// Situação contratual diferente de "Ativo" exclui o dia de contar como falta, exceto
// quando é "Cessado" com data de fim de contrato conhecida  -  nesse caso só os dias
// depois dessa data ficam de fora (antes dela o colaborador estava mesmo ativo). Sem
// essa data (ou "Suspenso"/"Reformado", que não têm campo de data próprio no cadastro),
// não há como delimitar o período, por isso o mês inteiro fica de fora por segurança.
function isDiaForaDeAtivo({ situacaoContratual, dataFimContrato }, dataIso) {
  if (situacaoContratual === "Ativo") return false;
  if (situacaoContratual === "Cessado" && dataFimContrato) return dataIso > dataFimContrato;
  return true;
}

// Saldo anual de horas extra: bruto acumulado (só HorasExtraManual do ano - os Registos
// de ponto nunca geram horas extra automaticamente,
// sem subtrair faltas  -  o mensal passa a não se mexer, ver compensateShortDay em
// timeTrackingController.js) menos o que já foi usado para compensar dias curtos
// (campo "horas_compensatorias", gravado no próprio Registos do dia compensado).
async function computeAnnualOvertimeBalance(uid, year) {
  const [compensatedMinutes, manualOvertimeDocs] = await Promise.all([
    getCompensatedMinutesForYear(uid, year),
    getManualOvertimeDocsForYear(uid, year),
  ]);

  // Só as horas extra aprovadas pela GestorRH entram no saldo (ver overtimeApprovalController.js).
  let grossMinutes = 0;
  manualOvertimeDocs.filter(doc => isHoraExtraAprovada(doc.data())).forEach(doc => {
    grossMinutes += doc.data().totalMinutes || 0;
  });

  return { grossMinutes, compensatedMinutes, netMinutes: grossMinutes - compensatedMinutes };
}

// Soma de "horas_compensatorias" dos Registos do ano. Só os dias compensados têm este
// campo (gravado ao aprovar uma compensação - ver approveCompensation), por isso em vez de
// ler todos os Registos do ano (centenas de documentos até dezembro, para somar um campo
// que quase nunca existe) lê-se só os que o têm: where(">", 0) num único campo usa o
// índice automático de campo único, sem índice novo. Devolve todos os anos (poucos
// documentos), filtrados aqui pelo ano com os mesmos limites de antes (ver
// isTimestampInRange). Um dia sem o campo, ou com 0, somava 0 - fica de fora sem mudar o
// total. Se a query falhar por falta de índice (FAILED_PRECONDITION, ex.: campo isento de
// indexação), volta à leitura do ano inteiro de antes - mesmo resultado, mais leituras.
const FAILED_PRECONDITION = 9;
async function getCompensatedMinutesForYear(uid, year) {
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31, 23, 59, 59);
  const registosRef = db.collection("registo-ponto").doc(uid).collection("Registos");

  try {
    const snapshot = await registosRef.where("horas_compensatorias", ">", 0).get();
    let total = 0;
    snapshot.forEach(doc => {
      const data = doc.data();
      if (isTimestampInRange(data.timestamp, yearStart, yearEnd)) total += data.horas_compensatorias;
    });
    return total;
  } catch (queryError) {
    if (queryError.code !== FAILED_PRECONDITION) throw queryError;
    console.warn("[getCompensatedMinutesForYear] Query por horas_compensatorias indisponível - a ler os Registos do ano inteiro:", queryError.message);
    const snapshot = await registosRef
      .where("timestamp", ">=", yearStart)
      .where("timestamp", "<=", yearEnd)
      .get();
    let total = 0;
    snapshot.forEach(doc => {
      total += doc.data().horas_compensatorias || 0;
    });
    return total;
  }
}

const getUserRecords = async (req, res) => {
  try {
    const { month, year } = req.body;

    if (!month) {
      return res.status(400).json({ error: "O mês é obrigatório" });
    }

    const { uid: userId, error: authError } = await resolveTargetUid(req);
    if (authError) return res.status(403).json({ error: authError });

    const now = new Date();
    const selectedYear = year || now.getFullYear();
    const firstDay = new Date(selectedYear, month - 1, 1);
    const lastDay = new Date(selectedYear, month, 0, 23, 59, 59);

    const registosRef = db
      .collection("registo-ponto")
      .doc(userId)
      .collection("Registos");

    const snapshot = await registosRef
      .where("timestamp", ">=", firstDay)
      .where("timestamp", "<=", lastDay)
      .orderBy("timestamp", "asc")
      .get();

    const listaDeDatas = [];
    let tempDate = new Date(firstDay);
    while (tempDate <= lastDay) {
      let dd = String(tempDate.getDate()).padStart(2, "0");
      let mm = String(tempDate.getMonth() + 1).padStart(2, "0");
      let yyyy = tempDate.getFullYear();
      listaDeDatas.push(`${dd}-${mm}-${yyyy}`);
      tempDate.setDate(tempDate.getDate() + 1);
    }

    const feriasRef = db
      .collection("registo-ponto")
      .doc(userId)
      .collection("Ferias");

    const baixasRef = db
      .collection("registo-ponto")
      .doc(userId)
      .collection("BaixasMedicas");

    const aniversarioRef = db
      .collection("registo-ponto")
      .doc(userId)
      .collection("DiasAniversario");

    let feriasInfos = [];
    for (let i = 0; i < listaDeDatas.length; i += 30) {
      const batch = listaDeDatas.slice(i, i + 30);
      const feriasSnapshot = await feriasRef.where("date", "in", batch).get();
      feriasInfos.push(
        ...feriasSnapshot.docs.map((doc) => ({
          date: doc.data().date,
          approved: doc.data().Approved ?? false
        }))
      );
    }

    let baixasInfos = [];
    for (let i = 0; i < listaDeDatas.length; i += 30) {
      const batch = listaDeDatas.slice(i, i + 30);
      const baixasSnapshot = await baixasRef.where("date", "in", batch).get();
      baixasInfos.push(
        ...baixasSnapshot.docs.map((doc) => ({
          date: doc.data().date,
          approved: doc.data().Approved ?? false
        }))
      );
    }

    let aniversarioInfos = [];
    for (let i = 0; i < listaDeDatas.length; i += 30) {
      const batch = listaDeDatas.slice(i, i + 30);
      const aniversarioSnapshot = await aniversarioRef.where("date", "in", batch).get();
      aniversarioInfos.push(
        ...aniversarioSnapshot.docs.map((doc) => ({
          date: doc.data().date,
          approved: doc.data().Approved ?? false
        }))
      );
    }

    // Buscar horas extras manuais
    const manualOvertimeRef = db
      .collection("registo-ponto")
      .doc(userId)
      .collection("HorasExtraManual");

    let manualOvertimeInfos = [];
    for (let i = 0; i < listaDeDatas.length; i += 30) {
      const batch = listaDeDatas.slice(i, i + 30);
      const manualOvertimeSnapshot = await manualOvertimeRef.where("date", "in", batch).get();
      manualOvertimeInfos.push(
        ...manualOvertimeSnapshot.docs.map((doc) => {
          const data = doc.data();
          const totalMinutes = data.totalMinutes || 0;
          // Registos antigos foram gravados só com totalMinutes, sem hours/minutes
          // -  derivar a partir do total em vez de assumir 0h 0m (ver ManualOvertimeModal.jsx,
          // que mostra "{entry.hours}h {entry.minutes}m").
          const hours = data.hours !== undefined && data.hours !== null ? data.hours : Math.floor(totalMinutes / 60);
          const minutes = data.minutes !== undefined && data.minutes !== null ? data.minutes : totalMinutes % 60;
          return {
            id: doc.id,
            date: data.date,
            hours,
            minutes,
            totalMinutes,
            description: data.description || "",
            startHour: data.startHour || "",
            endHour: data.endHour || "",
            ...camposAprovacao(data)
          };
        })
      );
    }

    // Pedidos de compensação do mês (todos os estados) - para a coluna "Compensação Horas"
    // mostrar também os pendentes/rejeitados. Só os aprovados têm efeito (o campo
    // horas_compensatorias do registo do dia) - ver compensationApprovalController.js.
    const pedidosCompensacaoRef = db
      .collection("registo-ponto")
      .doc(userId)
      .collection("PedidosCompensacao");
    let compensacoesInfos = [];
    for (let i = 0; i < listaDeDatas.length; i += 30) {
      const batch = listaDeDatas.slice(i, i + 30);
      const pedidosSnapshot = await pedidosCompensacaoRef.where("date", "in", batch).get();
      compensacoesInfos.push(
        ...pedidosSnapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            date: data.date,
            minutos: data.minutos || 0,
            saldoDisponivel: data.saldoDisponivel ?? null,
            ...camposAprovacao(data)
          };
        })
      );
    }

    // users/{userId} lido uma única vez e partilhado pelas 3 leituras abaixo (ver nota em
    // extractUserCreatedAt/extractUserSede/getUserCadastroAusencias).
    const userDocForSummary = await db.collection('users').doc(userId).get();
    const userDataForSummary = userDocForSummary.exists ? userDocForSummary.data() : null;
    // Data de criação do colaborador, para o frontend não contar faltas antes da conta existir
    const userCreatedAt = extractUserCreatedAt(userDataForSummary);
    // Sede do colaborador, para o frontend saber que feriado municipal aplicar
    const sede = extractUserSede(userDataForSummary);
    // Situação contratual e licenças/baixas do Cadastro, para o frontend não
    // marcar esses dias como falta (ver isDiaForaDeAtivo/getUserCadastroAusencias acima).
    const cadastroAusencias = await getUserCadastroAusencias(userId, userDataForSummary);

    const registos = snapshot.docs.map((doc) => {
      const data = doc.data();
      const dataFormatada = data.timestamp.toDate().toISOString().split("T")[0];
      const [yyyy, mm, dd] = dataFormatada.split("-");
      const diaMesAnoFormatado = `${dd}-${mm}-${yyyy}`;

      let status = "Trabalho";
      let horaEntrada = data.horaEntrada || "-";
      let horaSaida = data.horaSaida || "-";

      // Verificar se há horas extras manuais para esta data
      const manualOvertimeForDay = manualOvertimeInfos.filter(mo => mo.date === diaMesAnoFormatado);
      const hasManualOvertime = manualOvertimeForDay.length > 0;
      const manualOvertimeTotalMinutes = manualOvertimeForDay.reduce((sum, mo) => sum + (mo.totalMinutes || 0), 0);

      if (feriasInfos.some(f => f.date === diaMesAnoFormatado)) {
        status = "Férias";
        horaEntrada = "ferias";
        horaSaida = "ferias";
      } else if (baixasInfos.some(b => b.date === diaMesAnoFormatado)) {
        status = "Baixa Médica";
        horaEntrada = "Baixa";
        horaSaida = "Baixa";
      } else if (aniversarioInfos.some(a => a.date === diaMesAnoFormatado)) {
        status = "Aniversário";
        horaEntrada = "aniversario";
        horaSaida = "aniversario";
      }

      return {
        timestamp: data.timestamp.toDate().toISOString(),
        horaEntrada,
        horaSaida,
        status,
        manualOvertime: hasManualOvertime ? `${Math.floor(manualOvertimeTotalMinutes / 60)}h ${manualOvertimeTotalMinutes % 60}m` : null,
        manualOvertimeMinutes: manualOvertimeTotalMinutes,
        manualOvertimeEntries: manualOvertimeForDay,
        manualOvertimeDescription: manualOvertimeForDay.map(mo => mo.description).join(', '),
        horasCompensatorias: data.horas_compensatorias || 0
      };
    });

    return res.status(200).json({
      registos,
      ferias: feriasInfos,
      baixas: baixasInfos,
      aniversario: aniversarioInfos,
      manualOvertime: manualOvertimeInfos,
      compensacoes: compensacoesInfos,
      createdAt: userCreatedAt ? userCreatedAt.toISOString() : null,
      sede,
      situacaoContratual: cadastroAusencias.situacaoContratual,
      dataFimContrato: cadastroAusencias.dataFimContrato,
      licencasOuBaixasCadastro: cadastroAusencias.licencasOuBaixas
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

const getOvertimeSummary = async (req, res) => {
  try {
    const { year } = req.body;

    const { uid: userId, error: authError } = await resolveTargetUid(req);
    if (authError) return res.status(403).json({ error: authError });

    const now = new Date();
    const currentYear = year || now.getFullYear();

    const registosRef = db
      .collection("registo-ponto")
      .doc(userId)
      .collection("Registos");

    const yearStart = new Date(currentYear, 0, 1);
    const yearEnd = new Date(currentYear, 11, 31, 23, 59, 59);

    const snapshot = await registosRef
      .where("timestamp", ">=", yearStart)
      .where("timestamp", "<=", yearEnd)
      .orderBy("timestamp", "asc")
      .get();

    const monthlyData = {};
    let totalOvertimeMinutes = 0;
    // Compensações de dias curtos usadas no ano (campo "horas_compensatorias" no
    // próprio Registos do dia)  -  descontam do saldo anual, nunca do mês.
    let totalCompensatedMinutes = 0;

    snapshot.forEach(doc => {
      const data = doc.data();
      const date = data.timestamp.toDate();
      const month = date.getMonth() + 1;
      const monthKey = `${String(month).padStart(2, "0")}`;

      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = {
          month: month,
          monthName: getMonthName(month),
          totalMinutes: 0,
          overtimeMinutes: 0,
          manualOvertimeMinutes: 0,
          workDays: 0
        };
      }

      if (data.horaEntrada && data.horaSaida) {
        const { minutos } = calcularHorasHelper(data.horaEntrada, data.horaSaida);
        // Só tempo de ponto (entrada/saída) - a compensação (horas_compensatorias) é
        // contada à parte em totalCompensatedMinutes e nunca somada às horas trabalhadas.
        monthlyData[monthKey].totalMinutes += minutos;
        monthlyData[monthKey].workDays++;
      }

      totalCompensatedMinutes += data.horas_compensatorias || 0;
    });

    // Buscar horas extras manuais (ver getManualOvertimeDocsForYear) - só as aprovadas
    // pela GestorRH contam para o resumo e o saldo (ver overtimeApprovalController.js).
    const manualOvertimeDocs = (await getManualOvertimeDocsForYear(userId, currentYear))
      .filter(doc => isHoraExtraAprovada(doc.data()));

    let totalManualOvertimeMinutes = 0;

    manualOvertimeDocs.forEach(doc => {
      const data = doc.data();
      // Extrair mês da data no formato DD-MM-YYYY (o ano já vem filtrado pela query acima)
      const dateParts = data.date.split('-');
      const month = parseInt(dateParts[1]);
      const monthKey = `${String(month).padStart(2, "0")}`;

      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = {
          month: month,
          monthName: getMonthName(month),
          totalMinutes: 0,
          overtimeMinutes: 0,
          manualOvertimeMinutes: 0,
          workDays: 0
        };
      }

      monthlyData[monthKey].manualOvertimeMinutes += data.totalMinutes || 0;
      totalManualOvertimeMinutes += data.totalMinutes || 0;
      // DEBUG horas extra
    });

    // Só horas extra manuais - não há horas extra automáticas a partir dos Registos
    totalOvertimeMinutes += totalManualOvertimeMinutes;

    for (let month = 1; month <= 12; month++) {
      const monthKey = `${String(month).padStart(2, "0")}`;
      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = {
          month: month,
          monthName: getMonthName(month),
          totalMinutes: 0,
          overtimeMinutes: 0,
          manualOvertimeMinutes: 0,
          workDays: 0
        };
      }
    }

    // O mensal é sempre bruto (nunca reduzido por faltas ou deduções  -  ver
    // compensateShortDay/computeAnnualOvertimeBalance, que descontam do anual).
    const monthlyArray = Object.values(monthlyData)
      .filter(month => month.workDays > 0 || month.manualOvertimeMinutes > 0) // Mostrar meses com registos ou horas extras manuais
      .sort((a, b) => a.month - b.month) // Ordenar por número do mês (1=Janeiro, 2=Fevereiro, etc.)
      .map(month => {
        const totalMonthOvertimeMinutes = month.overtimeMinutes + month.manualOvertimeMinutes;
        return {
          ...month,
          totalHours: formatarMinutosHelper(month.totalMinutes),
          overtimeHours: formatarMinutosHelper(month.overtimeMinutes),
          manualOvertimeHours: month.manualOvertimeMinutes > 0 ? formatarMinutosHelper(month.manualOvertimeMinutes) : null,
          totalOvertimeHours: formatarMinutosHelper(totalMonthOvertimeMinutes),
          netOvertimeHours: formatarMinutosHelper(totalMonthOvertimeMinutes),
          netOvertimeMinutes: totalMonthOvertimeMinutes
        };
      });

    const totalNetOvertimeMinutes = Math.max(0, totalOvertimeMinutes - totalCompensatedMinutes);

    return res.status(200).json({
      monthlyOvertime: monthlyArray,
      totalOvertimeHours: formatarMinutosHelper(totalOvertimeMinutes),
      totalCompensatedHours: totalCompensatedMinutes > 0 ? formatarMinutosHelper(totalCompensatedMinutes) : null,
      totalCompensatedMinutes,
      totalNetOvertimeHours: formatarMinutosHelper(totalNetOvertimeMinutes),
      totalNetOvertimeMinutes,
      year: currentYear
    });

  } catch (error) {
    console.error("Erro ao buscar resumo de horas extras:", error);
    return res.status(500).json({ error: error.message });
  }
};

// Só o saldo anual de horas extra - o que /ponto (TotalSummary) e o detalhe do
// colaborador (UserDetails) usam de /overtime-summary. Mesma fórmula e mesmos campos
// totalNet* que getOvertimeSummary, mas sem ler todos os Registos do ano para o detalhe
// mensal (monthlyOvertime), que nenhuma página usa: os Registos só contam para o saldo
// através de horas_compensatorias (ver getCompensatedMinutesForYear).
const getOvertimeBalance = async (req, res) => {
  try {
    const { year } = req.body;

    const { uid: userId, error: authError } = await resolveTargetUid(req);
    if (authError) return res.status(403).json({ error: authError });

    const currentYear = year || new Date().getFullYear();
    const { grossMinutes, compensatedMinutes } = await computeAnnualOvertimeBalance(userId, currentYear);
    const totalNetOvertimeMinutes = Math.max(0, grossMinutes - compensatedMinutes);

    return res.status(200).json({
      totalOvertimeHours: formatarMinutosHelper(grossMinutes),
      totalCompensatedHours: compensatedMinutes > 0 ? formatarMinutosHelper(compensatedMinutes) : null,
      totalCompensatedMinutes: compensatedMinutes,
      totalNetOvertimeHours: formatarMinutosHelper(totalNetOvertimeMinutes),
      totalNetOvertimeMinutes,
      year: currentYear
    });
  } catch (error) {
    console.error("Erro ao buscar saldo de horas extra:", error);
    return res.status(500).json({ error: error.message });
  }
};

// Resumo anual de assiduidade (Faltas/Férias/Baixas Médicas) para a página de
// detalhe do colaborador. Usa o mesmo cálculo mensal do processamento de salários
// (computeMonthlyAttendance), mês a mês, para que os totais anuais fiquem
// consistentes com a tabela mensal do livro de ponto: dias inteiros (não frações) e
// feriados/férias/baixas/aniversário excluídos.
//
// Antes chamava calculateMonthlyAttendanceSummary 12 vezes, o que relia 12x os mesmos
// dados anuais (users/{uid}, baixas do Cadastro e Ferias/BaixasMedicas/
// DiasAniversario "where year") - agora cada um é lido uma única vez e os 12 meses são
// calculados em memória. Os Registos passam a ser 1 query do ano inteiro, repartida
// por mês com exatamente os mesmos limites das 12 queries mensais (ver
// isTimestampInRange) - os mesmos documentos, lidos uma vez.
const getYearlySummary = async (req, res) => {
  try {
    const { year } = req.body;

    const { uid: userId, error: authError } = await resolveTargetUid(req);
    if (authError) return res.status(403).json({ error: authError });

    const currentYear = year || new Date().getFullYear();

    const userContext = await loadAttendanceUserContext(userId);

    const { firstDay: yearStart } = getMonthBounds(currentYear, 1);
    const { lastDay: yearEnd } = getMonthBounds(currentYear, 12);
    const registoPontoRef = db.collection("registo-ponto").doc(userId);
    const [registosSnapshot, feriasSnapshot, baixasSnapshot, aniversarioSnapshot] = await Promise.all([
      registoPontoRef.collection("Registos")
        .where("timestamp", ">=", yearStart)
        .where("timestamp", "<=", yearEnd)
        .get(),
      registoPontoRef.collection("Ferias").where("year", "==", currentYear).get(),
      registoPontoRef.collection("BaixasMedicas").where("year", "==", currentYear).get(),
      registoPontoRef.collection("DiasAniversario").where("year", "==", currentYear).get(),
    ]);

    const registosAno = registosSnapshot.docs.map(doc => doc.data());
    const ferias = feriasSnapshot.docs.map(doc => doc.data());
    const baixas = baixasSnapshot.docs.map(doc => doc.data());
    const aniversario = aniversarioSnapshot.docs.map(doc => doc.data());
    const now = new Date();

    let diasFerias = 0;
    let diasBaixaMedica = 0;
    let diasFalta = 0;

    for (let month = 1; month <= 12; month++) {
      const { firstDay, lastDay } = getMonthBounds(currentYear, month);
      const monthSummary = computeMonthlyAttendance({
        year: currentYear,
        month,
        now,
        userContext,
        registos: registosAno.filter(registo => isTimestampInRange(registo.timestamp, firstDay, lastDay)),
        ferias,
        baixas,
        aniversario,
      });
      diasFerias += monthSummary.diasFerias;
      diasBaixaMedica += monthSummary.diasBaixaMedica;
      diasFalta += monthSummary.diasFalta;
    }

    return res.status(200).json({
      year: currentYear,
      diasFerias,
      diasBaixaMedica,
      diasFalta
    });

  } catch (error) {
    console.error("Erro ao buscar resumo anual:", error);
    return res.status(500).json({ error: error.message });
  }
};

// Resumo de assiduidade de UM mês para um colaborador  -  usado pelo processamento
// de salários (dias trabalhados/faltas/férias/baixas deixam de ser inseridos à mão
// e passam a vir do livro de ponto). Função pura, sem req/res e sem efeitos
// secundários (não grava nada), ao contrário de processOvertimeDeduction.
//
// "assumeWorkedFrom" (opcional, Date) é usado pelo fecho mensal (ver
// api/domains/fechoMensal/fechoMensalController.js e api/shared/lib/monthLock.js):
// a partir desse dia (inclusive) até ao fim do mês, um dia útil sem ausência válida já
// registada é assumido como trabalhado em vez de ficar em branco/falta  -  é o que
// permite fechar o mês antes do dia 25 sem esperar pelos dias que ainda faltam
// decorrer. Sem este parâmetro o comportamento é exatamente o mesmo de sempre.
async function calculateMonthlyAttendanceSummary({ uid, year, month, assumeWorkedFrom }) {
  const userContext = await loadAttendanceUserContext(uid);
  const now = new Date();

  const { firstDay, lastDay } = getMonthBounds(year, month);

  const registoPontoRef = db.collection("registo-ponto").doc(uid);
  const registosSnapshot = await registoPontoRef.collection("Registos")
    .where("timestamp", ">=", firstDay)
    .where("timestamp", "<=", lastDay)
    .get();

  // Ferias: só os dias deste mês (ver getMonthAbsenceDocs) - antes lia o ano inteiro
  // (~20+ documentos por colaborador) para usar apenas os do mês pedido.
  // BaixasMedicas/DiasAniversario continuam filtradas por "year" (todos os documentos
  // destas coleções já têm este campo - ver backfill e escrita em createMedicalLeave/
  // toggleBirthdayDay): têm quase sempre 0-1 documentos por ano (o dia de aniversário é
  // no máximo 1/ano), e como cada query custa pelo menos 1 leitura, os 2 lotes "in" do
  // mês custariam mais do que 1 query anual.
  const [ferias, baixasSnapshot, aniversarioSnapshot] = await Promise.all([
    getMonthAbsenceDocs(registoPontoRef.collection("Ferias"), getDatasDoMes(year, month), year),
    registoPontoRef.collection("BaixasMedicas").where("year", "==", year).get(),
    registoPontoRef.collection("DiasAniversario").where("year", "==", year).get(),
  ]);

  return computeMonthlyAttendance({
    year,
    month,
    assumeWorkedFrom,
    now,
    userContext,
    registos: registosSnapshot.docs.map(doc => doc.data()),
    ferias,
    baixas: baixasSnapshot.docs.map(doc => doc.data()),
    aniversario: aniversarioSnapshot.docs.map(doc => doc.data()),
  });
}

// users/{uid} (sede, createdAt, situação contratual) e as baixas do Cadastro
// - iguais para qualquer mês, por isso getYearlySummary lê-os uma só vez para os 12.
// As baixas do Cadastro são blocos com início/fim que podem atravessar meses,
// por isso continuam a ser lidos por inteiro (não há um filtro por mês equivalente).
async function loadAttendanceUserContext(uid) {
  // users/{uid} lido uma única vez e partilhado pelas 3 leituras abaixo, em vez de cada
  // uma reler o mesmo documento de forma independente (ver nota acima).
  const userDoc = await db.collection('users').doc(uid).get();
  const userData = userDoc.exists ? userDoc.data() : null;
  return {
    userCreatedAt: extractUserCreatedAt(userData),
    sede: extractUserSede(userData),
    cadastroAusencias: await getUserCadastroAusencias(uid, userData),
  };
}

// Limites (hora local do servidor) usados desde sempre na query mensal de Registos.
function getMonthBounds(year, month) {
  return {
    firstDay: new Date(year, month - 1, 1),
    lastDay: new Date(year, month, 0, 23, 59, 59),
  };
}

// Mesma semântica de where("timestamp", ">=", firstDay).where("timestamp", "<=", lastDay)
// - comparação exata em segundos/nanossegundos do Timestamp, sem arredondar a
// milissegundos (toDate() arredondaria), para a repartição do ano por meses em
// getYearlySummary devolver exatamente os mesmos documentos que as queries mensais.
function isTimestampInRange(timestamp, firstDay, lastDay) {
  if (!timestamp || typeof timestamp.seconds !== "number") return false;
  const compare = (a, b) => (a.seconds - b.seconds) || (a.nanoseconds - b.nanoseconds);
  return compare(timestamp, admin.firestore.Timestamp.fromDate(firstDay)) >= 0
    && compare(timestamp, admin.firestore.Timestamp.fromDate(lastDay)) <= 0;
}

// Todas as datas do mês no formato gravado em Ferias.date ("DD-MM-AAAA", sempre com dois
// dígitos - ver createVacation/toggleVacationDay; confirmado nos dados existentes, todos
// os documentos com "year" seguem este formato).
function getDatasDoMes(year, month) {
  const mm = String(month).padStart(2, "0");
  const diasNoMes = new Date(year, month, 0).getDate();
  return Array.from({ length: diasNoMes }, (_, i) => `${String(i + 1).padStart(2, "0")}-${mm}-${year}`);
}

// "date" é uma string "DD-MM-AAAA", que não ordena cronologicamente - por isso um
// intervalo (>=/<=) nesse campo daria resultados errados; usa-se "in" com as datas do
// mês, em lotes de 30 (limite do Firestore), tal como getUserRecords. O filtro "year"
// que a query anual aplicava mantém-se aqui em memória, para o conjunto de documentos
// considerado ser exatamente o mesmo de antes (um documento com a data certa mas sem o
// campo "year" continua de fora).
async function getMonthAbsenceDocs(collectionRef, datasDoMes, year) {
  const lotes = [];
  for (let i = 0; i < datasDoMes.length; i += 30) {
    lotes.push(datasDoMes.slice(i, i + 30));
  }
  const snapshots = await Promise.all(lotes.map(lote => collectionRef.where("date", "in", lote).get()));
  return snapshots
    .flatMap(snapshot => snapshot.docs.map(doc => doc.data()))
    .filter(data => data.year === year);
}

// Datas em Ferias/BaixasMedicas aparecem tanto em "DD-MM" como em "DD-MM-YYYY"
// (ver getYearlySummary acima)  -  normalizar para {dia, mes, ano}.
function parseDocDate(dateStr) {
  if (!dateStr || !dateStr.includes("-")) return null;
  const parts = dateStr.split("-");
  if (parts.length === 2) return { dia: parseInt(parts[0]), mes: parseInt(parts[1]), ano: null };
  if (parts[0].length === 4) return { ano: parseInt(parts[0]), mes: parseInt(parts[1]), dia: parseInt(parts[2]) };
  return { dia: parseInt(parts[0]), mes: parseInt(parts[1]), ano: parseInt(parts[2]) };
}

// Cálculo de um mês a partir de dados já lidos (sem acessos ao Firestore) - partilhado
// por calculateMonthlyAttendanceSummary (1 mês) e getYearlySummary (12 meses com os
// mesmos dados anuais). "registos" são só os do mês; ferias/baixas/aniversario podem
// incluir outros meses do mesmo ano (são filtrados abaixo pelo mês, como sempre foram).
function computeMonthlyAttendance({ year, month, assumeWorkedFrom, now, userContext, registos, ferias, baixas, aniversario }) {
  const { userCreatedAt, sede, cadastroAusencias } = userContext;

  let diasTrabalhados = 0;
  const registoPorDia = {};
  registos.forEach(registo => {
    if (registo.horaEntrada && registo.horaSaida) diasTrabalhados++;
    registoPorDia[registo.timestamp.toDate().getDate()] = registo;
  });

  let diasFerias = 0;
  const feriasDias = new Set();
  ferias.forEach(data => {
    if (data.Approved !== true) return;
    const parsed = parseDocDate(data.date);
    if (!parsed || parsed.mes !== month || (parsed.ano !== null && parsed.ano !== year)) return;
    diasFerias++;
    feriasDias.add(parsed.dia);
  });

  let diasBaixaMedica = 0;
  const baixasDias = new Set();
  baixas.forEach(data => {
    if (data.Approved !== true) return;
    const parsed = parseDocDate(data.date);
    if (!parsed || parsed.mes !== month || (parsed.ano !== null && parsed.ano !== year)) return;
    diasBaixaMedica++;
    baixasDias.add(parsed.dia);
  });

  // Dia de aniversário: excluído de faltas tal como férias/baixa, mas não conta
  // como "dia trabalhado" nem entra na quota de férias.
  let diasAniversario = 0;
  const aniversarioDias = new Set();
  aniversario.forEach(data => {
    if (data.Approved !== true) return;
    const parsed = parseDocDate(data.date);
    if (!parsed || parsed.mes !== month || (parsed.ano !== null && parsed.ano !== year)) return;
    diasAniversario++;
    aniversarioDias.add(parsed.dia);
  });

  // Feriados nacionais + móveis + feriado municipal da sede do colaborador (mesma
  // lógica usada em processOvertimeDeduction, abaixo).
  const holidays = getHolidaysDDMM(sede, year);

  const diasNoMes = new Date(year, month, 0).getDate();
  let diasFalta = 0;
  let diasLicenca = 0;
  const dias = [];

  // Meia-noite do dia da confirmação (dia civil, não o instante exato)  -  esse dia e os
  // seguintes ficam sujeitos à projeção "sem ausência válida = trabalho" (ver comentário
  // na assinatura da função).
  const assumeWorkedFromDay = assumeWorkedFrom
    ? new Date(assumeWorkedFrom.getFullYear(), assumeWorkedFrom.getMonth(), assumeWorkedFrom.getDate())
    : null;

  for (let dia = 1; dia <= diasNoMes; dia++) {
    const dataAtual = new Date(year, month - 1, dia);
    const diaSemana = dataAtual.getDay();
    const diaString = `${String(dia).padStart(2, "0")}-${String(month).padStart(2, "0")}`;
    const diaIso = `${year}-${String(month).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
    const dataFormatada = `${String(dia).padStart(2, "0")}-${String(month).padStart(2, "0")}-${year}`;

    let status;

    if (diaSemana < 1 || diaSemana > 5) {
      status = "fim-de-semana";
    } else if (holidays.includes(diaString)) {
      status = "feriado";
    } else if (feriasDias.has(dia)) {
      status = "ferias";
    } else if (baixasDias.has(dia)) {
      status = "baixa";
    } else if (aniversarioDias.has(dia)) {
      status = "aniversario";
    } else if (
      // Licença/baixa médica (registada no Cadastro) ou contrato já não ativo (cessado/
      // suspenso/reformado)  -  ver getUserCadastroAusencias acima. A cedência temporária
      // não entra aqui: o colaborador cedido continua a bater o ponto como os outros.
      isDiaForaDeAtivo(cadastroAusencias, diaIso) ||
      cadastroAusencias.licencasOuBaixas.some(bloco => isBlocoAtivoEm(bloco, diaIso))
    ) {
      status = "inativo";
      // Dos blocos do Cadastro, só as "Licença ..." (parental, luto, ...) contam para
      // diasLicenca  -  baixa médica do Cadastro fica de fora (não é a mesma coisa que
      // diasBaixaMedica, que vem só do livro de ponto) para não misturar as duas colunas
      // no export de processamento de salários (ver salarioController.js).
      const blocoLicenca = cadastroAusencias.licencasOuBaixas.find(bloco => isBlocoAtivoEm(bloco, diaIso));
      if (blocoLicenca && labelBaixaOuLicenca(blocoLicenca.tipo) === "Licença") diasLicenca++;
    } else if (userCreatedAt && dataAtual < userCreatedAt) {
      // Antes da conta existir - nunca falta.
      status = "inativo";
    } else if (registoPorDia[dia] && registoPorDia[dia].horaEntrada && registoPorDia[dia].horaSaida) {
      status = "trabalho";
    } else if (registoPorDia[dia] && registoPorDia[dia].horaEntrada) {
      // Tem pelo menos a entrada batida, mesmo sem saída - hoje ainda a decorrer, ou um
      // dia já passado em que só faltou bater a saída. Em qualquer dos casos sabe-se que
      // esteve presente, por isso conta como trabalhado (diasTrabalhados++, ao contrário
      // do ramo "incompleto" abaixo) em vez de ficar por classificar.
      status = "trabalho";
      diasTrabalhados++;
    } else if (registoPorDia[dia]) {
      // Tem registo do dia mas nem a entrada está preenchida (raro) - não há confirmação
      // de presença nesse dia, por isso não conta como trabalhado nem como falta, mas
      // também não deve aparecer com o estado "trabalho" no detalhe diário (ver
      // STATUS_LABELS em monthlyClosingButton.jsx), senão a contagem mostrada (dias com
      // estado "trabalho") deixa de bater certo com o total diasTrabalhados devolvido acima.
      status = "incompleto";
    } else if (assumeWorkedFromDay && dataAtual >= assumeWorkedFromDay) {
      // Mês fechado: dia da confirmação (inclusive) em diante, sem ausência válida
      // registada - assumido como trabalhado para o processamento salarial.
      status = "trabalho_previsto";
      diasTrabalhados++;
    } else if (dataAtual < now && dataAtual.toDateString() !== now.toDateString()) {
      // Falta = já passou e não há registo nenhum nesse dia. Um registo incompleto (ex.:
      // entrada sem saída, esqueceu-se de bater o ponto) não conta como falta  -  segue a
      // mesma regra da tabela do livro de ponto (pontoTable.jsx), onde calcularHoras
      // devolve total "-" nesse caso e por isso não entra no filtro de diasFalta.
      status = "falta";
      diasFalta++;
    } else {
      // Dia futuro fora da projeção (mês ainda não fechado) - nem falta nem trabalho.
      status = "futuro";
    }

    dias.push({ dia, data: dataFormatada, status });
  }

  return { diasTrabalhados, diasFerias, diasBaixaMedica, diasAniversario, diasFalta, diasLicenca, dias };
}

module.exports = {
  getUserRecords,
  getOvertimeSummary,
  getOvertimeBalance,
  getYearlySummary,
  calculateMonthlyAttendanceSummary,
  computeAnnualOvertimeBalance,
  getManualOvertimeDocsForYear
};
