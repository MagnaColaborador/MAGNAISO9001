import React from 'react';
import { FaHourglassHalf } from 'react-icons/fa6';
import CompensateOvertimeButton from '../Shared/compensateOvertimeButton';
import { formatarMinutos } from '../../utils/calcHours';
import ManualOvertimeCell from '../Shared/ManualOvertimeCell';
import CompensationCell from '../Shared/CompensationCell';
import { podeCompensarDia } from '../../utils/horasExtra';
import { usePermissions } from '../../../../shared/hooks/usePermissions';

const TableRow = ({
  item,
  index,
  month,
  onContextMenu,
  showTooltip,
  hideTooltip,
  openOvertimeManager,
  onCompensated,
  saldoHorasExtra
}) => {
  // Função para extrair apenas a hora no formato HH:MM
  const extractTime = (timeString) => {
    if (!timeString || timeString === "-") return "-";
    // Se tem espaço, é formato YYYY-MM-DD HH:MM, pega a parte após o espaço
    if (timeString.includes(' ')) {
      return timeString.split(' ')[1];
    }
    // Se já é só HH:MM, retorna como está
    return timeString;
  };

  // Calcular a data atual para verificar se é fim de semana
  const dataAtual = new Date(new Date().getFullYear(), month - 1, index + 1);
  const diaSemana = dataAtual.getDay();
  const isFimDeSemana = diaSemana === 0 || diaSemana === 6;
  
  // O utilizador escolhe quanto quer compensar (pode ser menos do que o défice
  // todo), por isso o dia pode continuar a mostrar menos de 8h mesmo já
  // compensado  -  nesse caso mostra-se a azul em vez de vermelho, e sem botão
  // (só é possível compensar um dia uma vez).
  const isLessThanEightHours = item.total !== "-" && parseInt(item.total.split("h")[0]) < 8 && !isFimDeSemana;
  const isFeriasPendente = item.feriasPendente;
  const isBaixaPendente = item.baixaPendente;
  const isCompensado = item.compensated;
  // Mesma regra do menu de contexto (ver podeCompensarDia em utils/horasExtra.js).
  const { isSuperAdmin } = usePermissions();
  const podeCompensar = podeCompensarDia(item, { isSuperAdmin, saldoMinutos: saldoHorasExtra });

  // Debug log
  if (item.manualOvertime) {
    console.log('TableRow - Dia com manualOvertime:', item.dia, item);
  }

  // Definir classes Tailwind baseado no status
  let rowClass = "";
  if (isFeriasPendente) {
    rowClass = "bg-warning-light";
  } else if (isBaixaPendente) {
    rowClass = "bg-danger-light";
  } else if (isFimDeSemana) {
    rowClass = "bg-gray-100 text-gray-400";
  } else if (isLessThanEightHours && !isCompensado) {
    rowClass = "text-danger";
  }

  return (
    <tr
      onContextMenu={(e) => onContextMenu(e, index)}
      className={rowClass}
    >
      <td className="px-4 py-3 text-left border-b border-gray-200">
        {item.dia.replace(/-/g, '/')}
        {item.manualOvertime && (
          <span
            className="text-gold font-bold ml-[5px] cursor-pointer"
            onMouseEnter={(e) => showTooltip(e, item.manualOvertime, item.manualOvertimeDescription)}
            onMouseLeave={hideTooltip}
            onClick={(e) => {
              e.stopPropagation();
              openOvertimeManager(item.manualOvertimeEntries, item.diaCompleto);
            }}
          >
            *
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-left border-b border-gray-200">
        {extractTime(item.horaEntrada)}
        {item.edicaoPendente?.horaEntrada && (
          <span
            className="inline-flex ml-[5px] text-[#C8932F] cursor-help"
            title={`Pedido de alteração pendente: entrada ${item.edicaoPendente.horaEntrada} - ${item.edicaoPendente.justificativa}`}
          >
            <FaHourglassHalf />
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-left border-b border-gray-200">
        {extractTime(item.horaSaida)}
        {item.edicaoPendente?.horaSaida && (
          <span
            className="inline-flex ml-[5px] text-[#C8932F] cursor-help"
            title={`Pedido de alteração pendente: saída ${item.edicaoPendente.horaSaida} - ${item.edicaoPendente.justificativa}`}
          >
            <FaHourglassHalf />
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-left border-b border-gray-200">
        {item.total}
      </td>
      {/* Horas extra: só as registadas manualmente (HorasExtraManual do dia), com estado e motivo de cada registo no tooltip. */}
      <td className="px-4 py-3 text-left border-b border-gray-200">
        <ManualOvertimeCell entries={item.manualOvertimeEntries} />
      </td>
      {/* Compensação: a efetiva (aprovada) do dia, pedidos pendentes/rejeitados e, se o dia
          tiver défice, não estiver compensado e não houver já um pedido pendente, o botão
          "Compensar" (cria um pedido - ver compensationApprovalController.js). */}
      <td className="px-4 py-3 text-left border-b border-gray-200">
        <CompensationCell compensatedMinutes={item.compensatedMinutes} pedidos={item.compensationRequests}>
          {podeCompensar && (
            <CompensateOvertimeButton date={item.diaCompleto} deficitMinutes={item.minutosFalta} saldoMinutos={saldoHorasExtra} onSuccess={onCompensated} />
          )}
        </CompensationCell>
      </td>
    </tr>
  );
};

export default TableRow;
