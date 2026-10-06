import React, { useState, useContext, useLayoutEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "react-toastify";
import { UserContext } from "../context/userContext";
import { FavoritesContext } from "../context/favoritesContext";
import { usePermissions } from "../hooks/usePermissions";
import UserAvatar from "./UserAvatar";
import Logo from "../assets/logo.svg";
import {
  FaChartBar,
  FaBuilding,
  FaPeopleGroup,
  FaStar,
  FaTriangleExclamation,
  FaArrowsRotate,
  FaUser,
  FaClipboardList,
  FaXmark,
  FaFile,
  FaIdCard,
  FaGraduationCap,
  FaUmbrellaBeach,
  FaClock,
  FaSackDollar,
  FaBriefcaseMedical,
  FaTrophy,
  FaClipboardCheck,
  FaComments,
  FaChevronLeft,
  FaChevronRight,
  FaWarehouse,
  FaScrewdriverWrench,
  FaDoorOpen,
} from "react-icons/fa6";

const SIDEBAR_COLLAPSED_KEY = "sidebarCollapsed";
const RESOURCES_DROPDOWN_KEY = "sidebarResourcesOpen";
const INFRASTRUCTURE_DROPDOWN_KEY = "sidebarInfrastructureOpen";
const EXPANDED_WIDTH = 230;
const COLLAPSED_WIDTH = 64;
const MOBILE_BREAKPOINT = "(max-width: 767px)";

const PEOPLE_MANAGEMENT_ITEMS = [
  { name: "Cadastro", icon: FaIdCard },
  { name: "Plano de Formação", icon: FaGraduationCap },
  { name: "Mapa de Férias", icon: FaUmbrellaBeach },
  { name: "Livro de Ponto", icon: FaClock },
  // { name: "Fecho Mensal", icon: FaClipboardCheck }, - painel próprio desativado, estado/ações passaram para /salarios
  { name: "Processamento Salários", icon: FaSackDollar },
  { name: "Medicina de Trabalho", icon: FaBriefcaseMedical },
  { name: "Prémios", icon: FaTrophy },
];

const PEOPLE_MANAGEMENT_PATH_PREFIXES = [
  "/ponto",
  "/colaboradores",
  "/cadastro",
  "/salarios",
  "/plano-formacao",
  "/ferias",
  // "/fecho-mensal", - painel próprio desativado, ver PEOPLE_MANAGEMENT_ITEMS
  "/medicina-trabalho",
  "/premios",
];

const matchesPathPrefix = (prefixes, pathname) =>
  prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

const isPeopleManagementPath = (pathname) =>
  matchesPathPrefix(PEOPLE_MANAGEMENT_PATH_PREFIXES, pathname);

// Gestão de Infraestruturas - ao contrário de Gestão de Pessoas, cada item tem só uma
// rota fixa (sem variantes por permissão), por isso o caminho vive no próprio item e
// basta acrescentar uma entrada aqui para uma nova funcionalidade aparecer no menu.
// "Cadastro de Equipamentos" ainda não tem página própria: abre a página de manutenção.
const INFRASTRUCTURE_ITEMS = [
  { name: "Cadastro de Equipamentos", icon: FaScrewdriverWrench, path: "/equipamentos" },
  { name: "Requisição de Salas", icon: FaDoorOpen, path: "/requisicao-salas" },
];

const isInfrastructurePath = (pathname) =>
  matchesPathPrefix(INFRASTRUCTURE_ITEMS.map((item) => item.path), pathname);

// Mesma normalização usada em toda a app para gerar o slug de uma entidade a
// partir do seu nome (ex: allEntities.jsx, Entity.jsx)  -  aqui só é preciso para
// levar um Administrador direto à página da sua própria entidade.
const normalizeEntitySlug = (nome) => (nome || "").toLowerCase()
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .replace(/&/g, 'e')
  .replace(/-/g, ' ')
  .replace(/[^a-z0-9\s]/g, '')
  .trim()
  .replace(/\s+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-+|-+$/g, '');

export default function Sidebar({ onSelectFile }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { username, uid, entidadeNome, userRole } = useContext(UserContext);
  const { favorites, toggleFavorite } = useContext(FavoritesContext);
  const { isSuperAdmin, isAdminOrHR, canManageUsers, canViewColaboradores, canViewPremiosList } = usePermissions();
  // Plano de Formação/Medicina de Trabalho: mesmo âmbito de gestão de contas
  // (requireAdminOrEntidadeAdmin) - nunca o Gestor Financeiro, que fica fora destas duas áreas.
  const canManageColaboradores = canManageUsers;
  // Cadastro/Processamento Salários: Gestor Financeiro também entra na vista de lista
  // (as duas áreas que gere) - mesmo âmbito de requireCanViewColaboradores no backend.
  const canManageFinanceiro = canViewColaboradores;
  // Prémios: GestorRH só consulta os seus próprios (ver canRead em premiosController) -
  // ao contrário das outras áreas de gestão de pessoas, nunca vê a lista de colaboradores aqui.
  const canManagePremios = canViewPremiosList;
  // Função do colaborador (campo "role", editado em Cadastro > Dados contratuais)  -
  // "user"/"User" é o valor por omissão de contas sem função preenchida (ver
  // verifyTokenAndGetUserInfo/createUser), por isso não é mostrado.
  const funcao = userRole && userRole.toLowerCase() !== "user" ? userRole : "";

  const [showFavoritesDropdown, setShowFavoritesDropdown] = useState(false);
  const [showResourcesDropdown, setShowResourcesDropdown] = useState(() =>
    isPeopleManagementPath(location.pathname) ||
    localStorage.getItem(RESOURCES_DROPDOWN_KEY) === "1"
  );
  const [showInfrastructureDropdown, setShowInfrastructureDropdown] = useState(() =>
    isInfrastructurePath(location.pathname) ||
    localStorage.getItem(INFRASTRUCTURE_DROPDOWN_KEY) === "1"
  );
  const [collapsed, setCollapsed] = useState(() =>
    localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1" ||
    window.matchMedia(MOBILE_BREAKPOINT).matches
  );
  const [isMobile, setIsMobile] = useState(() =>
    window.matchMedia(MOBILE_BREAKPOINT).matches
  );
  const isActive = (path) => location.pathname === path;

  // Em mobile o sidebar expandido não pode empurrar o conteúdo (não há
  // largura sobrando) - passa a sobrepor-se como uma gaveta, por isso o
  // conteúdo reserva sempre só a largura colapsada.
  useLayoutEffect(() => {
    document.documentElement.style.setProperty(
      "--sidebar-w",
      `${isMobile || collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH}px`
    );
  }, [collapsed, isMobile]);

  // Em ecrãs estreitos o sidebar arranca sempre colapsado (mesmo que o
  // utilizador o tenha deixado expandido num ecrã maior), para não ocupar
  // uma fatia grande do espaço disponível.
  useLayoutEffect(() => {
    const mql = window.matchMedia(MOBILE_BREAKPOINT);
    const handleChange = (e) => {
      setIsMobile(e.matches);
      if (e.matches) setCollapsed(true);
    };
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  };

  const toggleResourcesDropdown = () => {
    setShowResourcesDropdown((prev) => {
      const next = !prev;
      localStorage.setItem(RESOURCES_DROPDOWN_KEY, next ? "1" : "0");
      return next;
    });
  };

  const toggleInfrastructureDropdown = () => {
    setShowInfrastructureDropdown((prev) => {
      const next = !prev;
      localStorage.setItem(INFRASTRUCTURE_DROPDOWN_KEY, next ? "1" : "0");
      return next;
    });
  };

  const handlePeopleManagementItemClick = (item) => {
    if (item.name === "Livro de Ponto") {
      navigate("/ponto");
    } else if (item.name === "Cadastro") {
      // canManageFinanceiro (não canManageColaboradores): um GestorFinanceiro também
      // pode consultar o Cadastro de outros colaboradores (ver canViewCadastro em
      // usePermissions.js), por isso precisa de chegar à lista tal como já acontecia
      // em Processamento Salários/Prémios.
      navigate(canManageFinanceiro ? "/colaboradores" : "/cadastro");
    } else if (item.name === "Processamento Salários") {
      navigate(canManageFinanceiro ? "/salarios" : `/salarios/${uid}`);
    } else if (item.name === "Plano de Formação") {
      navigate(canManageColaboradores ? "/plano-formacao" : `/plano-formacao/${uid}`);
    } else if (item.name === "Medicina de Trabalho") {
      navigate(canManageColaboradores ? "/medicina-trabalho" : `/medicina-trabalho/${uid}`);
    } else if (item.name === "Prémios") {
      navigate(canManagePremios ? "/premios" : `/premios/${uid}`);
    } else if (item.name === "Mapa de Férias") {
      navigate("/ferias");
    // } else if (item.name === "Fecho Mensal") { - painel próprio desativado, ver PEOPLE_MANAGEMENT_ITEMS
    //   navigate(canManageColaboradores ? "/fecho-mensal" : "/ponto");
    } else {
      toast.info("Funcionalidade em breve", { position: "top-right", autoClose: 2500 });
    }
  };

  const navItemClass = (path) =>
    `flex items-center gap-2.5 py-[9px] ${collapsed ? 'justify-center px-0' : 'px-3'} text-[13px] cursor-pointer rounded-md mx-2 my-px transition-colors duration-150 relative no-underline ${
      isActive(path)
        ? 'bg-[#EDD9A3] text-[#7A5010] font-semibold'
        : 'text-[#5C3D0E] hover:bg-[#F0E2C4]'
    }`;

  const navItemBaseClass =
    `flex items-center gap-2.5 py-[9px] ${collapsed ? 'justify-center px-0' : 'px-3'} text-[13px] text-[#5C3D0E] cursor-pointer rounded-md mx-2 my-px transition-colors duration-150 relative no-underline hover:bg-[#F0E2C4]`;

  const sectionLabel = (text) =>
    collapsed ? (
      <div className="mx-3 mt-4 mb-[5px] border-t border-[#E8D0A0]" />
    ) : (
      <div className="px-[14px] pt-4 pb-[5px] text-[10px] text-[#B8892A] tracking-[0.08em] uppercase font-semibold">{text}</div>
    );

  // Dropdown do menu (Gestão de Pessoas, Gestão de Infraestruturas, ...) - mesmo aspeto
  // para todos: em modo colapsado só os ícones, expandido uma caixa com ícone + nome.
  const renderAccordion = ({ label, Icon, open, onToggle, items, onItemClick }) => (
    <>
      <div
        className={navItemBaseClass}
        onClick={onToggle}
        title={collapsed ? label : undefined}
      >
        <Icon style={{ fontSize: 16, color: "var(--gold)", flexShrink: 0 }} />
        {!collapsed && (
          <>
            {label}
            <span className={`text-[10px] transition-transform duration-[250ms] ml-auto${open ? ' rotate-180' : ''}`}>▼</span>
          </>
        )}
      </div>
      {open && (
        collapsed ? (
          <div className="mb-1">
            {items.map(item => (
              <div
                key={item.name}
                className="flex items-center justify-center py-[9px] text-[13px] text-[#5C3D0E] cursor-pointer rounded-md mx-2 my-px transition-colors duration-150 hover:bg-[#F0E2C4]"
                onClick={() => onItemClick(item)}
                title={item.name}
              >
                <item.icon style={{ fontSize: 14, color: "var(--gold)", flexShrink: 0 }} />
              </div>
            ))}
          </div>
        ) : (
          <div className="mx-2 mb-1 rounded-md overflow-hidden border border-[#E8D0A0] bg-[#FDF8EE]">
            {items.map(item => (
              <div
                key={item.name}
                className="flex items-start gap-2 px-3 py-[8px] border-b border-[#EDE0C4] last:border-b-0 cursor-pointer transition-colors duration-150 hover:bg-[#F0E2C4]"
                onClick={() => onItemClick(item)}
              >
                <item.icon style={{ fontSize: 12, color: "var(--gold)", flexShrink: 0, marginTop: 2 }} />
                <span className="text-[12px] text-[#5C3D0E] font-medium leading-snug break-words min-w-0">
                  {item.name}
                </span>
              </div>
            ))}
          </div>
        )
      )}
    </>
  );

  return (
    <>
      {isMobile && !collapsed && (
        <div
          className="fixed inset-0 bg-black/40 z-[490]"
          onClick={() => setCollapsed(true)}
        />
      )}
      <aside className={`${collapsed ? 'w-16' : 'w-[230px]'} bg-[#FAF3E6] border-r border-[#E8D0A0] flex flex-col fixed top-0 left-0 h-screen z-[500] shrink-0 transition-[width] duration-200 overflow-visible${isMobile && !collapsed ? ' shadow-2xl' : ''}`}>
        {/* Logo */}
        <div className={`px-4 pt-5 pb-4 border-b border-[#E8D0A0] flex items-center gap-2.5 ${collapsed ? 'justify-center px-0' : ''}`}>
          <img src={Logo} alt="Logo Magna" className="w-auto h-[55px] shrink-0" />
          {!collapsed && (
            <div>
              <div className="text-[13px] font-semibold text-[#4A2E08] leading-[1.3]">Magna ISO9001</div>
              <div className="text-[10px] text-[#B8892A] mt-px">Cooperativa Comenius</div>
            </div>
          )}
        </div>

        {/* Toggle collapse button */}
        <button
          onClick={toggleCollapsed}
          title={collapsed ? "Expandir menu" : "Colapsar menu"}
          className="absolute -right-3 top-[52px] w-6 h-6 rounded-full border border-[#E8D0A0] bg-white shadow flex items-center justify-center text-[#7A5010] hover:bg-[#F0E2C4] transition-colors duration-150 z-10"
        >
          {collapsed ? <FaChevronRight style={{ fontSize: 10 }} /> : <FaChevronLeft style={{ fontSize: 10 }} />}
        </button>

        <div className="flex-1 overflow-y-auto">
        {/* Principal */}
        {sectionLabel("Principal")}
        <div className={navItemClass("/dashboard")} onClick={() => navigate("/dashboard")} title={collapsed ? "ISO9001" : undefined}>
          <FaChartBar style={{ fontSize: 16, color: "var(--gold)", flexShrink: 0 }} /> {!collapsed && "ISO9001"}</div>
        <div className={navItemClass("/chat")} onClick={() => navigate("/chat")} title={collapsed ? "Chat com RH" : undefined}>
          <FaComments style={{ fontSize: 16, color: "var(--gold)", flexShrink: 0 }} /> {!collapsed && "Chat com RH"}</div>
        {/* Gestão de Pessoas accordion */}
        {renderAccordion({
          label: "Gestão de Pessoas",
          Icon: FaPeopleGroup,
          open: showResourcesDropdown,
          onToggle: toggleResourcesDropdown,
          items: PEOPLE_MANAGEMENT_ITEMS,
          onItemClick: handlePeopleManagementItemClick,
        })}

        {/* Gestão de Infraestruturas accordion */}
        {renderAccordion({
          label: "Gestão de Infraestruturas",
          Icon: FaWarehouse,
          open: showInfrastructureDropdown,
          onToggle: toggleInfrastructureDropdown,
          items: INFRASTRUCTURE_ITEMS,
          onItemClick: (item) => navigate(item.path),
        })}

        {/* Favoritos accordion */}
        {favorites.length > 0 && (
          <>
            <div
              className={navItemBaseClass}
              onClick={() => setShowFavoritesDropdown(!showFavoritesDropdown)}
              title={collapsed ? `Favoritos (${favorites.length})` : undefined}
            >
              <FaStar style={{ fontSize: 16, color: "var(--gold)", flexShrink: 0 }} />
              {!collapsed && (
                <>
                  Favoritos ({favorites.length})
                  <span className={`text-[10px] transition-transform duration-[250ms] ml-auto${showFavoritesDropdown ? ' rotate-180' : ''}`}>▼</span>
                </>
              )}
            </div>
            {showFavoritesDropdown && (
              collapsed ? (
                <div className="mb-1">
                  {favorites.map(fav => (
                    <div
                      key={fav.path}
                      className="flex items-center justify-center py-[9px] text-[13px] text-[#5C3D0E] cursor-pointer rounded-md mx-2 my-px transition-colors duration-150 hover:bg-[#F0E2C4]"
                      onClick={() => onSelectFile(fav.path)}
                      title={fav.name}
                    >
                      <FaFile style={{ fontSize: 14, color: "var(--gold)", flexShrink: 0 }} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mx-2 mb-1 rounded-md overflow-hidden border border-[#E8D0A0] bg-[#FDF8EE]">
                  {favorites.map(fav => (
                    <div
                      key={fav.path}
                      className="flex items-start gap-2 px-3 py-[8px] border-b border-[#EDE0C4] last:border-b-0 transition-colors duration-150 hover:bg-[#F0E2C4]"
                    >
                      <FaFile style={{ fontSize: 12, color: "var(--gold)", flexShrink: 0, marginTop: 2 }} />
                      <span
                        className="flex-1 text-[12px] text-[#5C3D0E] font-medium cursor-pointer leading-snug break-words min-w-0 hover:text-[#C8932F] transition-colors duration-150"
                        onClick={() => { onSelectFile(fav.path); setShowFavoritesDropdown(false); }}
                      >
                        {fav.name}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleFavorite(fav.path, fav.name); }}
                        className="bg-red-50 text-red-600 border border-red-200 rounded cursor-pointer text-base font-bold leading-[1] transition-colors duration-150 hover:bg-red-100 shrink-0 w-[22px] h-[22px] flex items-center justify-center"
                        title="Remover"
                      >
                        <FaXmark style={{ fontSize: 10 }} />
                      </button>
                    </div>
                  ))}
                </div>
              )
            )}
          </>
        )}

        {/* Ações rápidas */}
        {sectionLabel("Ações rápidas")}
        <div className={navItemBaseClass} onClick={() => navigate('/registar-nao-conformidade')} title={collapsed ? "Registar Não Conformidade" : undefined}>
          <FaTriangleExclamation style={{ fontSize: 16, color: "var(--gold)", flexShrink: 0 }} /> {!collapsed && "Registar Não Conformidade"}
        </div>
        <div className={navItemBaseClass} onClick={() => navigate('/tratar-nao-conformidade')} title={collapsed ? "Tratar Não Conformidade" : undefined}>
          <FaArrowsRotate style={{ fontSize: 16, color: "var(--gold)", flexShrink: 0 }} /> {!collapsed && "Tratar Não Conformidade"}
        </div>

        {/* Administração  -  SuperAdmin e GestorRH veem tudo (exceto "Novo Processo", que
            é sobre documentação ISO e não tem nada a ver com colaboradores, por isso
            continua exclusivo do SuperAdmin); Administrador só as ações que se aplicam
            à sua própria entidade. */}
        {canManageUsers && (
          <>
            {sectionLabel("Administração")}
            <div
              className={navItemBaseClass}
              onClick={() => navigate('/create-user')}
              title={collapsed ? "Novo Utilizador" : undefined}
            >
              <FaUser style={{ fontSize: 16, color: "var(--gold)", flexShrink: 0 }} /> {!collapsed && "Novo Utilizador"}
            </div>
            {isAdminOrHR && (
              <div
                className={navItemBaseClass}
                onClick={() => navigate('/ponto/nova-entidade')}
                title={collapsed ? "Nova Entidade" : undefined}
              >
                <FaBuilding style={{ fontSize: 16, color: "var(--gold)", flexShrink: 0 }} /> {!collapsed && "Nova Entidade"}
              </div>
            )}
            {isSuperAdmin && (
              <div className={navItemBaseClass} onClick={() => navigate('/novo-processo')} title={collapsed ? "Novo Processo" : undefined}>
                <FaClipboardList style={{ fontSize: 16, color: "var(--gold)", flexShrink: 0 }} /> {!collapsed && "Novo Processo"}
              </div>
            )}
            <div
              className={navItemBaseClass}
              onClick={() => navigate(isAdminOrHR ? '/ponto/entidades' : `/ponto/entidades/${normalizeEntitySlug(entidadeNome)}`)}
              title={collapsed ? "Gerir Livro de Ponto" : undefined}
            >
              <FaClock style={{ fontSize: 16, color: "var(--gold)", flexShrink: 0 }} /> {!collapsed && "Gerir Livro de Ponto"}
            </div>
          </>
        )}

        </div>{/* end scrollable area */}

        {/* User pill / bottom */}
        <div className="px-2 py-3 border-t border-[#E8D0A0] shrink-0">
          <div
            className={`flex items-center gap-2 px-2.5 py-2 rounded-md ${collapsed ? 'justify-center px-0' : ''}`}
            title={collapsed ? (funcao ? `${username} · ${funcao}` : username) : undefined}
          >
            <UserAvatar nome={username} size={30} fontSize={11} />
            {!collapsed && (
              <div>
                <div className="text-xs text-[#4A2E08] font-semibold">{username}</div>
                {funcao && <div className="text-[10px] text-[#B8892A]">{funcao}</div>}
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
