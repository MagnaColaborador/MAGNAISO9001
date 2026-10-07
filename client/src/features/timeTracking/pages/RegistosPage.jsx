import React, { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserContext } from '../../../shared/context/userContext';
import * as Client from '../components/Client';
import LoadingSpinner from '../components/Shared/loadingSpinner';
import Sidebar from '../../../shared/components/Sidebar';
import Topbar from '../../../shared/components/Topbar';
import { apiFetch } from '../../../shared/utils/apiFetch';

const RegistosPage = () => {
  const { username } = useContext(UserContext);
  const navigate = useNavigate();
  // Antes, key={refreshKey} desmontava e voltava a montar os 4 componentes abaixo a
  // cada picagem de ponto - repetia TODOS os seus pedidos (incluindo os de estado,
  // não só os que mudaram) e fechava qualquer modal/tooltip que estivesse aberto.
  // reloadTick é passado como prop normal (não como key), para que cada componente
  // decida por si quando recarregar os seus próprios dados, sem remontar.
  const [reloadTick, setReloadTick] = useState(0);
  // Saldo anual de horas extra (TotalSummary -> /overtime-balance): só recarrega quando
  // o que mudou o pode alterar - ver handleEntryRegistered. Todas as outras recargas
  // continuam a atualizá-lo.
  const [overtimeReloadTick, setOvertimeReloadTick] = useState(0);
  // Saldo anual líquido de horas extra (vem da TotalSummary, que já pede
  // /overtime-balance) - passado à PontoTable para o botão "Compensar".
  const [saldoHorasExtra, setSaldoHorasExtra] = useState(undefined);
  const reloadRegistos = () => {
    setReloadTick(k => k + 1);
    setOvertimeReloadTick(k => k + 1);
  };

  // Estado de entrada/saída de hoje, partilhado pelos dois botões - ver nota em
  // entryRegisterButton.jsx/exitRegisterButton.jsx (era /checkEntry + /checkEntry +
  // /checkLeave, 3 leituras; agora é uma só chamada a /checkTimeTracking).
  const [entryStatus, setEntryStatus] = useState({ hasEntry: false, hasLeave: false });
  const [entryStatusLoading, setEntryStatusLoading] = useState(true);

  useEffect(() => {
    if (!username) return undefined;
    let cancelled = false;
    setEntryStatusLoading(true);
    apiFetch('/timetracking/checkTimeTracking', { method: 'POST' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setEntryStatus({ hasEntry: !!data.hasEntry, hasLeave: !!data.hasLeave });
      })
      .catch((error) => console.error('Erro ao verificar entrada/saída:', error))
      .finally(() => { if (!cancelled) setEntryStatusLoading(false); });
    return () => { cancelled = true; };
  }, [username]);

  // Uma entrada num dia sem registo não altera o saldo de horas extra (sem saída não há
  // horas contadas), por isso não vale a pena voltar a ler o ano inteiro de Registos. Se
  // a entrada substituiu um registo já existente desse dia (registoAnteriorExistia, ver
  // registerEntry) ou a resposta não o indicar, recarrega tudo como antes.
  const handleEntryRegistered = (data) => {
    setEntryStatus((s) => ({ ...s, hasEntry: true }));
    if (data?.registoAnteriorExistia === false) {
      setReloadTick(k => k + 1);
    } else {
      reloadRegistos();
    }
  };

  const handleLeaveRegistered = () => {
    setEntryStatus((s) => ({ ...s, hasLeave: true }));
    reloadRegistos();
  };

  // Dados do mês corrente (/calendar), partilhados por PontoTable e TotalSummary -
  // antes, cada um pedia isto de forma independente (mesmo username/mês/ano),
  // duplicando a leitura mais cara da página a cada carregamento.
  const [calendarData, setCalendarData] = useState(null);
  const [calendarLoading, setCalendarLoading] = useState(true);

  useEffect(() => {
    if (!username) return undefined;
    let cancelled = false;
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    setCalendarLoading(true);
    apiFetch('/timetracking/calendar', {
      method: 'POST',
      body: JSON.stringify({ month, year }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        setCalendarData(data || {});
      })
      .catch((error) => console.error('Erro ao buscar dados do livro de ponto:', error))
      .finally(() => { if (!cancelled) setCalendarLoading(false); });
    return () => { cancelled = true; };
  }, [username, reloadTick]);

  const handleSelectFile = (filePath) => {
    const formattedPath = filePath.replace(/\s/g, '-').replace(/\//g, '__');
    navigate(`/file/${formattedPath}`, { state: { originalFilename: filePath } });
  };

  if (!username) {
   return <LoadingSpinner />;
 }

  return (
    <div className="flex min-h-screen">
      <Sidebar onSelectFile={handleSelectFile} />

      <div className="ml-[var(--sidebar-w,230px)] transition-[margin-left] duration-200 flex-1 min-w-0 flex flex-col min-h-0">
        <Topbar icon="🕐" title="Registos" />

        <main className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6">
          <div className="flex flex-col lg:flex-row gap-6 items-start">
            <div className="flex-1 min-w-0 w-full flex flex-col gap-4">
              <div className="flex flex-wrap gap-3">
                <div className="flex-1 min-w-[160px]">
                  <Client.EntryRegisterButton hasEntry={entryStatus.hasEntry} loading={entryStatusLoading} fontSize="0.85rem" buttonHeight="46px" onSuccess={handleEntryRegistered} />
                </div>
                <div className="flex-1 min-w-[160px]">
                  <Client.ExitRegisterButton hasEntry={entryStatus.hasEntry} hasLeave={entryStatus.hasLeave} loading={entryStatusLoading} fontSize="0.85rem" buttonHeight="46px" onSuccess={handleLeaveRegistered} />
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <Client.PontoTable
                  className="overflow-x-auto"
                  username={username}
                  reloadTick={reloadTick}
                  calendarData={calendarData}
                  calendarLoading={calendarLoading}
                  onDataChanged={reloadRegistos}
                  saldoHorasExtra={saldoHorasExtra}
                />
              </div>
            </div>

            <Client.TotalSummary
              username={username}
              reloadTick={reloadTick}
              overtimeReloadTick={overtimeReloadTick}
              calendarData={calendarData}
              calendarLoading={calendarLoading}
              onSaldoChange={setSaldoHorasExtra}
            />
          </div>
        </main>
      </div>
    </div>
  );
};

export default RegistosPage;
