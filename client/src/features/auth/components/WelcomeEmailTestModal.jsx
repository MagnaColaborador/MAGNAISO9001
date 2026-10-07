import React, { useState } from 'react';
import { toast } from 'react-toastify';
import { apiFetch } from '../../../shared/utils/apiFetch';
import AutocompleteInput from '../../../shared/components/AutocompleteInput';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inputClass = "w-full px-[14px] py-2.5 border-[1.5px] border-gray-200 rounded-lg text-[14px] text-gray-900 bg-white box-border transition-all duration-200 focus:outline-none focus:border-[#C8932F] focus:shadow-[0_0_0_3px_rgba(200,147,47,0.1)] placeholder:text-[#c9d0d8]";
const labelClass = "text-[11px] font-bold text-gray-700 uppercase tracking-[0.7px]";

// Envia o email de boas-vindas com dados à escolha para um endereço de teste, para ver
// como fica antes de criar a conta. Não cria nem altera contas, por isso aceita qualquer
// dado - incluindo o email de uma conta que já exista.
const WelcomeEmailTestModal = ({ initialData, entidadeOptions, defaultTo, onClose }) => {
    const [to, setTo] = useState(defaultTo || '');
    const [nome, setNome] = useState(initialData.nome || '');
    const [email, setEmail] = useState(initialData.email || '');
    const [password, setPassword] = useState(initialData.password || '');
    const [entidade, setEntidade] = useState(initialData.entidade || '');
    const [sending, setSending] = useState(false);

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (!EMAIL_REGEX.test(to)) {
            toast.error('Indica um email de destino válido para o teste.');
            return;
        }
        setSending(true);
        try {
            const response = await apiFetch('/timetracking/welcomeEmail/test', {
                method: 'POST',
                body: JSON.stringify({ to, nome, email, password, entidade }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Erro ao enviar o email de teste');
            toast.success(data.message || `Email de teste enviado para ${to}`);
        } catch (error) {
            toast.error(error.message || 'Erro ao enviar o email de teste');
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/40 flex justify-center items-center z-[1000] p-4" onClick={onClose}>
            <div className="bg-white rounded-xl w-full max-w-[480px] max-h-[90vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
                <div className="px-6 pt-5 pb-3 border-b border-gray-100">
                    <p className="text-[15px] font-bold text-gray-900 m-0">Testar email de boas-vindas</p>
                    <p className="text-[12px] text-gray-400 m-0 mt-1">
                        Preenche os dados como se fosse o colaborador e envia para o teu email. Não cria nem altera nenhuma conta - podes usar os dados de uma conta que já exista.
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="px-6 py-5">
                    <div className="flex flex-col gap-1.5 mb-4">
                        <label htmlFor="test-to" className={labelClass}>Enviar teste para</label>
                        <input id="test-to" type="email" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} placeholder="email@para-teste.com" autoComplete="off" required />
                    </div>

                    <p className="text-[11px] font-bold text-[#4A2E08] uppercase tracking-[0.8px] m-0 mb-3 pt-1">Conteúdo do email</p>

                    <div className="flex flex-col gap-1.5 mb-4">
                        <label htmlFor="test-nome" className={labelClass}>Nome</label>
                        <input id="test-nome" type="text" className={inputClass} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do Colaborador" autoComplete="off" />
                    </div>

                    <div className="flex flex-col gap-1.5 mb-4">
                        <label htmlFor="test-email" className={labelClass}>Email de acesso</label>
                        <input id="test-email" type="text" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colaborador@exemplo.pt" autoComplete="off" />
                    </div>

                    <div className="flex flex-col gap-1.5 mb-4">
                        <label htmlFor="test-password" className={labelClass}>Password temporária</label>
                        <input id="test-password" type="text" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Vazio = aparece oculta (••••••••)" autoComplete="off" />
                    </div>

                    <div className="flex flex-col gap-1.5 mb-5">
                        <label htmlFor="test-entidade" className={labelClass}>Entidade</label>
                        <AutocompleteInput
                            id="test-entidade"
                            className={inputClass}
                            value={entidade}
                            onChange={setEntidade}
                            options={entidadeOptions}
                            placeholder="Define o logo e o nome da entidade no email"
                        />
                    </div>

                    <div className="flex gap-3 justify-end max-sm:flex-col-reverse">
                        <button
                            type="button"
                            className="px-5 py-2.5 bg-white text-gray-500 border-[1.5px] border-gray-200 rounded-lg text-[14px] font-semibold cursor-pointer hover:bg-gray-50 hover:border-gray-300"
                            onClick={onClose}
                        >
                            Fechar
                        </button>
                        <button
                            type="submit"
                            className="px-6 py-2.5 bg-gradient-to-br from-[#C8932F] to-[#DFA847] text-white border-0 rounded-lg text-[14px] font-bold cursor-pointer flex items-center justify-center gap-2 shadow-[0_3px_12px_rgba(200,147,47,0.28)] hover:enabled:opacity-[.92] disabled:opacity-60 disabled:cursor-not-allowed disabled:shadow-none"
                            disabled={sending}
                        >
                            {sending
                                ? <><span className="inline-block w-[14px] h-[14px] border-2 border-white/35 border-t-white rounded-full animate-spin" /> A enviar...</>
                                : 'Enviar teste'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default WelcomeEmailTestModal;
