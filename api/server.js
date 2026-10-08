require("dotenv").config();
const http = require("http");
const express = require("express");
const cors = require("cors");
const db = require("./shared/db/firebase");
const { attachChatWebSocket } = require("./domains/chat/chatServer");
const userRoute = require("./domains/users/userRoutes");
const pdfRoute = require("./domains/files/pdfRoutes");
const assistantRoute = require("./domains/assistant/assistantRoutes");
const timeTrackingRoute = require("./domains/timeTracking/timeTrackingRoutes");
const entityRoute = require("./domains/entities/entityRoutes");
const cadastroRoute = require("./domains/cadastro/cadastroRoutes");
const salarioRoute = require("./domains/salario/salarioRoutes");
const parametrosSalarioRoute = require("./domains/parametrosSalario/parametrosSalarioRoutes");
const formacaoRoute = require("./domains/formacao/formacaoRoutes");
const chatRoute = require("./domains/chat/chatRoutes");
const medicinaTrabalhoRoute = require("./domains/medicinaTrabalho/medicinaTrabalhoRoutes");
const premiosRoute = require("./domains/premios/premiosRoutes");
const konamiWordleRoute = require("./domains/konamiWordle/konamiWordleRoutes");
const fechoMensalRoute = require("./domains/fechoMensal/fechoMensalRoutes");
const naoConformidadeRoute = require("./domains/naoConformidade/naoConformidadeRoutes");
const deslocacoesRoute = require("./domains/deslocacoes/deslocacoesRoutes");
const salasRoute = require("./domains/salas/salasRoutes");
const configRoute = require("./domains/config/configRoutes");
const { startSchedulers } = require("./shared/services/scheduler");

const app = express();
app.use(express.json());
app.use(cors());

// Endpoint de teste. "commit" (RENDER_GIT_COMMIT, definido pelo Render) diz que versão está
// no ar - dá para saber quando um deploy terminou (ex: antes de correr um script de migração).
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Servidor a funcionar!', commit: process.env.RENDER_GIT_COMMIT || null });
});

app.use("/users", userRoute);
app.use("/files", pdfRoute);
app.use("/api/assistant", assistantRoute);
app.use("/timetracking", timeTrackingRoute);
app.use("/entities", entityRoute);
app.use("/cadastro", cadastroRoute);
app.use("/salario", salarioRoute);
app.use("/parametros-salario", parametrosSalarioRoute);
app.use("/formacao", formacaoRoute);
app.use("/chat", chatRoute);
app.use("/medicina-trabalho", medicinaTrabalhoRoute);
app.use("/premios", premiosRoute);
app.use("/konami-wordle", konamiWordleRoute);
app.use("/fecho-mensal", fechoMensalRoute);
app.use("/nao-conformidades", naoConformidadeRoute);
app.use("/deslocacoes", deslocacoesRoute);
app.use("/reservas-salas", salasRoute);
app.use("/config", configRoute);


const server = http.createServer(app);
attachChatWebSocket(server);
startSchedulers();

const PORT = process.env.PORT || 1080;
server.listen(PORT, '0.0.0.0', () => console.log(`Servidor aberto na porta ${PORT}`));