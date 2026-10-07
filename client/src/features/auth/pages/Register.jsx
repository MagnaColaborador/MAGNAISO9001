import React, { useContext, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useNavigate } from "react-router-dom";
import Sidebar from '../../../shared/components/Sidebar';
import Topbar from '../../../shared/components/Topbar';
import { FaEye, FaEyeSlash, FaCircleExclamation } from "react-icons/fa6";
import { apiFetch } from '../../../shared/utils/apiFetch';
import { UserContext } from '../../../shared/context/userContext';
import AutocompleteInput from '../../../shared/components/AutocompleteInput';
import WelcomeEmailTestModal from '../components/WelcomeEmailTestModal';
import { FUNCAO } from '../../../shared/utils/formOptions';
import { usePermissions } from '../../../shared/hooks/usePermissions';

const Register = () => {
    const { entidadeNome: actorEntidadeNome, entidadesGeridasNomes, userEmail } = useContext(UserContext);
    // Um Administrador só pode criar colaboradores dentro de uma entidade que gere e
    // nunca pode atribuir um nível de acesso igual ou superior ao seu  -  o backend
    // também impõe isto, mas mantemos o formulário coerente com o que vai ser aceite.
    // SuperAdmin escolhe qualquer nível de acesso; GestorRH só pode criar Colaborador
    // ou Administrador (nunca GestorRH/GestorFinanceiro/SuperAdmin, esses continuam
    // exclusivos do SuperAdmin)  -  o backend também impõe isto (normalizeNivelAcessoForActor).
    const { isAdministrador, isSuperAdmin, isGestorRH: isHR } = usePermissions();
    // Caso raro de um Administrador que gere mais do que uma entidade: em vez de
    // bloquear o campo numa só, deixa escolher entre as que gere (ver
    // entidadesGeridasPor no backend).
    const isMultiEntidadeAdministrador = isAdministrador && entidadesGeridasNomes.length > 1;

    const [nome, setNome] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [role, setRole] = useState('');
    const [nivelAcesso, setNivelAcesso] = useState('Colaborador');
    const [entidade, setEntidade] = useState(isAdministrador ? (actorEntidadeNome || '') : '');
    const [entidades, setEntidades] = useState([]);
    const [entidadesLoading, setEntidadesLoading] = useState(true);
    const [message, setMessage] = useState('');
    const [loading, setLoading] = useState(false);
    const [sendWelcomeEmail, setSendWelcomeEmail] = useState(true);
    const [showTestModal, setShowTestModal] = useState(false);
    const navigate = useNavigate();

    useEffect(() => {
        (async () => {
            setEntidadesLoading(true);
            try {
                const response = await apiFetch('/entities/showEntities', { method: 'POST' });
                if (!response.ok) throw new Error('Erro ao buscar entidades');
                const data = await response.json();
                const entityNames = Array.isArray(data) ? data : Object.values(data.entityNames || {});
                setEntidades(entityNames);
            } catch (error) {
                toast.error('Não foi possível carregar as entidades.');
            } finally {
                setEntidadesLoading(false);
            }
        })();
    }, []);

    // Um Administrador de mais do que uma entidade só pode escolher entre as que
    // gere; um Administrador comum (uma só entidade) continua a ver a sua própria
    // sempre incluída nas sugestões, mesmo que por algum motivo não venha na lista
    // carregada do backend (ver <select> antigo).
    const entidadeOptions = isMultiEntidadeAdministrador
        ? entidadesGeridasNomes
        : (isAdministrador && actorEntidadeNome && !entidades.includes(actorEntidadeNome)
            ? [actorEntidadeNome, ...entidades]
            : entidades);

    const handleSubmit = async (event) => {
        event.preventDefault();
        setMessage('');
        setLoading(true);

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            toast.error('Por favor, insira um e-mail válido.');
            setLoading(false);
            return;
        }

        if (password.length < 6) {
            toast.error('A password deve ter pelo menos 6 caracteres.');
            setLoading(false);
            return;
        }

        try {
            const response = await apiFetch('/timetracking/createUser', {
                method: 'POST',
                body: JSON.stringify({
                    nome,
                    email,
                    entidade,
                    role,
                    nivelAcesso,
                    temporaryPassword: password,
                    sendWelcomeEmail,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Erro ao criar utilizador');
            }

            const data = await response.json();
            if (data.welcomeEmailSent === false) {
                toast.warning('Conta criada, mas o email de boas-vindas não foi enviado.');
            } else if (data.welcomeEmailSent) {
                toast.success('Conta criada e email de boas-vindas enviado!');
            } else {
                toast.success('Conta criada com sucesso!');
            }
            setNome('');
            setEmail('');
            setPassword('');
            setRole('');
            setNivelAcesso('Colaborador');
            setEntidade(isAdministrador ? (actorEntidadeNome || '') : '');

            setTimeout(() => navigate('/dashboard'), 2000);
        } catch (error) {
            let errorMessage = 'Erro ao criar conta';
            if (error.message.includes('email-already-exists') || error.message.includes('Email já está em uso')) {
                errorMessage = 'Este e-mail já está em uso';
            } else if (error.message) {
                errorMessage = error.message;
            }
            setMessage(errorMessage);
            toast.error(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    const passwordStrength = password.length === 0 ? null
        : password.length < 6 ? 'fraca'
        : password.length < 10 ? 'média'
        : 'forte';

    const strengthColor = { fraca: '#dc2626', média: '#d97706', forte: '#16a34a' };
    const strengthWidth = { fraca: '33%', média: '66%', forte: '100%' };

    return (
        <div className="flex min-h-screen">
            <Sidebar onSelectFile={(path) => navigate(`/file/${path.replace(/\s/g, '-').replace(/\//g, '__')}`)} />

            <div className="ml-[var(--sidebar-w,230px)] transition-[margin-left] duration-200 flex-1 min-w-0 flex flex-col min-h-screen">
                <Topbar icon="👤" title="Criar Nova Conta" />

                <div className="p-6 flex-1">
                    <div style={{ maxWidth: 540, margin: '0 auto' }}>

                        <div className="bg-white border border-gray-200 rounded-[10px] p-6 mb-5">
                            <p className="text-[11px] font-bold text-[#4A2E08] uppercase tracking-[0.8px] m-0 mb-5 pb-3 border-b border-gray-100">Dados da Nova Conta</p>

                            {message && (
                                <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-[13px] mb-5">
                                    <FaCircleExclamation size={15} style={{ flexShrink: 0 }} />
                                    {message}
                                </div>
                            )}

                            <form onSubmit={handleSubmit}>
                                <div className="flex flex-col gap-1.5 mb-4 last:mb-0">
                                    <label htmlFor="reg-nome" className="text-[11px] font-bold text-gray-700 uppercase tracking-[0.7px]">Nome Completo</label>
                                    <input
                                        id="reg-nome"
                                        type="text"
                                        className="w-full px-[14px] py-2.5 border-[1.5px] border-gray-200 rounded-lg text-[14px] text-gray-900 bg-white box-border transition-all duration-200 focus:outline-none focus:border-[#C8932F] focus:shadow-[0_0_0_3px_rgba(200,147,47,0.1)] placeholder:text-[#c9d0d8]"
                                        value={nome}
                                        onChange={(e) => setNome(e.target.value)}
                                        placeholder="Nome completo do utilizador"
                                        autoComplete="name"
                                        required
                                    />
                                </div>

                                <div className="flex flex-col gap-1.5 mb-4 last:mb-0">
                                    <label htmlFor="reg-email" className="text-[11px] font-bold text-gray-700 uppercase tracking-[0.7px]">Email</label>
                                    <input
                                        id="reg-email"
                                        type="email"
                                        className="w-full px-[14px] py-2.5 border-[1.5px] border-gray-200 rounded-lg text-[14px] text-gray-900 bg-white box-border transition-all duration-200 focus:outline-none focus:border-[#C8932F] focus:shadow-[0_0_0_3px_rgba(200,147,47,0.1)] placeholder:text-[#c9d0d8]"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="utilizador@email.com"
                                        autoComplete="off"
                                        required
                                    />
                                </div>

                                <div className="flex flex-col gap-1.5 mb-4 last:mb-0">
                                    <label htmlFor="reg-password" className="text-[11px] font-bold text-gray-700 uppercase tracking-[0.7px]">Password Temporária</label>
                                    <div className="relative">
                                        <input
                                            id="reg-password"
                                            type={showPassword ? "text" : "password"}
                                            className="w-full px-[14px] py-2.5 border-[1.5px] border-gray-200 rounded-lg text-[14px] text-gray-900 bg-white box-border transition-all duration-200 focus:outline-none focus:border-[#C8932F] focus:shadow-[0_0_0_3px_rgba(200,147,47,0.1)] placeholder:text-[#c9d0d8]"
                                            style={{ paddingRight: 44 }}
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            placeholder="Mínimo 6 caracteres"
                                            autoComplete="new-password"
                                            minLength={6}
                                            required
                                        />
                                        <button
                                            type="button"
                                            className="absolute right-[13px] top-1/2 -translate-y-1/2 bg-transparent border-0 cursor-pointer p-1 rounded-md text-gray-400 flex items-center justify-center hover:text-[#C8932F]"
                                            onClick={() => setShowPassword(p => !p)}
                                            aria-label={showPassword ? "Ocultar password" : "Mostrar password"}
                                        >
                                            {showPassword ? <FaEyeSlash size={16} /> : <FaEye size={16} />}
                                        </button>
                                    </div>

                                    {passwordStrength && (
                                        <div style={{ marginTop: 6 }}>
                                            <div style={{ height: 4, background: '#f3f4f6', borderRadius: 4, overflow: 'hidden' }}>
                                                <div style={{
                                                    height: '100%',
                                                    width: strengthWidth[passwordStrength],
                                                    background: strengthColor[passwordStrength],
                                                    borderRadius: 4,
                                                    transition: 'width 0.3s, background 0.3s'
                                                }} />
                                            </div>
                                            <span style={{ fontSize: 11, color: strengthColor[passwordStrength], fontWeight: 600, marginTop: 3, display: 'block' }}>
                                                Força: {passwordStrength}
                                            </span>
                                        </div>
                                    )}
                                    <span className="text-[12px] text-gray-400">O utilizador será obrigado a alterar a password no primeiro acesso.</span>
                                </div>

                                <div className="flex flex-col gap-1.5 mb-4 last:mb-0">
                                    <label htmlFor="reg-role" className="text-[11px] font-bold text-gray-700 uppercase tracking-[0.7px]">Função</label>
                                    <AutocompleteInput
                                        id="reg-role"
                                        className="w-full px-[14px] py-2.5 border-[1.5px] border-gray-200 rounded-lg text-[14px] text-gray-900 bg-white box-border transition-all duration-200 focus:outline-none focus:border-[#C8932F] focus:shadow-[0_0_0_3px_rgba(200,147,47,0.1)] placeholder:text-[#c9d0d8]"
                                        value={role}
                                        onChange={setRole}
                                        options={FUNCAO}
                                        placeholder="Ex: Colaborador Administrativo"
                                        required
                                    />
                                </div>

                                {(isSuperAdmin || isHR) && (
                                    <div className="flex flex-col gap-1.5 mb-4 last:mb-0">
                                        <label htmlFor="reg-nivelAcesso" className="text-[11px] font-bold text-gray-700 uppercase tracking-[0.7px]">Nível de Acesso</label>
                                        <select
                                            id="reg-nivelAcesso"
                                            className="w-full px-[14px] py-2.5 border-[1.5px] border-gray-200 rounded-lg text-[14px] text-gray-900 bg-white box-border transition-all duration-200 focus:outline-none focus:border-[#C8932F] focus:shadow-[0_0_0_3px_rgba(200,147,47,0.1)]"
                                            value={nivelAcesso}
                                            onChange={(e) => setNivelAcesso(e.target.value)}
                                            required
                                        >
                                            <option value="Colaborador">Colaborador</option>
                                            {/* GestorRH pode atribuir GestorFinanceiro (área diferente da sua) mas nunca
                                                Administrador (só o SuperAdmin promove a esse nível) - ver
                                                normalizeNivelAcessoForActor em userManagementController.js. */}
                                            {isHR && <option value="GestorFinanceiro">Gestor(a) Financeiro</option>}
                                            {isSuperAdmin && (
                                                <>
                                                    <option value="Administrador">Administrador</option>
                                                    <option value="GestorRH">Gestor(a) de Recursos Humanos</option>
                                                    <option value="GestorFinanceiro">Gestor(a) Financeiro</option>
                                                    <option value="SuperAdmin">SuperAdmin</option>
                                                </>
                                            )}
                                        </select>
                                    </div>
                                )}

                                <div className="flex flex-col gap-1.5 mb-4 last:mb-0">
                                    <label htmlFor="reg-entidade" className="text-[11px] font-bold text-gray-700 uppercase tracking-[0.7px]">Entidade</label>
                                    <AutocompleteInput
                                        id="reg-entidade"
                                        className="w-full px-[14px] py-2.5 border-[1.5px] border-gray-200 rounded-lg text-[14px] text-gray-900 bg-white box-border transition-all duration-200 focus:outline-none focus:border-[#C8932F] focus:shadow-[0_0_0_3px_rgba(200,147,47,0.1)] disabled:cursor-not-allowed disabled:opacity-70"
                                        value={entidade}
                                        onChange={setEntidade}
                                        options={entidadeOptions}
                                        placeholder={entidadesLoading ? 'A carregar entidades...' : 'Escreve ou seleciona uma entidade'}
                                        disabled={(isAdministrador && !isMultiEntidadeAdministrador) || entidadesLoading}
                                        required
                                    />
                                    {isAdministrador && (
                                        <span className="text-[12px] text-gray-400">
                                            {isMultiEntidadeAdministrador
                                                ? 'Escolhe a entidade (uma das que administras) para este colaborador.'
                                                : 'Como Administrador, só podes criar colaboradores na tua própria entidade.'}
                                        </span>
                                    )}
                                </div>

                                <div className="flex flex-col gap-1.5 mb-4 last:mb-0">
                                    <span className="text-[11px] font-bold text-gray-700 uppercase tracking-[0.7px]">Email de Boas-vindas</span>
                                    <label htmlFor="reg-welcome" className="flex items-center gap-2 text-[13px] text-gray-700 cursor-pointer">
                                        <input
                                            id="reg-welcome"
                                            type="checkbox"
                                            className="w-4 h-4 accent-[#C8932F] cursor-pointer"
                                            checked={sendWelcomeEmail}
                                            onChange={(e) => setSendWelcomeEmail(e.target.checked)}
                                        />
                                        Enviar ao colaborador, com o email de acesso e a password temporária
                                    </label>
                                    {/* Teste só para SuperAdmin - o backend também o restringe (requireAdmin). */}
                                    {isSuperAdmin && (
                                        <button
                                            type="button"
                                            className="self-start mt-1 px-4 py-2 bg-white text-[#9C7A2E] border-[1.5px] border-[#e8d0a0] rounded-lg text-[13px] font-semibold cursor-pointer transition-all duration-150 hover:bg-[#fffbf0] hover:border-[#C8932F] max-sm:w-full"
                                            onClick={() => setShowTestModal(true)}
                                        >
                                            Testar email de boas-vindas…
                                        </button>
                                    )}
                                </div>

                                <div className="flex gap-3 justify-end py-1 pb-2 max-sm:flex-col-reverse" style={{ marginTop: 8 }}>
                                    <button
                                        type="button"
                                        className="px-6 py-[11px] bg-white text-gray-500 border-[1.5px] border-gray-200 rounded-lg text-[14px] font-semibold cursor-pointer transition-all duration-150 hover:bg-gray-50 hover:border-gray-300 max-sm:w-full max-sm:justify-center"
                                        onClick={() => navigate('/dashboard')}
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        type="submit"
                                        className="px-7 py-[11px] bg-gradient-to-br from-[#C8932F] to-[#DFA847] text-white border-0 rounded-lg text-[14px] font-bold cursor-pointer tracking-[0.4px] flex items-center gap-2 shadow-[0_3px_12px_rgba(200,147,47,0.28)] transition-all duration-200 hover:enabled:opacity-[.92] hover:enabled:-translate-y-px disabled:opacity-60 disabled:cursor-not-allowed disabled:shadow-none max-sm:w-full max-sm:justify-center"
                                        disabled={loading}
                                    >
                                        {loading
                                            ? <><span className="inline-block w-[15px] h-[15px] border-2 border-white/35 border-t-white rounded-full animate-spin" /> A criar...</>
                                            : 'Criar Conta'}
                                    </button>
                                </div>
                            </form>
                        </div>

                        <div className="bg-white border border-gray-200 rounded-[10px] p-6 mb-5" style={{ background: '#fffbf0', borderColor: '#e8d0a0' }}>
                            <p style={{ margin: 0, fontSize: 13, color: '#7a5010', lineHeight: 1.7 }}>
                                <strong>Nota:</strong> A conta é criada com a password temporária definida acima.
                                O utilizador terá de alterar a password no primeiro login antes de aceder ao sistema.
                            </p>
                        </div>

                    </div>
                </div>
            </div>

            {/* Fora do <form> de criação: o modal tem o seu próprio form, e o Enter lá dentro
                só pode enviar o teste, nunca criar a conta. */}
            {isSuperAdmin && showTestModal && (
                <WelcomeEmailTestModal
                    initialData={{ nome, email, password, entidade }}
                    entidadeOptions={entidadeOptions}
                    defaultTo={userEmail}
                    onClose={() => setShowTestModal(false)}
                />
            )}
        </div>
    );
};

export default Register;
