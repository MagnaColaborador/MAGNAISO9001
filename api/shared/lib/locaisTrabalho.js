// Locais de trabalho (sedes) - fonte de verdade única do sistema. O valor guardado em
// users/{uid}.sede (campo "Local de trabalho" do Cadastro) e em salas/{id}.sede tem de ser
// um destes nomes. O frontend nunca mantém uma cópia: obtém a lista em
// GET /config/locais-trabalho (ver domains/config). Para acrescentar um local basta
// acrescentá-lo aqui.
//
// Atenção: os feriados municipais por sede (domains/timeTracking/holidays.js e o espelho
// em client/src/shared/utils/holidays.js) usam estes mesmos nomes como chave.
const LOCAIS_TRABALHO = [
  { nome: "Porto", morada: "Rua de S. Catarina 1498, 4000-448" },
  { nome: "Coimbra", morada: "R. Padre Estevão Cabral 72 2º, 3000-316" },
  { nome: "Paredes", morada: "Alameda Dr. José Cabral 71c, 4580-127 Paredes" },
  { nome: "Canedo", morada: "Rua Principal 1508, 4525-189 Canedo" },
  { nome: "Abrantes", morada: "Praça Raimundo José Soares Mendes, Nº 21, 2200-366" },
  { nome: "Vila Nova de Gaia", morada: "Av. Dr. Moreira Sousa 593H, 4415-383" },
];

const LOCAL_OPTIONS = LOCAIS_TRABALHO.map((l) => l.nome);

function isLocalTrabalhoValido(nome) {
  return typeof nome === "string" && LOCAL_OPTIONS.includes(nome);
}

module.exports = { LOCAIS_TRABALHO, LOCAL_OPTIONS, isLocalTrabalhoValido };
