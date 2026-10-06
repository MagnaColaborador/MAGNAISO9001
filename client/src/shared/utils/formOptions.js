// Listas de opções estáticas partilhadas entre formulários (Cadastro e outros que venham
// a precisar dos mesmos valores  -  situação conjugal, tipo de contrato, departamento, etc.).

export const SITUACAO_CONJUGAL_OPTIONS = ["Não Casado(a)", "Casado(a)", "Casado(a) 1 titular", "Casado(a) 2 titulares", "Viúvo(a)", "Divorciado(a)",];
export const GRAU_PARENTESCO_OPTIONS = ["Cônjuge/Companheiro(a)", "Pai", "Mãe", "Filho(a)", "Irmão(ã)", "Avô/Avó", "Amigo(a)", "Outro"];
// Escalões do IRS Jovem (reforma OE2025, 10 anos de isenção).
export const IRS_JOVEM_OPTIONS = [
  "1º ano - 100% de isenção",
  "2º ano ao 4º ano - 75% de isenção",
  "5º ao 7º ano - 50% de isenção",
  "8º ao 9º ano - 25% de isenção",
];
export const TIPO_CONTRATO_OPTIONS = [
  "Contrato sem termo", "Contrato a termo certo", "Contrato a termo incerto",
  "Prestação de serviços", "Outro",
];
export const SITUACAO_CONTRATUAL_OPTIONS = ["Ativo", "Suspenso", "Cessado", "Reformado"];
export const DEPARTAMENTO_OPTIONS = ["Formação", "Financeiro", "Marketing", "Informática", "Centro Qualifica", "Recursos Humanos"];
export const TIPO_BAIXA_OPTIONS = [
  "Baixa médica",
  "Baixa por luto",
  "Licença parental inicial (120 ou 150 dias) - partilhável entre a mãe e o pai",
  "Licença parental inicial exclusiva do pai - período obrigatório e período facultativo",
  "Licença parental exclusiva da mãe - 6 semanas obrigatórias a seguir ao parto",
  "Licença por risco clínico durante a gravidez",
  "Licença por interrupção da gravidez",
  "Licença parental complementar (após a inicial, para prolongar o acompanhamento do filho)",
  "Licença para assistência a filho (até aos 12 anos, ou sem limite de idade em caso de deficiência/doença crónica)",
  "Licença para assistência a neto",
  "Licença para adoção",
  "Licença sem vencimento",
];
export const SITUACAO_CESSADO = "Cessado";
export const MOTIVO_CESSACAO_OPTIONS = [
  "Caducidade do contrato (fim do termo)",
  "Rescisão por iniciativa do trabalhador (demissão)",
  "Rescisão por iniciativa da entidade empregadora",
  "Despedimento por justa causa",
  "Despedimento coletivo / extinção do posto de trabalho",
  "Mútuo acordo (revogação por acordo)",
  "Período experimental - cessação durante o período",
  "Reforma",
  "Falecimento",
];
// Locais de trabalho (LOCAL_OPTIONS/moradas) já não vivem aqui: a fonte de verdade é o
// backend (api/shared/lib/locaisTrabalho.js), obtida com o hook useLocaisTrabalho.
export const TIPO_CONTRATO_SEM_TERMO = "Contrato sem termo";
export const TIPO_ESTAGIO_OPTIONS = ["Profissional", "Curricular"];
export const TIPO_ESTAGIO_PROFISSIONAL = "Profissional";
export const HABILITACOES_OPTIONS = [
  "Sem escolaridade",
  "Ensino Básico - 1º Ciclo (4º ano)",
  "Ensino Básico - 2º Ciclo (6º ano)",
  "Ensino Básico - 3º Ciclo (9º ano)",
  "Ensino Secundário (12º ano)",
  "Curso Profissional (Nível 4)",
  "Curso Técnico Superior Profissional (CTeSP)",
  "Bacharelato",
  "Licenciatura",
  "Pós-Graduação",
  "Mestrado",
  "Doutoramento",
];

export const FUNCAO = [
  "Diretor(a) do Departamento de Projetos",
  "Diretor(a) do Departamento de Formação",
  "Gestor(a) de Projeto",
  "Gestor(a) de RH",
  "Gestor(a) Financeiro",
  "Gestor(a) de Comunicação Marketing",
  "Gestor(a) de Informática",
  "Gestor(a) de Centro Qualifica",
  "Economista",
  "Psicóloga / TORVC - Técnico de Orientação, Reconhecimento e Validação de Competências",
  "Coordenador(a) Pedagógico(a)",
  "Mediador EFA",
  "Designer de Comunicação",
  "Técnico(a) de Administrativa",
  "Técnico(a) de Programação",
];
