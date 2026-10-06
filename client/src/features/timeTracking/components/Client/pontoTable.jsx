import React, { useState, useEffect, useCallback } from 'react';
import TableRow from './tableRow';
import { calcularHoras, formatarMinutos } from '../../utils/calcHours';
import { minutosHorasExtraAprovadas, podeCompensarDia } from '../../utils/horasExtra';
import CompensateOvertimeButton from '../Shared/compensateOvertimeButton';
import { usePermissions } from '../../../../shared/hooks/usePermissions';
import ContextMenu from './contextMenu';
import ManualOvertimeModal from './ManualOvertimeModal';
import { apiFetch } from '../../../../shared/utils/apiFetch';

// calendarData/calendarLoading (opcionais): quando vêm do pai (RegistosPage.jsx), esta
// tabela não faz o seu próprio POST /timetracking/calendar - antes disso, e a
// totalSummary.jsx pediam os mesmos dados (mesmo username/mês/ano) de forma
// independente, duplicando a leitura mais cara da página inteira. Quando
// calendarData é null (ex: dentro do modal de "resumo anual", onde cada mês
// expandido é um mês/ano arbitrário e diferente do da página principal), a tabela
// continua a fazer o seu próprio pedido, tal como sempre fez.
const TimeTrackingTable = ({ username, month = new Date().getMonth() + 1, year = new Date().getFullYear(), className = '', onDataChanged, reloadTick = 0, calendarData, calendarLoading = false, saldoHorasExtra }) => {
  const [dados, setDados] = useState([]);
  const [loading, setLoading] = useState(true);
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, dayIndex: null });
  // Dia escolhido em "Compensar horas" no menu de contexto (abre o modal de compensação).
  const [diaACompensar, setDiaACompensar] = useState(null);
  const { isSuperAdmin } = usePermissions();
  const [selectedDate, setSelectedDate] = useState(null);
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, content: '' });
  const [overtimeModal, setOvertimeModal] = useState({ show: false, entries: [], date: '' });

  // hasExternalData tem de ser "a prop foi passada" (mesmo que ainda null a carregar),
  // não "já tem dados" - senão, durante o carregamento inicial (calendarData ainda
  // null no pai), esta tabela cairia por engano no modo de auto-busca (Modo B).
  const hasExternalData = calendarData !== undefined;

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

  // Pedidos de alteração de horas ainda pendentes de aprovação (ver
  // requestTimeEditButton.jsx)  -  indexados por data completa "DD-MM-YYYY". Nunca é
  // partilhado com a totalSummary.jsx (só esta tabela usa isto), por isso continua
  // a ser um pedido próprio em ambos os modos.
  const fetchPendingEdits = useCallback(async () => {
    if (!username) return {};
    try {
      const ajustesResponse = await apiFetch(`/timetracking/pending-time-edits`, { method: "POST" });
      if (ajustesResponse.ok) {
        const ajustesData = await ajustesResponse.json();
        return Object.fromEntries(
          (ajustesData.pendentes || []).map((ajuste) => [ajuste.date, ajuste])
        );
      }
    } catch (err) {
      console.error("Erro ao buscar pedidos de alteração de horas pendentes:", err);
    }
    return {};
  }, [username]);

  const processCalendarData = useCallback((data, ajustesPendentesPorDia) => {
      const diasNoMes = new Date(year, month, 0).getDate();
      const registos = data.registos || [];
      const manualOvertimeData = data.manualOvertime || [];
      const compensacoesData = data.compensacoes || [];
      const ferias = data.ferias || [];
      const baixas = data.baixas || [];
      const aniversario = data.aniversario || [];

      const dadosProcessados = Array.from({ length: diasNoMes }, (_, i) => {
        const dia = `${String(i + 1).padStart(2, "0")}-${String(month).padStart(2, "0")}`;
        const diaCompleto = `${String(i + 1).padStart(2, "0")}-${String(month).padStart(2, "0")}-${year}`;
        const registo = registos.find((r) => new Date(r.timestamp).getDate() === i + 1);

        const feriaDodia = ferias.find(f => f.date === diaCompleto);
        const baixaDodia = baixas.find(b => b.date === diaCompleto);
        const aniversarioDodia = aniversario.find(a => a.date === diaCompleto);

        const manualOvertimeForDay = manualOvertimeData.filter(mo => mo.date === diaCompleto);
        const hasManualOvertime = manualOvertimeForDay.length > 0;
        const manualOvertimeTotalMinutes = manualOvertimeForDay.reduce((sum, mo) => sum + mo.totalMinutes, 0);

        const minutosCompensados = registo?.horasCompensatorias || 0;
        const isCompensado = minutosCompensados > 0;

        const isFerias = feriaDodia != null;
        const isBaixa = baixaDodia != null;
        const isAniversario = aniversarioDodia != null;

        const horaEntrada = isFerias ? "Férias" : isBaixa ? "Baixa" : isAniversario ? "🎂 Aniversário" : (registo?.horaEntrada || "-");
        const horaSaida  = isFerias ? "Férias" : isBaixa ? "Baixa" : isAniversario ? "🎂 Aniversário" : (registo?.horaSaida  || "-");
        const dataObj = registo ? new Date(registo.timestamp) : null;
        const horaEntradaExtraida = extractTime(registo?.horaEntrada);
        const horaSaidaExtraida   = extractTime(registo?.horaSaida);
        const horasCalculadas = (horaEntradaExtraida && horaSaidaExtraida && !isFerias && !isBaixa && !isAniversario)
          ? calcularHoras(horaEntradaExtraida, horaSaidaExtraida, dataObj)
          : { total: "-", minutos: 0, minutosFalta: 0 };

        return {
          dia,
          diaCompleto,
          horaEntrada,
          horaSaida,
          // Horas Trabalhadas = só o tempo de entrada/saída do ponto. A compensação fica
          // exclusivamente em "Compensação Horas" (compensatedMinutes) e as horas extra em
          // "Horas Extra" - nunca somadas aqui. Dia compensado sem ponto mostra 0h.
          total: isCompensado && horasCalculadas.total === "-" ? "0h 0m" : horasCalculadas.total,
          minutosFalta: horasCalculadas.minutosFalta || 0,
          manualOvertime: hasManualOvertime ? `${Math.floor(manualOvertimeTotalMinutes / 60)}h ${manualOvertimeTotalMinutes % 60}m` : null,
          manualOvertimeMinutes: manualOvertimeTotalMinutes,
          manualOvertimeEntries: manualOvertimeForDay,
          manualOvertimeDescription: manualOvertimeForDay.map(mo => mo.description).join(', '),
          feriasPendente: isFerias,
          baixaPendente: isBaixa,
          compensated: isCompensado,
          compensatedMinutes: minutosCompensados,
          // Pedidos de compensação do dia (pendentes/aprovados/rejeitados) - só o efeito
          // dos aprovados está em compensatedMinutes (ver compensationApprovalController.js).
          compensationRequests: compensacoesData.filter(p => p.date === diaCompleto),
          edicaoPendente: ajustesPendentesPorDia[diaCompleto] || null
        };
      });

      setDados(dadosProcessados);
  }, [month, year]);

  // Modo A: dados vêm do pai (calendarData != null) - só falta juntar os pedidos
  // pendentes (que continuam a ser só desta tabela) e processar.
  useEffect(() => {
    if (!hasExternalData) return;
    if (calendarLoading || !calendarData) { setLoading(true); return; }
    let cancelled = false;
    setLoading(true);
    fetchPendingEdits().then((ajustes) => {
      if (cancelled) return;
      processCalendarData(calendarData, ajustes);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [hasExternalData, calendarData, calendarLoading, fetchPendingEdits, processCalendarData]);

  // Modo B: sem dados do pai (ex: dentro do modal de resumo anual, um mês/ano
  // arbitrário por linha expandida) - comportamento de sempre, pedido próprio.
  const fetchOwnData = useCallback(async () => {
    if (!username) return;
    setLoading(true);
    try {
      const response = await apiFetch(`/timetracking/calendar`, {
        method: "POST",
        body: JSON.stringify({ month, year }),
      });
      if (!response.ok) {
        throw new Error(`Erro HTTP: ${response.status}`);
      }
      const data = await response.json();
      const ajustes = await fetchPendingEdits();
      processCalendarData(data, ajustes);
    } catch (error) {
      console.error("Erro ao buscar dados:", error);
    } finally {
      setLoading(false);
    }
  // reloadTick força um novo fetchOwnData quando o pai sinaliza que algo mudou (ex:
  // entrada/saída registada) - antes disso era feito remontando este componente
  // inteiro (key={refreshKey}), o que também reiniciava contextMenu/tooltip/modal de
  // horas extras sem necessidade.
  }, [username, month, year, reloadTick, fetchPendingEdits, processCalendarData]);

  useEffect(() => {
    if (hasExternalData) return;
    fetchOwnData();
  }, [hasExternalData, fetchOwnData]);

  // Pede ao pai para recarregar (modo A) ou recarrega diretamente (modo B) - usado
  // depois de ações desta tabela que mudam os dados (compensar dia curto, pedir
  // alteração de horas, registar horas extra manuais).
  const refreshData = useCallback(() => {
    if (hasExternalData) {
      if (onDataChanged) onDataChanged();
    } else {
      fetchOwnData();
    }
  }, [hasExternalData, onDataChanged, fetchOwnData]);

  const handleContextMenu = (e, dayIndex) => {
    e.preventDefault();
    const dia = `${String(dayIndex + 1).padStart(2, "0")}-${String(month).padStart(2, "0")}`;
    setSelectedDate(dia);
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      dayIndex
    });
  };

  const closeContextMenu = () => {
    setContextMenu({ visible: false, x: 0, y: 0, dayIndex: null });
  };

  const showTooltip = (e, manualOvertime, description) => {
    setTooltip({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      content: `Horas Extras Manuais: ${manualOvertime}${description ? `\n${description}` : ''}`
    });
  };

  const hideTooltip = () => {
    setTooltip({ visible: false, x: 0, y: 0, content: '' });
  };

  const openOvertimeManager = (entries, date) => {
    console.log('Abrir modal para gerenciar horas extras:', entries, date);
    setOvertimeModal({
      show: true,
      entries: entries.map(entry => ({
        ...entry,
        id: entry.id || `${entry.date}_${entry.startHour}`
      })),
      date: date
    });
  };

  const closeOvertimeModal = () => {
    setOvertimeModal({ show: false, entries: [], date: '' });
  };

  const handleOvertimeUpdate = () => {
    closeOvertimeModal();
    refreshData();
  };

  const handleCompensated = () => {
    refreshData();
  };


  const tableHead = (
    <thead className="sticky top-0 bg-white">
      <tr>
        <th className="px-4 py-3 text-left font-semibold text-gold uppercase text-xs tracking-wide border-b-2 border-gray-200">Data</th>
        <th className="px-4 py-3 text-left font-semibold text-gold uppercase text-xs tracking-wide border-b-2 border-gray-200">Hora Entrada</th>
        <th className="px-4 py-3 text-left font-semibold text-gold uppercase text-xs tracking-wide border-b-2 border-gray-200">Hora Saída</th>
        <th className="px-4 py-3 text-left font-semibold text-gold uppercase text-xs tracking-wide border-b-2 border-gray-200">Horas Trabalhadas</th>
        <th className="px-4 py-3 text-left font-semibold text-gold uppercase text-xs tracking-wide border-b-2 border-gray-200">Horas Extra</th>
        <th className="px-4 py-3 text-left font-semibold text-gold uppercase text-xs tracking-wide border-b-2 border-gray-200">Compensação Horas</th>
      </tr>
    </thead>
  );

  if (loading) {
    return (
      <div className={`${className}`.trim()}>
        <table className="w-full border-collapse text-[0.9rem] bg-white">
          {tableHead}
          <tbody>
            {Array.from({ length: 8 }).map((_, i) => (
              <tr key={i} className="border-b border-gray-100">
                <td className="px-4 py-3"><div className="h-3 w-12 rounded-full bg-gray-100 animate-pulse" style={{ animationDelay: `${i * 60}ms` }} /></td>
                <td className="px-4 py-3"><div className="h-3 w-14 rounded-full bg-gray-100 animate-pulse" style={{ animationDelay: `${i * 60}ms` }} /></td>
                <td className="px-4 py-3"><div className="h-3 w-14 rounded-full bg-gray-100 animate-pulse" style={{ animationDelay: `${i * 60}ms` }} /></td>
                <td className="px-4 py-3"><div className="h-3 w-20 rounded-full bg-gray-100 animate-pulse" style={{ animationDelay: `${i * 60}ms` }} /></td>
                <td className="px-4 py-3"><div className="h-3 w-12 rounded-full bg-gray-100 animate-pulse" style={{ animationDelay: `${i * 60}ms` }} /></td>
                <td className="px-4 py-3"><div className="h-3 w-12 rounded-full bg-gray-100 animate-pulse" style={{ animationDelay: `${i * 60}ms` }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // Calcular totais
  const calcularTotais = () => {
    let totalMinutosTrabalho = 0;
    let totalManualOvertime = 0;

    dados.forEach(item => {
      if (item.total !== '-') {
        const match = item.total.match(/(\d+)h (\d+)m/);
        if (match) {
          totalMinutosTrabalho += parseInt(match[1]) * 60 + parseInt(match[2]);
        }
      }
      totalManualOvertime += minutosHorasExtraAprovadas(item.manualOvertimeEntries);
    });

    // Bruto: o mensal já não é reduzido pelas faltas do dia  -  ver
    // CompensateOvertimeButton, que desconta do saldo anual em vez do mensal.
    // Só horas extra registadas manualmente e aprovadas - o ponto nunca gera horas extra.
    const totalExtrasLiquido = totalManualOvertime;

    return {
      totalTrabalho: formatarMinutos(totalMinutosTrabalho),
      totalExtras: formatarMinutos(totalExtrasLiquido)
    };
  };

  const totais = calcularTotais();

  return (
    <div className={`${className}`.trim()}>
      <table className="w-full border-collapse text-[0.9rem] bg-white">
        {tableHead}
        <tbody>
            {dados.map((item, index) => (
              <TableRow
                key={index}
                item={item}
                index={index}
                month={month}
                onContextMenu={handleContextMenu}
                showTooltip={showTooltip}
                hideTooltip={hideTooltip}
                openOvertimeManager={openOvertimeManager}
                onCompensated={handleCompensated}
                saldoHorasExtra={saldoHorasExtra}
              />
            ))}
          </tbody>
          <tfoot className="border-t-2 border-gray-200 bg-gold-light font-bold">
            <tr>
              <td colSpan="3" className="text-right p-3">Total:</td>
              <td className="text-warning p-3">{totais.totalTrabalho}</td>
              <td className="p-3" colSpan="2"></td>
            </tr>
          </tfoot>
      </table>
      {tooltip.visible && (
        <div
          style={{
            position: 'fixed',
            top: tooltip.y + 10,
            left: tooltip.x + 10,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            padding: '8px 12px',
            borderRadius: '4px',
            fontSize: '12px',
            whiteSpace: 'pre-line',
            zIndex: 10000,
            pointerEvents: 'none'
          }}
        >
          {tooltip.content}
        </div>
      )}
      <ContextMenu
        visible={contextMenu.visible}
        x={contextMenu.x}
        y={contextMenu.y}
        onClose={closeContextMenu}
        date={selectedDate}
        dateCompleta={contextMenu.dayIndex != null ? dados[contextMenu.dayIndex]?.diaCompleto : null}
        isDiaEditavel={contextMenu.dayIndex != null ? new Date(year, month - 1, contextMenu.dayIndex + 1) <= new Date(new Date().setHours(0, 0, 0, 0)) : false}
        horaEntradaAtual={contextMenu.dayIndex != null ? dados[contextMenu.dayIndex]?.horaEntrada : null}
        horaSaidaAtual={contextMenu.dayIndex != null ? dados[contextMenu.dayIndex]?.horaSaida : null}
        onTimeEditRequested={refreshData}
        username={username}
        month={month}
        onOvertimeRegistered={refreshData}
        podeCompensar={contextMenu.dayIndex != null && podeCompensarDia(dados[contextMenu.dayIndex], { isSuperAdmin, saldoMinutos: saldoHorasExtra })}
        onCompensar={() => setDiaACompensar(dados[contextMenu.dayIndex])}
      />
      {diaACompensar && (
        <CompensateOvertimeButton
          aberto
          date={diaACompensar.diaCompleto}
          deficitMinutes={diaACompensar.minutosFalta}
          saldoMinutos={saldoHorasExtra}
          onFechar={() => setDiaACompensar(null)}
          onSuccess={refreshData}
        />
      )}
      <ManualOvertimeModal
        show={overtimeModal.show}
        onClose={closeOvertimeModal}
        selectedDayEntries={overtimeModal.entries}
        selectedDate={overtimeModal.date}
        username={username}
        onUpdate={handleOvertimeUpdate}
      />
    </div>
  );
};

export default TimeTrackingTable;
