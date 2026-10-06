import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { FaCalendarDays, FaCalendarCheck, FaArrowRightArrowLeft, FaGear } from "react-icons/fa6";
import Sidebar from "../../shared/components/Sidebar";
import Topbar from "../../shared/components/Topbar";
import { apiFetch } from "../../shared/utils/apiFetch";
import { usePermissions } from "../../shared/hooks/usePermissions";
import ReservarTab from "./components/ReservarTab";
import MinhasReservasTab from "./components/MinhasReservasTab";
import PedidosTab from "./components/PedidosTab";
import GerirSalasModal from "./components/GerirSalasModal";
import { Botao } from "./components/ui";
import { GOLD, lerJson } from "./salasUtils";

// Requisição de Salas (Gestão de Infraestruturas). Leituras pensadas para o limite de
// reads do Firestore: as salas e os pedidos são pedidos uma vez ao abrir a página (os
// locais de trabalho vêm do backend sem reads, com cache partilhada, ver
// useLocaisTrabalho), a ocupação só para o local+dia escolhidos (com cache, ver
// ReservarTab) e as reservas do próprio só quando o separador é aberto. Sem listeners em tempo real - os
// dados são recarregados apenas depois de uma ação do próprio utilizador.
export default function RequisicaoSalas() {
  const { isAdminOrHR } = usePermissions();
  const [tab, setTab] = useState("reservar");
  const [estrutura, setEstrutura] = useState(null);
  const [minhas, setMinhas] = useState(null);
  const [minhasACarregar, setMinhasACarregar] = useState(false);
  const [pedidos, setPedidos] = useState(null);
  const [pedidosACarregar, setPedidosACarregar] = useState(false);
  const [gerir, setGerir] = useState(false);
  // Muda sempre que reservas são alteradas fora do separador "Reservar" (cancelar,
  // aceitar pedidos) - limpa a cache de ocupação desse separador.
  const [versaoOcupacao, setVersaoOcupacao] = useState(0);
  const reservasMudaram = () => { setMinhas(null); setVersaoOcupacao((v) => v + 1); };

  const carregarEstrutura = useCallback(async () => {
    try {
      const res = await apiFetch("/reservas-salas/estrutura");
      const body = await lerJson(res);
      if (!res.ok) throw new Error(body.error || "Erro ao carregar as salas");
      setEstrutura(body);
    } catch (e) {
      toast.error(e.message);
      setEstrutura((atual) => atual || { salas: [] });
    }
  }, []);

  const carregarPedidos = useCallback(async () => {
    setPedidosACarregar(true);
    try {
      const res = await apiFetch("/reservas-salas/pedidos");
      const body = await lerJson(res);
      if (!res.ok) throw new Error(body.error || "Erro ao carregar os pedidos");
      setPedidos(body);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setPedidosACarregar(false);
    }
  }, []);

  const carregarMinhas = useCallback(async () => {
    setMinhasACarregar(true);
    try {
      const res = await apiFetch("/reservas-salas/reservas/minhas");
      const body = await lerJson(res);
      if (!res.ok) throw new Error(body.error || "Erro ao carregar as reservas");
      setMinhas(body.reservas);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setMinhasACarregar(false);
    }
  }, []);

  useEffect(() => {
    carregarEstrutura();
    carregarPedidos();
  }, [carregarEstrutura, carregarPedidos]);

  // "As minhas reservas" só é lido ao abrir o separador (e de novo depois de algo mudar).
  useEffect(() => {
    if (tab === "minhas" && minhas === null) carregarMinhas();
  }, [tab, minhas, carregarMinhas]);

  const porResponder = (pedidos?.recebidos || []).filter((p) => p.estado === "pendente").length;

  const tabs = [
    { id: "reservar", label: "Agenda e reservas", icon: FaCalendarDays },
    { id: "minhas", label: "As minhas reservas", icon: FaCalendarCheck },
    { id: "pedidos", label: "Pedidos de alteração", icon: FaArrowRightArrowLeft, badge: porResponder },
  ];

  return (
    <div className="flex min-h-screen bg-stone-50">
      <Sidebar />
      <div className="ml-[var(--sidebar-w,230px)] transition-[margin-left] duration-200 flex-1 min-w-0 flex flex-col min-h-screen">
        <Topbar icon="🚪" title="Requisição de Salas" />

        {/* ---------- Cabeçalho + separadores ---------- */}
        <header className="bg-white border-b border-stone-200/80">
          <div className="max-w-[1480px] w-full mx-auto px-4 sm:px-6 pt-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="m-0 text-[11px] font-bold uppercase tracking-[0.16em] text-[#B8892A]">Gestão de infraestruturas</p>
                <h1 className="m-0 mt-1 text-2xl sm:text-[28px] font-bold tracking-tight text-stone-900">Requisição de Salas</h1>
                <p className="m-0 mt-1 text-sm text-stone-500">Veja a ocupação de cada sala ao longo do dia e reserve clicando num horário livre.</p>
              </div>
              {isAdminOrHR && estrutura && (
                <Botao variante="secundario" onClick={() => setGerir(true)}>
                  <FaGear style={{ fontSize: 13, color: GOLD }} /> Gerir salas
                </Botao>
              )}
            </div>

            <nav className="flex gap-1 sm:gap-6 mt-5 -mb-px overflow-x-auto">
              {tabs.map((t) => {
                const ativo = tab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={`relative px-2 sm:px-0.5 pb-3 pt-1 text-sm font-semibold bg-transparent border-0 border-b-2 cursor-pointer whitespace-nowrap flex items-center gap-2 transition-colors ${ativo ? "text-stone-900 border-[#C8932F]" : "text-stone-500 border-transparent hover:text-stone-800 hover:border-stone-300"}`}
                  >
                    <t.icon style={{ fontSize: 13, color: ativo ? GOLD : undefined }} />
                    {t.label}
                    {t.badge > 0 && (
                      <span className="min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center bg-red-500 text-white">
                        {t.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>
        </header>

        <main className="p-4 sm:p-6 max-w-[1480px] w-full mx-auto">
          {!estrutura ? (
            <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-5">
              <div className="h-[420px] rounded-2xl bg-white border border-stone-200/80 animate-pulse" />
              <div className="h-[620px] rounded-2xl bg-white border border-stone-200/80 animate-pulse" />
            </div>
          ) : (
            <>
              {/* Fica montado (só escondido) para manter a cache de ocupação entre separadores. */}
              <div hidden={tab !== "reservar"}>
                <ReservarTab
                  estrutura={estrutura}
                  versaoOcupacao={versaoOcupacao}
                  onReservaCriada={() => setMinhas(null)}
                  onPedidoEnviado={carregarPedidos}
                />
              </div>
              {tab === "minhas" && (
                <MinhasReservasTab
                  reservas={minhas || []}
                  aCarregar={minhasACarregar || minhas === null}
                  onAlterada={() => { reservasMudaram(); carregarPedidos(); }}
                />
              )}
              {tab === "pedidos" && (
                <PedidosTab
                  pedidos={pedidos}
                  aCarregar={pedidosACarregar}
                  onAlterado={() => { carregarPedidos(); reservasMudaram(); }}
                />
              )}
            </>
          )}
        </main>
      </div>

      {gerir && estrutura && (
        <GerirSalasModal estrutura={estrutura} onClose={() => setGerir(false)} onAlterada={carregarEstrutura} />
      )}
    </div>
  );
}
