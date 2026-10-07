import React, { useState, useEffect, useContext } from 'react';
import { useNavigate, useLocation, useParams, Link } from "react-router-dom";
import { FaUser, FaCalendarDays } from "react-icons/fa6";
import { apiFetch } from '../../../shared/utils/apiFetch';
import { UserContext } from '../../../shared/context/userContext';
import LoadingSpinner from '../components/Shared/loadingSpinner';
import Sidebar from '../../../shared/components/Sidebar';
import Topbar from '../../../shared/components/Topbar';
import TableHours from '../components/Admin/clients/pontoTable';
import UserStats from '../components/Admin/clients/userStats';
import AutocompleteInput from '../../../shared/components/AutocompleteInput';
import { FUNCAO } from '../../../shared/utils/formOptions';
import { usePermissions } from '../../../shared/hooks/usePermissions';

const GOLD = "#C8932F";

const cardStyle = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" };
const cardHeaderStyle = { padding: "14px 18px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", gap: 8 };
const inputStyle = {
  width: "100%", fontSize: 13, color: "#111827", fontWeight: 500,
  border: "1px solid #e5e7eb", borderRadius: 6, padding: "7px 9px",
  outline: "none", background: "#fafafa", boxSizing: "border-box",
};
const labelStyle = { fontSize: 11, color: "#6b7280", marginBottom: 4, display: "block" };
const valueStyle = { fontSize: 13, color: "#111827", fontWeight: 500 };
const btnOutline = (color) => ({ padding: "7px 16px", fontSize: 12.5, fontWeight: 500, borderRadius: 999, border: `1.5px solid ${color}`, color, background: "transparent", cursor: "pointer" });
const btnSolid = { padding: "8px 20px", fontSize: 12.5, fontWeight: 500, borderRadius: 999, border: "none", color: "#fff", background: GOLD, cursor: "pointer" };
const btnGhost = { padding: "8px 20px", fontSize: 12.5, fontWeight: 500, borderRadius: 999, border: "1px solid #e5e7eb", color: "#6b7280", background: "transparent", cursor: "pointer" };

const UserDetails = ({ selectedUser }) => {
  const [userDetails, setUserDetails] = useState(null);
  const [editedData, setEditedData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showMonths, setShowMonths] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [showDetails, setShowDetails] = useState(true);
  const [totais, setTotais] = useState(null);
  const [totaisAnuais, setTotaisAnuais] = useState(null);
  // Saldo anual líquido de horas extra em minutos (para o botão "Compensar").
  const [saldoHorasExtra, setSaldoHorasExtra] = useState(undefined);
  const [feriasPendentes, setFeriasPendentes] = useState([]);
  const [pendingTimeEdits, setPendingTimeEdits] = useState([]);
  const [baixasPendentes, setBaixasPendentes] = useState([]);
  // Horas extra manuais pendentes de aprovação (só GestorRH/SuperAdmin as veem e decidem).
  const [horasExtraPendentes, setHorasExtraPendentes] = useState([]);
  // Pedidos de compensação pendentes de aprovação (mesmo fluxo das horas extra).
  const [compensacoesPendentes, setCompensacoesPendentes] = useState([]);
  // Recarrega a tabela do mês depois de aprovar/rejeitar uma hora extra (estado na coluna).
  const [tabelaReloadTick, setTabelaReloadTick] = useState(0);
  const [deslocacoesPendentes, setDeslocacoesPendentes] = useState([]);
  const [fechoMensal, setFechoMensal] = useState(null);
  const [entidadesOptions, setEntidadesOptions] = useState([]);
  // Entidades adicionais (para além de "Entidade" acima) que este colaborador, quando
  // Administrador, também gere - só um SuperAdmin pode atribuir isto (ver
  // entidadesGeridasPor no backend).
  const [entidadesGeridasSelecionadas, setEntidadesGeridasSelecionadas] = useState([]);
  const navigate = useNavigate(); // Obtém a função navigate
  const location = useLocation();
  const { uid: uidParam } = useParams();
  const [dados, setDados] = useState([]);
  const { username, uid: actorUid, entidadesGeridasNomes } = useContext(UserContext);
  // Um Administrador só gere colaboradores das entidades que administra e nunca pode
  // atribuir/manter um nível de acesso igual ou superior ao seu; um GestorRH pode
  // atribuir GestorFinanceiro (área diferente da sua) mas nunca Administrador/GestorRH/
  // SuperAdmin, que continuam exclusivos do SuperAdmin  -  o backend também impõe isto
  // (updateUserDetails/normalizeNivelAcessoForActor), mas o formulário fica
  // coerente com o que é aceite.
  const { isAdministrador, isSuperAdmin, isGestorRH, isAdminOrHR } = usePermissions();
  // Caso raro de um Administrador que gere mais do que uma entidade: em vez de
  // bloquear o campo "Entidade", deixa mover o colaborador entre as que gere (ver
  // entidadesGeridasPor no backend).
  const isMultiEntidadeAdministrador = isAdministrador && (entidadesGeridasNomes?.length || 0) > 1;

  const handleSelectFile = (filePath) => {
    const formattedPath = filePath.replace(/\s/g, '-').replace(/\//g, '__');
    navigate(`/file/${formattedPath}`, { state: { originalFilename: filePath } });
  };

  // Dividir o caminho em segmentos
  const pathSegments = location.pathname
    .split("/")
    .filter((segment) => segment); // Remove segmentos vazios

  // Pega o uid do parâmetro da rota, depois do selectedUser, depois do localStorage (legado)
  const userName = uidParam || selectedUser?.uid || localStorage.getItem("selectedUserUID");

  // Ninguém pode alterar o seu próprio nível de acesso, nem o de outro GestorRH ou de
  // um Administrador (exceto SuperAdmin)  -  o backend já recusa em silêncio
  // (updateUserDetails), aqui só se evita mostrar um campo editável que na prática não
  // tem efeito.
  const isEditingSelf = !!actorUid && actorUid === userName;
  const targetIsGestorRH = userDetails?.nivelAcesso === "GestorRH";
  const targetIsAdministrador = userDetails?.nivelAcesso === "Administrador";
  const nivelAcessoBloqueado = !isSuperAdmin && (isEditingSelf || targetIsGestorRH || targetIsAdministrador);

  // Guarda o uid no localStorage quando selectedUser mudar
  useEffect(() => {
    if (selectedUser?.uid) {
      localStorage.setItem("selectedUserUID", selectedUser.uid);
    } else if (!localStorage.getItem("selectedUserUID")) {
      console.error("❌ Nenhum userName disponível!");
    }
  }, [selectedUser]);

  // Lista de entidades para o autocomplete do campo "Entidade"  -  só é preciso para
  // quem pode mesmo editá-la (um Administrador de uma só entidade tem o campo sempre
  // desativado); um Administrador de mais do que uma usa antes as suas próprias
  // (entidadesGeridasNomes), nunca a lista completa.
  useEffect(() => {
    if (isAdministrador) {
      if (isMultiEntidadeAdministrador) setEntidadesOptions(entidadesGeridasNomes);
      return;
    }
    (async () => {
      try {
        const res = await apiFetch("/entities/showEntities", { method: "POST" });
        if (!res.ok) return;
        const data = await res.json();
        setEntidadesOptions(Array.isArray(data.entityNames) ? data.entityNames : []);
      } catch (err) {
        console.error("Erro ao buscar entidades:", err);
      }
    })();
  }, [isAdministrador, isMultiEntidadeAdministrador, entidadesGeridasNomes]);

  useEffect(() => {

    if (!userName) {
      return;
    }

    // 🔴 Resetando os estados ao mudar de utilizador ou ano
    setShowMonths(false);
    setSelectedMonth(null);

    const fetchUserDetails = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await apiFetch(`/timetracking/userDetails`, {
          method: "POST",
          body: JSON.stringify({ uid: userName }),
        });

        if (!response.ok) {
          const errorMessage = await response.text();
          throw new Error(errorMessage || "Erro ao buscar dados do user");
        }

        const data = await response.json();


        setUserDetails(data);
        setEditedData({ ...data, oldNome: data.nome });

        // Buscar férias pendentes
        await fetchFeriasPendentes();

        // Buscar pedidos de alteração de horas pendentes
        await fetchPendingTimeEdits();

        // Buscar pedidos de baixa médica pendentes
        await fetchBaixasPendentes();

        // Buscar horas extra e pedidos de compensação pendentes de aprovação
        await fetchHorasExtraPendentes();
        await fetchCompensacoesPendentes();

        // Buscar deslocações pendentes
        await fetchDeslocacoesPendentes();

        // Buscar totais anuais
        await fetchTotaisAnuais();

      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
    };

    fetchUserDetails();
  }, [userName, selectedYear ]);

  const fetchFeriasPendentes = async () => {
    try {
      // Usar o novo endpoint específico para férias pendentes
      const response = await apiFetch(`/timetracking/pending-vacations`, {
        method: "POST",
        body: JSON.stringify({ uid: userName, year: selectedYear }),
      });

      if (response.ok) {
        const data = await response.json();
        setFeriasPendentes(data.feriasPendentes || []);
      } else {
        setFeriasPendentes([]);
      }
    } catch (err) {
      setFeriasPendentes([]);
    }
  };

  const fetchPendingTimeEdits = async () => {
    try {
      const response = await apiFetch(`/timetracking/pending-time-edits`, {
        method: "POST",
        body: JSON.stringify({ uid: userName }),
      });

      if (response.ok) {
        const data = await response.json();
        setPendingTimeEdits(data.pendentes || []);
      } else {
        setPendingTimeEdits([]);
      }
    } catch (err) {
      setPendingTimeEdits([]);
    }
  };

  const fetchHorasExtraPendentes = async () => {
    // A rota é só para GestorRH/SuperAdmin (requireAdminOrHR) - um Administrador não
    // aprova horas extra, por isso nem pede a lista.
    if (!isAdminOrHR) {
      setHorasExtraPendentes([]);
      return;
    }
    try {
      const response = await apiFetch(`/timetracking/pending-manual-overtime`, {
        method: "POST",
        body: JSON.stringify({ uid: userName }),
      });
      if (response.ok) {
        const data = await response.json();
        setHorasExtraPendentes(data.pendentes || []);
      } else {
        setHorasExtraPendentes([]);
      }
    } catch (err) {
      setHorasExtraPendentes([]);
    }
  };

  const fetchCompensacoesPendentes = async () => {
    // Tal como as horas extra: rota só para GestorRH/SuperAdmin (requireAdminOrHR).
    if (!isAdminOrHR) {
      setCompensacoesPendentes([]);
      return;
    }
    try {
      const response = await apiFetch(`/timetracking/pending-compensations`, {
        method: "POST",
        body: JSON.stringify({ uid: userName }),
      });
      if (response.ok) {
        const data = await response.json();
        setCompensacoesPendentes(data.pendentes || []);
      } else {
        setCompensacoesPendentes([]);
      }
    } catch (err) {
      setCompensacoesPendentes([]);
    }
  };

  const decidirCompensacao = async (pedido, aprovar) => {
    let motivoRejeicao;
    if (!aprovar) {
      motivoRejeicao = window.prompt("Motivo da rejeição (opcional):", "");
      if (motivoRejeicao === null) return;
    }
    try {
      const response = await apiFetch(`/timetracking/${aprovar ? "approve" : "reject"}-compensation`, {
        method: "POST",
        body: JSON.stringify({ uid: userName, pedidoId: pedido.id, motivoRejeicao }),
      });
      if (response.ok) {
        await fetchCompensacoesPendentes();
        // Coluna "Compensação Horas" e saldo anual (só as aprovadas consomem saldo).
        setTabelaReloadTick((k) => k + 1);
        await fetchTotaisAnuais();
      } else {
        const data = await response.json().catch(() => ({}));
        alert(data.error || `Erro ao ${aprovar ? "aprovar" : "rejeitar"} compensação.`);
      }
    } catch (err) {
      console.error(`Erro ao ${aprovar ? "aprovar" : "rejeitar"} compensação:`, err);
      alert(`Erro ao ${aprovar ? "aprovar" : "rejeitar"} compensação.`);
    }
  };

  const decidirHoraExtra = async (horaExtra, aprovar) => {
    let motivoRejeicao;
    if (!aprovar) {
      // Motivo opcional - cancelar o prompt cancela a rejeição.
      motivoRejeicao = window.prompt("Motivo da rejeição (opcional):", "");
      if (motivoRejeicao === null) return;
    }
    try {
      const response = await apiFetch(`/timetracking/${aprovar ? "approve" : "reject"}-manual-overtime`, {
        method: "POST",
        body: JSON.stringify({ uid: userName, overtimeId: horaExtra.id, motivoRejeicao }),
      });
      if (response.ok) {
        await fetchHorasExtraPendentes();
        // Estado na coluna "Horas Extra" e saldo anual (só conta as aprovadas).
        setTabelaReloadTick((k) => k + 1);
        await fetchTotaisAnuais();
      } else {
        const data = await response.json().catch(() => ({}));
        alert(data.error || `Erro ao ${aprovar ? "aprovar" : "rejeitar"} hora extra.`);
      }
    } catch (err) {
      console.error(`Erro ao ${aprovar ? "aprovar" : "rejeitar"} hora extra:`, err);
      alert(`Erro ao ${aprovar ? "aprovar" : "rejeitar"} hora extra.`);
    }
  };

  const fetchBaixasPendentes = async () => {
    try {
      const response = await apiFetch(`/timetracking/pending-medical-leaves`, {
        method: "POST",
        body: JSON.stringify({ uid: userName }),
      });

      if (response.ok) {
        const data = await response.json();
        setBaixasPendentes(data.baixasPendentes || []);
      } else {
        setBaixasPendentes([]);
      }
    } catch (err) {
      setBaixasPendentes([]);
    }
  };

  const fetchDeslocacoesPendentes = async () => {
    try {
      const response = await apiFetch(`/deslocacoes/pending`, {
        method: "POST",
        body: JSON.stringify({ uid: userName }),
      });

      if (response.ok) {
        const data = await response.json();
        setDeslocacoesPendentes(data.pendentes || []);
      } else {
        setDeslocacoesPendentes([]);
      }
    } catch (err) {
      setDeslocacoesPendentes([]);
    }
  };

  const fetchFechoMensal = async () => {
    if (!selectedMonth) {
      setFechoMensal(null);
      return;
    }
    try {
      const mes = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}`;
      const response = await apiFetch(`/fecho-mensal/status`, {
        method: "POST",
        body: JSON.stringify({ uid: userName, mes }),
      });

      if (response.ok) {
        setFechoMensal(await response.json());
      } else {
        setFechoMensal(null);
      }
    } catch (err) {
      console.error("Erro ao buscar fecho mensal:", err);
      setFechoMensal(null);
    }
  };

  useEffect(() => {
    fetchFechoMensal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userName, selectedMonth, selectedYear]);

  const fetchTotaisAnuais = async () => {
    try {
      // Saldo anual de horas extra (/overtime-balance - só o saldo, sem ler todos os
      // Registos do ano como /overtime-summary; ver getOvertimeBalance)
      const overtimeResponse = await apiFetch(`/timetracking/overtime-balance`, {
        method: "POST",
        body: JSON.stringify({ uid: userName, year: selectedYear }),
      });

      let totalExtras = "0h 0m";

      if (overtimeResponse.ok) {
        const overtimeData = await overtimeResponse.json();
        // DEBUG horas extra
        // Saldo líquido (bruto menos o já usado a compensar dias curtos), o mesmo
        // valor que o colaborador vê em "Horas Extra (ano)" na totalSummary.jsx.
        totalExtras = overtimeData.totalNetOvertimeHours || "0h 0m";
        setSaldoHorasExtra(overtimeData.totalNetOvertimeMinutes ?? 0);
      }

      // Buscar dados de férias, faltas e baixas médicas do ano todo
      const yearlyResponse = await apiFetch(`/timetracking/yearly-summary`, {
        method: "POST",
        body: JSON.stringify({ uid: userName, year: selectedYear }),
      });

      let diasFalta = 0;
      let diasFerias = 0;
      let diasBaixaMedica = 0;

      if (yearlyResponse.ok) {
        const yearlyData = await yearlyResponse.json();
        diasFalta = yearlyData.diasFalta || 0;
        diasFerias = yearlyData.diasFerias || 0;
        diasBaixaMedica = yearlyData.diasBaixaMedica || 0;

      }

      const totaisAnuais = {
        totalExtras,
        diasFalta,
        diasFerias,
        diasBaixaMedica,
      };

      setTotaisAnuais(totaisAnuais);
    } catch (err) {
      console.error("Erro ao buscar totais anuais:", err);
    }
  };

  const handleApproveVacation = async (date) => {
    try {
      const response = await apiFetch(`/timetracking/approve-vacation`, {
        method: "POST",
        body: JSON.stringify({ uid: userName, date }),
      });

      if (response.ok) {
        // Só recarrega a lista de pendentes - "Totais anuais" (yearly-summary +
        // overtime-balance) é caro de recalcular (percorre o ano inteiro) só para
        // refletir 1 dia aprovado; fica atualizado no próximo carregamento completo
        // da página (troca de ano/colaborador), tal como aceite na auditoria de leituras.
        await fetchFeriasPendentes(); // Recarregar a lista
      } else {
      }
    } catch (err) {
      console.error("Erro ao aprovar férias:", err);
      alert("Erro ao aprovar férias.");
    }
  };

  const handleRejectVacation = async (date) => {
    try {
      const response = await apiFetch(`/timetracking/reject-vacation`, {
        method: "POST",
        body: JSON.stringify({ uid: userName, date }),
      });

      if (response.ok) {
        // Ver nota em handleApproveVacation sobre não recalcular totais anuais aqui.
        await fetchFeriasPendentes();
        alert("Férias rejeitadas com sucesso!");
      } else {
        alert("Erro ao rejeitar férias.");
      }
    } catch (err) {
      console.error("Erro ao rejeitar férias:", err);
      alert("Erro ao rejeitar férias.");
    }
  };


  const handleApproveTimeEdit = async (date) => {
    try {
      const response = await apiFetch(`/timetracking/approve-time-edit`, {
        method: "POST",
        body: JSON.stringify({ uid: userName, date }),
      });

      if (response.ok) {
        // Ver nota em handleApproveVacation sobre não recalcular totais anuais aqui.
        await fetchPendingTimeEdits();
      } else {
        alert("Erro ao aprovar alteração de horas.");
      }
    } catch (err) {
      console.error("Erro ao aprovar alteração de horas:", err);
      alert("Erro ao aprovar alteração de horas.");
    }
  };

  const handleRejectTimeEdit = async (date) => {
    try {
      const response = await apiFetch(`/timetracking/reject-time-edit`, {
        method: "POST",
        body: JSON.stringify({ uid: userName, date }),
      });

      if (response.ok) {
        await fetchPendingTimeEdits();
        alert("Pedido de alteração de horas rejeitado.");
      } else {
        alert("Erro ao rejeitar alteração de horas.");
      }
    } catch (err) {
      console.error("Erro ao rejeitar alteração de horas:", err);
      alert("Erro ao rejeitar alteração de horas.");
    }
  };

  const handleApproveBaixa = async (pedido) => {
    try {
      const response = await apiFetch(`/timetracking/approve-medical-leave`, {
        method: "POST",
        body: JSON.stringify({ uid: userName, requestId: pedido.requestId, date: pedido.requestId ? undefined : pedido.dates[0] }),
      });

      if (response.ok) {
        // Ver nota em handleApproveVacation sobre não recalcular totais anuais aqui.
        await fetchBaixasPendentes();
      } else {
        alert("Erro ao aprovar baixa médica.");
      }
    } catch (err) {
      console.error("Erro ao aprovar baixa médica:", err);
      alert("Erro ao aprovar baixa médica.");
    }
  };

  const handleRejectBaixa = async (pedido) => {
    try {
      const response = await apiFetch(`/timetracking/reject-medical-leave`, {
        method: "POST",
        body: JSON.stringify({ uid: userName, requestId: pedido.requestId, date: pedido.requestId ? undefined : pedido.dates[0] }),
      });

      if (response.ok) {
        // Ver nota em handleApproveVacation sobre não recalcular totais anuais aqui.
        await fetchBaixasPendentes();
        alert("Pedido de baixa médica rejeitado.");
      } else {
        alert("Erro ao rejeitar baixa médica.");
      }
    } catch (err) {
      console.error("Erro ao rejeitar baixa médica:", err);
      alert("Erro ao rejeitar baixa médica.");
    }
  };

  const handleApproveDeslocacao = async (deslocacao) => {
    try {
      const response = await apiFetch(`/deslocacoes/approve`, {
        method: "POST",
        body: JSON.stringify({ uid: userName, id: deslocacao.id }),
      });

      if (response.ok) {
        // Ver nota em handleApproveVacation sobre não recalcular totais anuais aqui.
        await fetchDeslocacoesPendentes();
      } else {
        alert("Erro ao aprovar deslocação.");
      }
    } catch (err) {
      console.error("Erro ao aprovar deslocação:", err);
      alert("Erro ao aprovar deslocação.");
    }
  };

  const handleRejectDeslocacao = async (deslocacao) => {
    try {
      const response = await apiFetch(`/deslocacoes/reject`, {
        method: "POST",
        body: JSON.stringify({ uid: userName, id: deslocacao.id }),
      });

      if (response.ok) {
        await fetchDeslocacoesPendentes();
        alert("Deslocação rejeitada com sucesso.");
      } else {
        alert("Erro ao rejeitar deslocação.");
      }
    } catch (err) {
      console.error("Erro ao rejeitar deslocação:", err);
      alert("Erro ao rejeitar deslocação.");
    }
  };

  const handleConfirmFechoMensal = async () => {
    if (!selectedMonth) return;
    const mes = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}`;
    try {
      const response = await apiFetch(`/fecho-mensal/confirm`, {
        method: "POST",
        body: JSON.stringify({ uid: userName, mes }),
      });

      const data = await response.json();
      if (response.ok) {
        await fetchFechoMensal();
        await fetchTotaisAnuais();
      } else {
        alert(data.error || "Erro ao confirmar o fecho do mês.");
      }
    } catch (err) {
      console.error("Erro ao confirmar fecho mensal:", err);
      alert("Erro ao confirmar o fecho do mês.");
    }
  };

  const handleShowTimeLine = () => {
    setShowMonths(true);
  };

  const handleDeleteClick = async () => {
    const confirmDelete = window.confirm("Tem a certeza que deseja apagar este colaborador? Esta ação não pode ser desfeita.");

    if (!confirmDelete) {
      return; // Se o colaborador cancelar, interrompe a execução
    }

    try {
      const response = await apiFetch(`/timetracking/deleteUser`, {
        method: "POST",
        body: JSON.stringify({ uid: userName }),
      });

      if (!response.ok) {
        const errorMessage = await response.text();
        throw new Error(errorMessage || "Erro ao apagar user");
      }

      navigate(-1);
    } catch (err) {
    }
  };

  const handleSelectMonth = (month) => {
    setSelectedMonth(month);
  };

  const handleYearChange = (year) => {
    setSelectedYear(year);
    setSelectedMonth(null); // Reset month when year changes
    setTotais(null); // Reset totals
  };

  const handleEditClick = () => {
    setEntidadesGeridasSelecionadas(userDetails?.entidadesGeridasNomes || []);
    setIsEditing(true);
  };

  const handleCancelClick = () => {
    setIsEditing(false);
    setEditedData(userDetails);
    setEntidadesGeridasSelecionadas(userDetails?.entidadesGeridasNomes || []);
  };

  const toggleEntidadeGerida = (nome) => {
    setEntidadesGeridasSelecionadas((prev) => (
      prev.includes(nome) ? prev.filter((n) => n !== nome) : [...prev, nome]
    ));
  };

  const handleInputChange = (e) => {
    setEditedData({ ...editedData, [e.target.name]: e.target.value });
  };

  const normalizeName = (name) => {
    if (!name) return ""; // Retorna uma string vazia se o nome for undefined ou null
    return name
      .trim()
      .replace(/\s+/g, "-") // Substitui espaços por "-"
      .replace(/[^a-zA-Z0-9-]/g, ""); // Remove caracteres inválidos
  };


  const handleSubmitClick = async () => {
    try {
      // Criar uma cópia dos dados editados e substituir "&" por "e" em todas as strings
      const sanitizedData = { ...editedData };

      console.log("🔍 Dados originais antes da sanitização:", editedData);

      // Substituir "&" por "e" em todos os campos string
      Object.keys(sanitizedData).forEach(key => {
        if (typeof sanitizedData[key] === 'string') {
          const originalValue = sanitizedData[key];
          sanitizedData[key] = sanitizedData[key].replace(/&/g, 'e');

          // Log apenas se houve mudança
          if (originalValue !== sanitizedData[key]) {
            console.log(`🔄 Campo "${key}": "${originalValue}" → "${sanitizedData[key]}"`);
          }
        }
      });

      console.log("✅ Dados sanitizados que serão enviados:", sanitizedData);

      delete sanitizedData.entidadesGeridasNomes;

      const dataToSend = {
        ...sanitizedData,
        uid: userDetails?.uid || localStorage.getItem("selectedUserUID"),
      };

      // "entidadesGeridas" só é enviado quando é mesmo suposto ser alterado (SuperAdmin a
      // editar um Administrador) - o backend recusa este campo vindo de quem não é
      // SuperAdmin, e não faz sentido para quem não é Administrador.
      if (isSuperAdmin && editedData?.nivelAcesso === "Administrador") {
        dataToSend.entidadesGeridas = entidadesGeridasSelecionadas;
      }


      const response = await apiFetch(`/timetracking/updateUserDetails`, {
        method: "POST",
        body: JSON.stringify(dataToSend),
      });

      if (!response.ok) throw new Error("Erro ao atualizar user");

      const updatedData = await response.json();
      setIsEditing(false);
      setUserDetails(updatedData);

      // Atualiza o localStorage com o novo nome do colaborador
      localStorage.setItem("selectedUserUID", updatedData.uid);

      // Verifica se o nome ou entidade mudou
      if (updatedData.nome !== userDetails.nome || updatedData.entidade !== userDetails.entidade) {
        const normalizedEntityName = normalizeName(updatedData.entidade);
        navigate(`/ponto/entidades/${normalizedEntityName}`);
      } else {
        window.location.reload();
      }
    } catch (err) {
      console.error("Erro ao atualizar os dados do colaborador:", err.message);
      setError(err.message);
    }
  };


const handleTotaisChange = (novosTotais) => {
  setTotais(novosTotais);
};

const handleDadosChange = (novosDados) => {
  setDados(novosDados); // Atualiza os dados no estado
  // Recarregar férias, baixas médicas e pedidos de alteração de horas pendentes
  // quando os dados mudarem
  fetchFeriasPendentes();
  fetchPendingTimeEdits();
  fetchBaixasPendentes();
  fetchHorasExtraPendentes();
  fetchCompensacoesPendentes();
};

// Normalizar entidade para URL (usar no breadcrumb)
const normalizedEntityUrl = userDetails?.entidade
  ? userDetails.entidade
      .toLowerCase()
      .normalize('NFD')
      .replace(new RegExp("[\\u0300-\\u036f]", "g"), '')
      .replace(/&/g, 'e')
      .replace(/-/g, ' ')
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
  : '';

  if (!username) {
    return <LoadingSpinner />;
  }

  const selectStyle = { ...inputStyle, cursor: "pointer" };

  return (
    <div className="flex min-h-screen">
      <Sidebar onSelectFile={handleSelectFile} />

      <div className="ml-[var(--sidebar-w,230px)] transition-[margin-left] duration-200 flex-1 min-w-0 flex flex-col min-h-screen">
        <Topbar icon="👤" title="Colaborador" />

        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
          {loading ? (
            <div style={{ ...cardStyle, padding: 40, textAlign: "center" }}>
              <p style={{ color: "#9ca3af", fontSize: 13, margin: 0 }}>A carregar colaborador...</p>
            </div>
          ) : error ? (
            <div style={{ ...cardStyle, padding: "18px 24px" }}>
              <p style={{ color: "#E86F51", fontWeight: 500, fontSize: 13, margin: 0 }}>⚠ Erro: {error.message}</p>
            </div>
          ) : !showDetails ? null : (
            <div className="flex flex-col lg:flex-row gap-5" style={{ minHeight: "calc(100vh - 102px)" }}>
              <div className="flex-1 flex flex-col gap-5 min-w-0">
                <div style={cardStyle}>
                  <div style={{ ...cardHeaderStyle, gap: 12 }}>
                    <FaUser style={{ color: GOLD, fontSize: 13, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#111827", flex: 1, minWidth: 0, textTransform: "capitalize" }} className="truncate">
                      <Link to="/ponto/entidades" style={{ color: "#9ca3af", textDecoration: "none", fontWeight: 500 }}>Entidades</Link>
                      <span style={{ color: "#d1d5db", margin: "0 6px" }}>/</span>
                      <Link to={`/ponto/entidades/${normalizedEntityUrl}`} style={{ color: "#9ca3af", textDecoration: "none", fontWeight: 500 }}>
                        {userDetails?.entidade}
                      </Link>
                      <span style={{ color: "#d1d5db", margin: "0 6px" }}>/</span>
                      {userDetails?.nome || "N/A"}
                    </span>

                    {!isEditing && (
                      <button style={btnOutline(GOLD)} onClick={handleEditClick}>Editar</button>
                    )}
                  </div>

                  <div style={{ padding: 18 }}>
                    {isEditing ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                        <div>
                          <span style={labelStyle}>Nome</span>
                          <input type="text" name="nome" style={inputStyle} value={editedData?.nome || ""} onChange={handleInputChange} />
                        </div>
                        <div>
                          <span style={labelStyle}>Email</span>
                          <input type="email" name="email" style={inputStyle} value={editedData?.email || ""} onChange={handleInputChange} />
                        </div>
                        <div>
                          <span style={labelStyle}>Entidade</span>
                          <AutocompleteInput
                            value={editedData?.entidade || ""}
                            onChange={(v) => setEditedData({ ...editedData, entidade: v })}
                            options={entidadesOptions}
                            inputStyle={{ ...inputStyle, ...((isAdministrador && !isMultiEntidadeAdministrador) ? { cursor: "not-allowed", opacity: 0.7 } : {}) }}
                            disabled={isAdministrador && !isMultiEntidadeAdministrador}
                          />
                        </div>
                        <div>
                          <span style={labelStyle}>Função</span>
                          <AutocompleteInput
                            value={editedData?.role || ""}
                            onChange={(v) => setEditedData({ ...editedData, role: v })}
                            options={FUNCAO}
                            inputStyle={inputStyle}
                          />
                        </div>
                        <div>
                          <span style={labelStyle}>Nível de acesso</span>
                          {nivelAcessoBloqueado ? (
                            <div style={{ ...valueStyle, ...inputStyle, cursor: "not-allowed", opacity: 0.7 }}>
                              {editedData?.nivelAcesso || "Colaborador"}
                              <span style={{ display: "block", fontSize: 10.5, color: "#9ca3af", fontWeight: 400, marginTop: 2 }}>
                                {isEditingSelf
                                  ? "Não podes alterar o teu próprio nível de acesso."
                                  : targetIsAdministrador
                                    ? "Só um SuperAdmin pode alterar o nível de acesso de um Administrador."
                                    : "Só um SuperAdmin pode alterar o nível de acesso de outro Gestor(a) de RH."}
                              </span>
                            </div>
                          ) : (
                            <select name="nivelAcesso" style={selectStyle} value={editedData?.nivelAcesso || "Colaborador"} onChange={handleInputChange}>
                              <option value="Colaborador">Colaborador</option>
                              {/* GestorRH pode atribuir GestorFinanceiro (área diferente da sua) mas nunca
                                  Administrador (só o SuperAdmin promove a esse nível) - ver
                                  normalizeNivelAcessoForActor em userManagementController.js. */}
                              {isSuperAdmin && <option value="Administrador">Administrador</option>}
                              {isGestorRH && <option value="GestorFinanceiro">Gestor(a) Financeiro</option>}
                              {isSuperAdmin && <option value="GestorRH">Gestor(a) de Recursos Humanos</option>}
                              {isSuperAdmin && <option value="GestorFinanceiro">Gestor(a) Financeiro</option>}
                              {isSuperAdmin && <option value="SuperAdmin">SuperAdmin</option>}
                            </select>
                          )}
                        </div>
                        <div>
                          <span style={labelStyle}>Gestor(a) de Qualidade</span>
                          {isSuperAdmin ? (
                            <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "#374151", cursor: "pointer", marginTop: 2 }}>
                              <input
                                type="checkbox"
                                checked={editedData?.gestorQualidade === true}
                                onChange={(e) => setEditedData({ ...editedData, gestorQualidade: e.target.checked })}
                              />
                              É Gestor(a) de Qualidade (acumula com o nível de acesso acima, dá acesso a todas as Não Conformidades)
                            </label>
                          ) : (
                            <div style={{ ...valueStyle, ...inputStyle, cursor: "not-allowed", opacity: 0.7 }}>
                              {editedData?.gestorQualidade ? "Sim" : "Não"}
                              <span style={{ display: "block", fontSize: 10.5, color: "#9ca3af", fontWeight: 400, marginTop: 2 }}>
                                Só um SuperAdmin pode atribuir/remover esta função.
                              </span>
                            </div>
                          )}
                        </div>
                        {isSuperAdmin && editedData?.nivelAcesso === "Administrador" && (
                          <div>
                            <span style={labelStyle}>Entidades adicionais que também gere</span>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 160, overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: 6, padding: 10, background: "#fafafa" }}>
                              {entidadesOptions.filter((nome) => nome !== editedData?.entidade).length === 0 && (
                                <span style={{ fontSize: 12, color: "#9ca3af" }}>Não há outras entidades registadas.</span>
                              )}
                              {entidadesOptions.filter((nome) => nome !== editedData?.entidade).map((nome) => (
                                <label key={nome} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "#374151", cursor: "pointer" }}>
                                  <input
                                    type="checkbox"
                                    checked={entidadesGeridasSelecionadas.includes(nome)}
                                    onChange={() => toggleEntidadeGerida(nome)}
                                  />
                                  {nome}
                                </label>
                              ))}
                            </div>
                            <span style={{ fontSize: 10.5, color: "#9ca3af", marginTop: 4, display: "block" }}>
                              Além da entidade principal acima, este Administrador também vê e gere os colaboradores destas entidades.
                            </span>
                          </div>
                        )}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4, paddingTop: 14, borderTop: "1px solid #f3f4f6" }}>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button style={btnSolid} onClick={handleSubmitClick}>Submeter</button>
                            <button style={btnGhost} onClick={handleCancelClick}>Cancelar</button>
                          </div>
                          <button style={btnOutline("#E86F51")} onClick={handleDeleteClick}>Apagar Utilizador</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
                        <div>
                          <span style={labelStyle}>Nome</span>
                          <div style={valueStyle}>{userDetails.nome || "N/A"}</div>
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <span style={labelStyle}>Email</span>
                          <div style={{ ...valueStyle }} className="truncate">{userDetails.email || "N/A"}</div>
                        </div>
                        <div>
                          <span style={labelStyle}>Entidade</span>
                          <div style={valueStyle}>{userDetails.entidade || "N/A"}</div>
                        </div>
                        <div>
                          <span style={labelStyle}>Função</span>
                          <div style={valueStyle}>{userDetails.role || "N/A"}</div>
                        </div>
                        <div>
                          <span style={labelStyle}>Nível de acesso</span>
                          <div style={valueStyle}>{userDetails.nivelAcesso || "Colaborador"}</div>
                        </div>
                        <div>
                          <span style={labelStyle}>Gestor(a) de Qualidade</span>
                          <div style={valueStyle}>{userDetails.gestorQualidade ? "Sim" : "Não"}</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ ...cardStyle, flex: 1, display: "flex", flexDirection: "column" }}>
                  <div style={cardHeaderStyle}>
                    <FaCalendarDays style={{ color: GOLD, fontSize: 13 }} />
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>Consultar Assiduidade</span>
                      <div style={{ fontSize: 11.5, color: "#9ca3af", marginTop: 1 }}>Selecione o ano e o mês</div>
                    </div>
                  </div>

                  <div style={{ padding: 18, flex: 1, display: "flex", flexDirection: "column" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12, flexShrink: 0 }} className="sm:flex-row">
                      <select
                        style={{ ...selectStyle, maxWidth: 160 }}
                        onChange={(e) => handleYearChange(parseInt(e.target.value, 10))}
                        value={selectedYear}
                      >
                        <option value={2025}>2025</option>
                        <option value={2026}>2026</option>
                      </select>

                      <select
                        style={selectStyle}
                        onChange={(e) => handleSelectMonth(parseInt(e.target.value, 10))}
                        value={selectedMonth || ""}
                      >
                        <option value="" disabled>-- Selecione um Mês --</option>
                        {[
                          "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
                          "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
                        ].map((month, index) => (
                          <option key={index} value={index + 1}>{month}</option>
                        ))}
                      </select>
                    </div>

                    {selectedMonth ? (
                      <div style={{ marginTop: 16, borderRadius: 8, border: "1px solid #f3f4f6", overflow: "hidden" }}>
                        <TableHours username={userName} month={selectedMonth} year={selectedYear} onTotaisChange={handleTotaisChange} onDadosChange={handleDadosChange} saldoHorasExtra={saldoHorasExtra} onCompensated={fetchTotaisAnuais} reloadTick={tabelaReloadTick} />
                      </div>
                    ) : (
                      <div style={{ flex: 1, minHeight: 120, display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af", fontSize: 13 }}>
                        Selecione um mês para consultar os registos de assiduidade.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="w-full lg:w-[320px] flex-shrink-0">
                <UserStats
                  totaisAnuais={totaisAnuais}
                  selectedMonth={selectedMonth}
                  selectedYear={selectedYear}
                  totais={totais}
                  feriasPendentes={feriasPendentes}
                  pendingTimeEdits={pendingTimeEdits}
                  baixasPendentes={baixasPendentes}
                  horasExtraPendentes={horasExtraPendentes}
                  // Ninguém aprova a própria hora extra (o backend também o impede).
                  podeDecidirHorasExtra={isAdminOrHR && userName !== actorUid}
                  handleApproveHoraExtra={(h) => decidirHoraExtra(h, true)}
                  handleRejectHoraExtra={(h) => decidirHoraExtra(h, false)}
                  compensacoesPendentes={compensacoesPendentes}
                  handleApproveCompensacao={(p) => decidirCompensacao(p, true)}
                  handleRejectCompensacao={(p) => decidirCompensacao(p, false)}
                  deslocacoesPendentes={deslocacoesPendentes}
                  userName={userDetails?.nome}
                  dados={dados}
                  handleApproveVacation={handleApproveVacation}
                  handleRejectVacation={handleRejectVacation}
                  handleApproveTimeEdit={handleApproveTimeEdit}
                  handleRejectTimeEdit={handleRejectTimeEdit}
                  handleApproveBaixa={handleApproveBaixa}
                  handleRejectBaixa={handleRejectBaixa}
                  handleApproveDeslocacao={handleApproveDeslocacao}
                  handleRejectDeslocacao={handleRejectDeslocacao}
                  fechoMensal={fechoMensal}
                  handleConfirmFechoMensal={handleConfirmFechoMensal}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default UserDetails;
