import React, { useState, useEffect, useCallback } from 'react';
import { FaStopwatch, FaChartColumn } from 'react-icons/fa6';
import { formatarMinutos } from '../../utils/calcHours';
import { minutosHorasExtraAprovadas } from '../../utils/horasExtra';
import { getHolidaysForSede } from '../../../../shared/utils/holidays';
import { isBlocoAtivoEm, isDiaForaDeAtivo } from '../../../../shared/utils/absenceBlocks';
import ManualOvertimeButton from './manualOvertime';
import TimeTrackingTable from './pontoTable';
import RequestTimeEditButton from './requestTimeEditButton';
import MonthlyClosingButton from './monthlyClosingButton';
import MedicalLeave from '../Shared/medicalLeave';
import { apiFetch } from '../../../../shared/utils/apiFetch';

const MONTH_NAMES_FULL = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

// calendarData/calendarLoading (opcionais): quando vêm do pai (RegistosPage.jsx), os
// "Totais" do mês não fazem o seu próprio POST /timetracking/calendar - antes disso,
// esta e a pontoTable.jsx pediam os mesmos dados (mesmo username/mês/ano) de forma
// independente, duplicando a leitura mais cara da página. O saldo anual de horas
// extra (2º useEffect) e o resumo anual/modal continuam à parte, sem alteração.
// overtimeReloadTick (opcional): sinal próprio para recarregar o saldo anual de horas
// extra, separado de reloadTick porque nem todas as recargas o alteram (ex.: uma
// entrada num dia sem registo - ver handleEntryRegistered em RegistosPage.jsx). Sem
// esta prop, o saldo segue reloadTick como antes.
const TotaisSummary = ({ username, month = new Date().getMonth() + 1, reloadTick = 0, overtimeReloadTick, calendarData, calendarLoading = false, onSaldoChange }) => {
  const [totais, setTotais] = useState({
    totalExtras: "0h 0m",
    diasFalta: 0,
    diasFerias: 0,
    diasAniversario: 0,
  });
  const [accumulatedExtras, setAccumulatedExtras] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showYearlyModal, setShowYearlyModal] = useState(false);
  const [yearlyData, setYearlyData] = useState([]);
  const [loadingYearly, setLoadingYearly] = useState(false);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [showOvertimeModal, setShowOvertimeModal] = useState(false);
  const [expandedMonth, setExpandedMonth] = useState(null);
  // Estado do fecho deste mês (POST /fecho-mensal/status), pedido uma única vez aqui e
  // partilhado com o MonthlyClosingButton abaixo - antes cada um fazia o seu próprio
  // pedido, com o mesmo mês, e cada pedido recalcula no backend o resumo do mês inteiro.
  const [fechoStatus, setFechoStatus] = useState(null);
  const [fechoStatusLoading, setFechoStatusLoading] = useState(true);
  const mesAtual = `${new Date().getFullYear()}-${String(month).padStart(2, '0')}`;

  // "Pedir Baixa Médica" (tal como "Fecho Mensal" logo abaixo) desaparece quando o
  // próprio já confirmou o fecho deste mês - o backend já recusa o pedido nesse caso
  // (ver isMonthClosed em createMedicalLeave), isto só evita mostrar um botão que iria
  // falhar. Não se aplica a MedicalLeave usado em nome de outro colaborador (Admin/
  // pontoTable.jsx, contextMenu.jsx) - aí continua sempre visível, como correção.
  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    setFechoStatusLoading(true);
    apiFetch('/fecho-mensal/status', {
      method: 'POST',
      body: JSON.stringify({ mes: mesAtual }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled) setFechoStatus(data); })
      .catch(() => { if (!cancelled) setFechoStatus(null); })
      .finally(() => { if (!cancelled) setFechoStatusLoading(false); });
    return () => { cancelled = true; };
  }, [username, mesAtual]);
  const mesFechado = !!fechoStatus?.confirmed;

  // Função para extrair apenas a hora no formato HH:MM
  const extractTime = (timeString) => {
    if (!timeString || timeString === "-") return null;
    // Se tem espaço, é formato YYYY-MM-DD HH:MM, pega a parte após o espaço
    if (timeString.includes(' ')) {
      return timeString.split(' ')[1];
    }
    // Se já é só HH:MM, retorna como está
    return timeString;
  };

  const processMonthData = useCallback((data) => {
        const currentYear = new Date().getFullYear();
        const registos = data.registos || [];
        const ferias = data.ferias || [];
        const baixas = data.baixas || [];
        const aniversario = data.aniversario || [];
        const manualOvertime = data.manualOvertime || [];
        const licencasOuBaixasCadastro = data.licencasOuBaixasCadastro || [];
        const situacaoContratual = data.situacaoContratual || "Ativo";
        const dataFimContrato = data.dataFimContrato || null;

        const allHolidays = getHolidaysForSede(data.sede, currentYear);
        const parseDDMM = (d) => (d && d.length >= 5 && d[2] === '-') ? d.slice(0, 5) : d;
        const feriasSet = new Set(ferias.filter(f => f.approved).map(f => parseDDMM(f.date || '')));
        const baixasSet = new Set(baixas.filter(b => b.approved).map(b => parseDDMM(b.date || '')));
        const aniversarioSet = new Set(aniversario.filter(a => a.approved).map(a => parseDDMM(a.date || '')));

        // Calcular totais
        let totalMinutosExtras = 0;
        let diasFalta = 0;

        const diasNoMes = new Date(currentYear, month, 0).getDate();
        const hoje = new Date();

        for (let i = 0; i < diasNoMes; i++) {
          const dataAtual = new Date(currentYear, month - 1, i + 1);
          const diaSemana = dataAtual.getDay();
          const dayStr = `${String(i + 1).padStart(2, '0')}-${String(month).padStart(2, '0')}`;
          const registo = registos.find((r) => new Date(r.timestamp).getDate() === i + 1);
          const isHoliday = allHolidays.includes(dayStr);
          const isFerias = feriasSet.has(dayStr);
          const isBaixa = baixasSet.has(dayStr);
          const isAniversario = aniversarioSet.has(dayStr);
          const isPast = dataAtual < hoje && dataAtual.toDateString() !== hoje.toDateString();
          const isWorkday = diaSemana >= 1 && diaSemana <= 5;

          // Licença/baixa médica (do Cadastro) ou contrato já não ativo (cessado/suspenso/
          // reformado)  -  também não devem contar como falta. A cedência temporária não
          // entra aqui: o colaborador cedido continua a bater o ponto (ver pontoTable.jsx).
          const dataIso = `${currentYear}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
          const isLicencaOuBaixaCadastro = licencasOuBaixasCadastro.some((b) => isBlocoAtivoEm(b, dataIso));
          const isForaDeAtivo = isDiaForaDeAtivo(situacaoContratual, dataFimContrato, dataIso);

          if (isPast && isWorkday && !isHoliday && !isFerias && !isBaixa && !isAniversario && !isLicencaOuBaixaCadastro && !isForaDeAtivo && !registo) {
            diasFalta++;
          }
        }

        // Adicionar horas extras manuais ao total - só as aprovadas pela GestorRH
        totalMinutosExtras += minutosHorasExtraAprovadas(manualOvertime);

        // Bruto: o mensal já não é reduzido pelas faltas do dia  -  ver
        // CompensateOvertimeButton, que desconta o défice do saldo anual em vez
        // do mensal.
        setTotais({
          totalExtras: formatarMinutos(totalMinutosExtras),
          diasFalta,
          diasFerias: ferias.filter(f => f.approved).length,
          diasAniversario: aniversario.filter(a => a.approved).length,
        });
  }, [month]);

  // hasExternalData tem de ser "a prop foi passada" (mesmo que ainda null a
  // carregar), não "já tem dados" - ver nota igual em pontoTable.jsx.
  const hasExternalData = calendarData !== undefined;

  // Modo A: dados vêm do pai - não faz o seu próprio pedido.
  useEffect(() => {
    if (!hasExternalData) return;
    if (calendarLoading || !calendarData) { setLoading(true); return; }
    setLoading(true);
    try {
      processMonthData(calendarData);
    } catch (error) {
      console.error("Erro ao processar totais:", error);
    } finally {
      setLoading(false);
    }
  }, [hasExternalData, calendarData, calendarLoading, processMonthData]);

  // Modo B: sem dados do pai - pedido próprio (mantido por robustez/consistência com
  // pontoTable.jsx, embora hoje este componente só seja usado com calendarData vindo
  // de RegistosPage.jsx).
  useEffect(() => {
    if (hasExternalData) return;
    if (!username) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const currentYear = new Date().getFullYear();
        const response = await apiFetch(`/timetracking/calendar`, {
          method: "POST",
          body: JSON.stringify({ month, year: currentYear }),
        });
        if (!response.ok) throw new Error(`Erro HTTP: ${response.status}`);
        const data = await response.json();
        if (cancelled) return;
        processMonthData(data);
      } catch (error) {
        console.error("Erro ao buscar totais:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  // reloadTick sinaliza o pai (RegistosPage) que algo mudou (ex: entrada/saída
  // registada) - antes isto era feito remontando este componente inteiro
  // (key={refreshKey}), que também fechava o modal de resumo anual/horas extras
  // se estivesse aberto.
  }, [hasExternalData, username, month, reloadTick, processMonthData]);

  // Saldo anual de horas extra: bruto acumulado (meses nunca reduzidos por faltas)
  // menos o que já foi usado para compensar dias curtos  -  cálculo único e
  // autoritativo feito no backend (getOvertimeSummary/computeAnnualOvertimeBalance).
  const overtimeTick = overtimeReloadTick ?? reloadTick;
  useEffect(() => {
    if (!username) return;
    const currentYear = new Date().getFullYear();

    // Auto-serviço: nunca enviar "uid" aqui  -  username (UserContext) é o NOME
    // da pessoa, não o uid do Firebase; sem "uid" no corpo, o backend usa
    // sempre req.user.uid (resolveTargetUid).
    apiFetch(`/timetracking/overtime-summary`, {
      method: 'POST',
      body: JSON.stringify({ year: currentYear }),
    })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(data => {
        setAccumulatedExtras(data.totalNetOvertimeMinutes ?? 0);
        // Partilhado com a PontoTable (botão "Compensar" só aparece com saldo).
        if (onSaldoChange) onSaldoChange(data.totalNetOvertimeMinutes ?? 0);
      })
      .catch((err) => console.error("Erro ao buscar saldo anual de horas extra:", err));
  }, [username, overtimeTick]);

  const fetchYearlyData = async () => {
    if (!username) return;
    
    setLoadingYearly(true);
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();
    const isCurrentYear = selectedYear === currentYear;
    const maxMonth = isCurrentYear ? currentMonth : 12;
    
    const monthNames = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];
    
    try {
      const monthlyPromises = [];
      
      // Buscar dados de todos os meses (até o atual se for o ano corrente)
      for (let m = 1; m <= maxMonth; m++) {
        monthlyPromises.push(
          apiFetch(`/timetracking/calendar`, {
            method: "POST",
            body: JSON.stringify({ month: m, year: selectedYear }),
          }).then(res => res.json())
        );
      }
      
      const results = await Promise.all(monthlyPromises);
      
      const yearlyStats = results.map((data, index) => {
        const monthNum = index + 1;
        const registos = data.registos || [];
        const ferias = data.ferias || [];
        const manualOvertime = data.manualOvertime || [];

        let totalMinutosExtras = 0;

        // Mês com pelo menos um dia com entrada e saída - decide se aparece na tabela
        const temRegistos = registos.some(r => extractTime(r.horaEntrada) && extractTime(r.horaSaida));

        // Adicionar horas extras manuais ao total - só as aprovadas pela GestorRH
        totalMinutosExtras += minutosHorasExtraAprovadas(manualOvertime);

        // Bruto: o mensal já não é reduzido por faltas (ver CompensateOvertimeButton).
        return {
          month: monthNames[index],
          monthNum: monthNum,
          temRegistos,
          totalExtras: formatarMinutos(totalMinutosExtras),
          diasFerias: ferias.length,
        };
      });
      
      setYearlyData(yearlyStats);
    } catch (error) {
      console.error("Erro ao buscar dados anuais:", error);
    } finally {
      setLoadingYearly(false);
    }
  };

  const handleOpenYearlyModal = () => {
    setShowYearlyModal(true);
    fetchYearlyData();
  };


  const handleYearChange = (year) => {
    setSelectedYear(year);
  };

  // Recarregar dados quando o ano muda
  React.useEffect(() => {
    if (showYearlyModal) {
      fetchYearlyData();
    }
  }, [selectedYear]);
  const handleCloseYearlyModal = () => {
    setShowYearlyModal(false);
  };

  const handleOpenOvertimeModal = () => {
    setShowOvertimeModal(true);
  };

  const handleCloseOvertimeModal = () => {
    setShowOvertimeModal(false);
  };

  const handleToggleMonth = (monthNum) => {
    setExpandedMonth(expandedMonth === monthNum ? null : monthNum);
  };

  if (loading) {
    return (
      <div className="flex flex-col p-6 w-full lg:w-[280px] shrink-0 bg-[rgba(169,169,169,0.1)] rounded-lg">
        <div className="h-6 w-24 rounded-full bg-gray-300/40 animate-pulse mb-5" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-3.5 rounded-full bg-gray-300/40 animate-pulse mb-3" style={{ width: `${70 - i * 6}%`, animationDelay: `${i * 80}ms` }} />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col p-6 text-gold w-full lg:w-[280px] shrink-0 bg-[rgba(169,169,169,0.1)] rounded-lg">
        <h2 className="text-2xl font-bold mb-4">Totais</h2>
        <p className="mb-2"><strong>Horas Extra (ano):</strong> {accumulatedExtras === null ? '...' : <span className={accumulatedExtras < 0 ? 'text-danger' : ''}>{formatarMinutos(accumulatedExtras)}</span>}</p>
        <p className="mb-2"><strong>Horas Extra (mês):</strong> <span className={totais.totalExtras.startsWith('-') ? 'text-danger' : ''}>{totais.totalExtras}</span></p>
        <p className="mb-2"><strong>Faltas:</strong> {totais.diasFalta}</p>
        <p className="mb-2"><strong>Férias:</strong> {totais.diasFerias}</p>
        {/* <p className="mb-2"><strong>🎂 Aniversário:</strong> {totais.diasAniversario}</p> */}
        <button
          onClick={handleOpenYearlyModal}
          className="mt-4 cursor-pointer bg-transparent border-none text-sm font-medium flex items-center justify-center gap-1.5 text-gold"
        >
          <FaChartColumn />
          Ver resumo anual
        </button>
        <button
          onClick={handleOpenOvertimeModal}
          className="mt-2 cursor-pointer bg-transparent border-none text-sm font-medium flex items-center justify-center gap-1.5 text-gold"
        >
          <FaStopwatch />
          Registar Horas Extra
        </button>
        <RequestTimeEditButton
          triggerClassName="mt-2 cursor-pointer bg-transparent border-none text-sm font-medium flex items-center justify-center gap-1.5 text-gold"
        />
        {!mesFechado && (
          <MedicalLeave
            username={username}
            triggerClassName="mt-2 cursor-pointer bg-transparent border-none text-sm font-medium flex items-center justify-center gap-1.5 text-gold"
          />
        )}
        <MonthlyClosingButton
          mes={mesAtual}
          initialStatus={fechoStatus}
          initialStatusLoading={fechoStatusLoading}
          mesLabel={`${MONTH_NAMES_FULL[month - 1]} de ${new Date().getFullYear()}`}
          triggerClassName="mt-2 cursor-pointer bg-transparent border-none text-sm font-medium flex items-center justify-center gap-1.5 text-gold"
        />
      </div>

      {showOvertimeModal && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[2000] p-5" 
          onClick={handleCloseOvertimeModal}
        >
          <div 
            className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-y-auto relative" 
            onClick={(e) => e.stopPropagation()}
          >
            <ManualOvertimeButton username={username} onOvertimeRegistered={handleCloseOvertimeModal} isOpen={true} onClose={handleCloseOvertimeModal} />
          </div>
        </div>
      )}

      {showYearlyModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[2000] p-3 sm:p-5"
          onClick={handleCloseYearlyModal}
        >
          <div
            className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-y-auto flex flex-col p-4 sm:p-6 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-wrap justify-between items-center gap-3 mb-4 sm:mb-6">
              <h2 className="text-lg sm:text-2xl font-bold text-gold">Resumo Anual</h2>
              <div className="flex items-center gap-2 sm:gap-3">
                <button
                  onClick={() => handleYearChange(selectedYear - 1)}
                  className="px-3 py-1 text-white border-none rounded cursor-pointer text-base transition-colors bg-gold"
                >
                  ←
                </button>
                <span className="text-lg sm:text-xl font-bold min-w-[64px] sm:min-w-[80px] text-center text-gold">{selectedYear}</span>
                <button
                  onClick={() => handleYearChange(selectedYear + 1)}
                  disabled={selectedYear >= new Date().getFullYear()}
                  className="px-3 py-1 text-white border-none rounded cursor-pointer text-base transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-gold"
                >
                  →
                </button>
                <button
                  onClick={handleCloseYearlyModal}
                  className="ml-2 sm:ml-4 w-8 h-8 flex items-center justify-center text-2xl font-bold hover:bg-gray-100 rounded-full transition-colors cursor-pointer border-none bg-transparent text-danger"
                >
                  ×
                </button>
              </div>
            </div>

            {loadingYearly ? (
              <div className="text-center py-10 text-gray-500">
                A carregar dados...
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b-2 border-gray-300 bg-gold-light">
                      <th className="text-left py-3 px-2 sm:px-4 font-semibold text-gold whitespace-nowrap sticky left-0 z-10 bg-gold-light">Mês</th>
                      <th className="text-right py-3 px-2 sm:px-4 font-semibold text-gold whitespace-nowrap">Horas Extras</th>
                      <th className="text-right py-3 px-2 sm:px-4 font-semibold text-gold whitespace-nowrap">Dias de Férias</th>
                    </tr>
                  </thead>
                  <tbody>
                    {yearlyData
                      .filter(monthData => monthData.temRegistos || monthData.totalExtras !== '0h 0m')
                      .map((monthData, index) => (
                      <React.Fragment key={index}>
                        <tr
                          className="border-b border-gray-200 hover:bg-gray-50 transition-colors cursor-pointer"
                          onClick={() => handleToggleMonth(monthData.monthNum)}
                        >
                          <td className="py-3 px-2 sm:px-4 font-medium text-gray-800 whitespace-nowrap sticky left-0 z-10 bg-white">
                            <span className="flex items-center gap-2">
                              <span className="text-lg">{expandedMonth === monthData.monthNum ? '▼' : '▶'}</span>
                              {monthData.month}
                              {monthData.monthNum === month && (
                                <span className="ml-2 text-xs text-gold">(atual)</span>
                              )}
                            </span>
                          </td>
                          <td className="text-right py-3 px-2 sm:px-4 text-success whitespace-nowrap">{monthData.totalExtras}</td>
                          <td className="text-right py-3 px-2 sm:px-4 text-gray-700 whitespace-nowrap">{monthData.diasFerias}</td>
                        </tr>
                        {expandedMonth === monthData.monthNum && (
                          <tr>
                            <td colSpan="3" className="p-2 sm:p-5 bg-[#f8f9fa] border-t-2 border-[#dee2e6]">
                              <TimeTrackingTable className="overflow-x-auto" username={username} month={monthData.monthNum} year={selectedYear} />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-300 font-bold bg-gold-light">
                      <td className="py-3 px-2 sm:px-4 text-gold whitespace-nowrap sticky left-0 z-10 bg-gold-light">Total</td>
                      <td className="text-right py-3 px-2 sm:px-4 text-success whitespace-nowrap">
                        {formatarMinutos(
                          yearlyData.reduce((acc, m) => {
                            const match = m.totalExtras.match(/(\d+)h (\d+)m/);
                            if (match) {
                              return acc + parseInt(match[1]) * 60 + parseInt(match[2]);
                            }
                            return acc;
                          }, 0)
                        )}
                      </td>
                      <td className="text-right py-3 px-2 sm:px-4 text-gray-700 whitespace-nowrap">
                        {yearlyData.reduce((acc, m) => acc + m.diasFerias, 0)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default TotaisSummary;