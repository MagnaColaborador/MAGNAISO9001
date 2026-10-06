import React, { useContext } from "react";
import Login from './features/auth/pages/Login';
import ProtectedRoute from './features/auth/components/ProtectedRoute';
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import DashboardPage from "./features/dashboard/pages/Dashboard";
import TablePage from "./features/cadastro/pages/EditorProcedimentos";
import CreateProcess from "./features/cadastro/pages/NovoProcesso";
import CreateProcedimento from "./features/cadastro/pages/NovoProcedimento";
import Register from "./features/auth/pages/Register";
import { UserContext } from "./shared/context/userContext";
import { TutorialProvider } from "./shared/context/tutorialContext";
import NewTable from "./features/cadastro/pages/NovoProcedimento"
import Cadastro from "./features/cadastro/pages/Cadastro"
import Colaboradores from "./features/cadastro/pages/Colaboradores"
import MapaFerias from "./features/mapaFerias/pages/MapaFerias"
import FechoMensalAdmin from "./features/timeTracking/pages/FechoMensalAdmin"
import ProcessamentoSalarios from "./features/salario/ProcessamentoSalarios"
import SalarioColaborador from "./features/salario/SalarioColaborador"
import PlanoFormacao from "./features/formacao/PlanoFormacao"
import FormacaoColaborador from "./features/formacao/FormacaoColaborador"
import MedicinaTrabalho from "./features/medicinaTrabalho/MedicinaTrabalho"
import MedicinaTrabalhoColaborador from "./features/medicinaTrabalho/MedicinaTrabalhoColaborador"
import Premios from "./features/premios/Premios"
import PremiosColaborador from "./features/premios/PremiosColaborador"
import Chat from "./features/chat/pages/Chat"
import FirstLogin from "./features/auth/pages/FirstLogin";
import { ToastContainer } from "react-toastify";
import 'react-toastify/dist/ReactToastify.css';
import TimeTrackingRegistos from "./features/timeTracking/pages/RegistosPage";
import TimeTrackingEntities from "./features/timeTracking/pages/EntitiesPage";
import TimeTrackingEntityUsers from "./features/timeTracking/pages/EntityUsers";
import TimeTrackingUserDetails from "./features/timeTracking/pages/UserDetails";
import NewEntity from "./features/timeTracking/pages/NewEntity";
import RegistoNaoConformidade from "./features/naoConformidade/RegistoNaoConformidade";
import TratarNaoConformidade from "./features/naoConformidade/TratamentoNaoConformidade";
import MaintenancePage from "./shared/components/MaintenancePage";
import RequisicaoSalas from "./features/requisicaoSalas/RequisicaoSalas";

function App() {
  const navigate = useNavigate();
  const { setUsername, setUserEmail, setUserRole, setIsAuthenticated, isAuthenticated } = useContext(UserContext);

  const handleLoginSuccess = (userData, destination = "/ponto") => {
    setUsername(userData.nome);
    setUserEmail(userData.email);
    setUserRole(userData.role);
    setIsAuthenticated(true);
    navigate(destination);
  };

  return (
    <TutorialProvider>
      <Routes>
        {/* Rota pública de login */}
        <Route
          path="/"
          element={
            isAuthenticated ?
              <Navigate to="/ponto" replace /> :
              <Login onLoginSuccess={handleLoginSuccess} />
          }
        />
        
        {/* Rotas protegidas */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/file/:filename" 
          element={
            <ProtectedRoute>
              <TablePage />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/table/:filename" 
          element={
            <ProtectedRoute>
              <TablePage />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/novo-procedimento" 
          element={
            <ProtectedRoute>
              <CreateProcedimento />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/create-user" 
          element={
            <ProtectedRoute>
              <Register />
            </ProtectedRoute>
          } 
        />
        <Route
          path="/novo-processo"
          element={
            <ProtectedRoute>
              <CreateProcess />
            </ProtectedRoute>
          }
        />
        <Route
          path="/newtable"
          element={
            <ProtectedRoute>
              <NewTable />
            </ProtectedRoute>
          } 
        />
        <Route
          path="/cadastro"
          element={
            <ProtectedRoute>
              <Cadastro />
            </ProtectedRoute>
          }
        />
        <Route
          path="/cadastro/:id"
          element={
            <ProtectedRoute>
              <Cadastro />
            </ProtectedRoute>
          }
        />
        <Route
          path="/colaboradores"
          element={
            <ProtectedRoute>
              <Colaboradores />
            </ProtectedRoute>
          }
        />
        <Route
          path="/ferias"
          element={
            <ProtectedRoute>
              <MapaFerias />
            </ProtectedRoute>
          }
        />
        <Route
          path="/fecho-mensal"
          element={
            <ProtectedRoute>
              <FechoMensalAdmin />
            </ProtectedRoute>
          }
        />
        <Route
          path="/salarios"
          element={
            <ProtectedRoute>
              <ProcessamentoSalarios />
            </ProtectedRoute>
          }
        />
        <Route
          path="/salarios/:id"
          element={
            <ProtectedRoute>
              <SalarioColaborador />
            </ProtectedRoute>
          }
        />
        <Route
          path="/plano-formacao"
          element={
            <ProtectedRoute>
              <PlanoFormacao />
            </ProtectedRoute>
          }
        />
        <Route
          path="/plano-formacao/:id"
          element={
            <ProtectedRoute>
              <FormacaoColaborador />
            </ProtectedRoute>
          }
        />
        <Route
          path="/medicina-trabalho"
          element={
            <ProtectedRoute>
              <MedicinaTrabalho />
            </ProtectedRoute>
          }
        />
        <Route
          path="/medicina-trabalho/:id"
          element={
            <ProtectedRoute>
              <MedicinaTrabalhoColaborador />
            </ProtectedRoute>
          }
        />
        <Route
          path="/premios"
          element={
            <ProtectedRoute>
              <Premios />
            </ProtectedRoute>
          }
        />
        <Route
          path="/premios/:id"
          element={
            <ProtectedRoute>
              <PremiosColaborador />
            </ProtectedRoute>
          }
        />
        <Route
          path="/chat"
          element={
            <ProtectedRoute>
              <Chat />
            </ProtectedRoute>
          }
        />
        <Route
          path="/chat/:colaboradorId"
          element={
            <ProtectedRoute>
              <Chat />
            </ProtectedRoute>
          }
        />
        <Route
          path="/registar-nao-conformidade"
          element={
            <ProtectedRoute>
              <RegistoNaoConformidade />
            </ProtectedRoute>
          }
        />
        <Route
          path="/tratar-nao-conformidade"
          element={
            <ProtectedRoute>
              <TratarNaoConformidade />
            </ProtectedRoute>
          }
        />
        <Route
          path="/tratar-nao-conformidade/:id"
          element={
            <ProtectedRoute>
              <TratarNaoConformidade />
            </ProtectedRoute>
          }
        />
        {/* Gestão de Infraestruturas - o Cadastro de Equipamentos ainda não tem página
            própria e abre a página de manutenção (ver INFRASTRUCTURE_ITEMS no Sidebar). */}
        <Route
          path="/equipamentos"
          element={
            <ProtectedRoute>
              <MaintenancePage title="Cadastro de Equipamentos" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/requisicao-salas"
          element={
            <ProtectedRoute>
              <MaintenancePage title="Requisição de Salas" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reset-password"
          element={<FirstLogin mode="firstLogin" />}
        />
        <Route
          path="/forgot-password"
          element={<FirstLogin mode="forgot" />}
        />

        {/* Livro de Ponto */}
        <Route
          path="/ponto"
          element={
            <ProtectedRoute>
              <TimeTrackingRegistos />
            </ProtectedRoute>
          }
        />
        <Route path="/ponto/registos" element={<Navigate to="/ponto" replace />} />
        <Route
          path="/ponto/entidades"
          element={
            <ProtectedRoute>
              <TimeTrackingEntities />
            </ProtectedRoute>
          }
        />
        <Route
          path="/ponto/entidades/:id_entidade"
          element={
            <ProtectedRoute>
              <TimeTrackingEntityUsers />
            </ProtectedRoute>
          }
        />
        <Route
          path="/ponto/nova-entidade"
          element={
            <ProtectedRoute>
              <NewEntity />
            </ProtectedRoute>
          }
        />
        <Route
          path="/ponto/user-details/:uid"
          element={
            <ProtectedRoute>
              <TimeTrackingUserDetails />
            </ProtectedRoute>
          }
        />
      </Routes>
      <ToastContainer 
        position="top-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
      />
    </TutorialProvider>
  );
};

export default App;
