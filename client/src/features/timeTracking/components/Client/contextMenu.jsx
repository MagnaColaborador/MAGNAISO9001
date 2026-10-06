import React, { useState, useEffect } from 'react';
import { FaStopwatch, FaClockRotateLeft } from 'react-icons/fa6';
import VacationButton from '../Shared/vacationButton';
import MedicalLeave from '../Shared/medicalLeave';
import ManualOvertimeButton from './manualOvertime';
import RequestTimeEditButton from './requestTimeEditButton';

const ContextMenu = ({
  visible, x, y, onClose, date, username, month, isAdmin = false, onOvertimeRegistered,
  isDiaEditavel = false, dateCompleta, horaEntradaAtual, horaSaidaAtual, onTimeEditRequested,
  podeCompensar = false, onCompensar,
}) => {
  const [activeSubMenu, setActiveSubMenu] = useState(null);
  const [showOvertimeModal, setShowOvertimeModal] = useState(false);

  useEffect(() => {
    const handleClickOutside = () => {
      if (visible && !showOvertimeModal) {
        onClose();
      }
    };

    if (visible) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [visible, onClose, showOvertimeModal]);

  // Reset modal states when context menu closes
  useEffect(() => {
    if (!visible) {
      setShowOvertimeModal(false);
    }
  }, [visible]);

  const handleOpenOvertimeModal = (e) => {
    e.stopPropagation();
    setShowOvertimeModal(true);
  };

  const handleCloseOvertimeModal = () => {
    setShowOvertimeModal(false);
    onClose();
  };

  const handleOvertimeRegistered = () => {
    handleCloseOvertimeModal();
    if (onOvertimeRegistered) onOvertimeRegistered();
  };

  if (showOvertimeModal) {
    return (
      <div 
        className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[2000] p-5" 
        onClick={handleCloseOvertimeModal}
      >
        <div 
          className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-y-auto relative" 
          onClick={(e) => e.stopPropagation()}
        >
          <ManualOvertimeButton username={username} onOvertimeRegistered={handleOvertimeRegistered} isOpen={true} onClose={handleCloseOvertimeModal} />
        </div>
      </div>
    );
  }

  if (!visible) return null;

  return (
    <div
      className="fixed bg-white border border-gray-300 rounded shadow-lg min-w-[200px] py-1 z-[1000]"
      style={{
        top: `${y}px`,
        left: `${x}px`,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="cursor-pointer select-none transition-colors hover:bg-gray-100">
        <span
          className="py-2.5 px-4 flex items-center gap-2 text-sm text-gray-800"
          onClick={handleOpenOvertimeModal}
        >
          <FaStopwatch className="text-[#C8932F]" />
          Registar Horas Extra
        </span>
      </div>
      {/* Compensar horas: abre o mesmo modal do botão da coluna "Compensação Horas" (ao
          nível da tabela, ver pontoTable.jsx) - só para dias compensáveis (podeCompensarDia). */}
      {podeCompensar && (
        <div className="cursor-pointer select-none transition-colors hover:bg-gray-100">
          <span
            className="py-2.5 px-4 flex items-center gap-2 text-sm text-gray-800"
            onClick={(e) => { e.stopPropagation(); onClose(); if (onCompensar) onCompensar(); }}
          >
            <FaClockRotateLeft className="text-[#C8932F]" />
            Compensar horas
          </span>
        </div>
      )}
      {isAdmin && (
        <div className="cursor-pointer select-none transition-colors hover:bg-gray-100 [&_button]:w-full [&_button]:py-2.5 [&_button]:px-4 [&_button]:flex [&_button]:items-center [&_button]:gap-2 [&_button]:text-sm [&_button]:text-gray-800 [&_button]:text-left [&_button]:bg-transparent [&_button]:border-none [&_button]:cursor-pointer">
          <VacationButton username={username} date={date} onSuccess={onClose} />
        </div>
      )}
      <div className="cursor-pointer select-none transition-colors hover:bg-gray-100 [&_button]:w-full [&_button]:py-2.5 [&_button]:px-4 [&_button]:flex [&_button]:items-center [&_button]:gap-2 [&_button]:text-sm [&_button]:text-gray-800 [&_button]:text-left [&_button]:bg-transparent [&_button]:border-none [&_button]:cursor-pointer">
        <MedicalLeave username={username} date={date} onSuccess={onClose} />
      </div>
      {isDiaEditavel && (
        <div className="cursor-pointer select-none transition-colors hover:bg-gray-100 [&_button]:w-full [&_button]:py-2.5 [&_button]:px-4 [&_button]:flex [&_button]:items-center [&_button]:gap-2 [&_button]:text-sm [&_button]:text-gray-800 [&_button]:text-left [&_button]:bg-transparent [&_button]:border-none [&_button]:cursor-pointer">
          <RequestTimeEditButton
            date={dateCompleta}
            horaEntradaAtual={horaEntradaAtual}
            horaSaidaAtual={horaSaidaAtual}
            onSuccess={() => { onClose(); if (onTimeEditRequested) onTimeEditRequested(); }}
          />
        </div>
      )}
    </div>
  );
};

export default ContextMenu;