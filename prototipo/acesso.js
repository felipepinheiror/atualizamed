// Fase de testes: chave de acesso, abas, Feedback, avaliação das aulas e Painel do desenvolvedor.
let sessao = null; // { id, nome, papel: "dev" | "testador" }

// Qualquer resposta 401 de /api/ (sessão expirada ou chave desativada) leva de volta à tela de entrada.
const _fetchOriginal = window.fetch.bind(window);
window.fetch = async (url, opcoes) => {
  const r = await _fetchOriginal(url, opcoes);
  const caminho = String(url);
  if (r.status === 401 && caminho.startsWith("/api/") && !/\/api\/(sessao|entrar)/.test(caminho) && sessao) {
    sessao = null;
    telaEntrar("A sua sessão terminou. Entre de novo com a sua chave.");
  }
  return r;
};

function registrarEvento(tipo, dados = {}) {
  // keepalive: o evento chega mesmo se o app for fechado logo em seguida.
  fetch("/api/evento", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo, dados }) }).catch(() => {});
}

let timerPerfil;
function enviarPerfilDepois() {
  if (!sessao) return;
  clearTimeout(timerPerfil);
  timerPerfil = setTimeout(() => {
    fetch("/api/perfil", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ perfil: { ...perfil, carreiraTexto: carreiraTexto(), faseTexto: faseTexto(), objetivoTexto: objetivoTexto() }, descricao: IA.descreverPerfil(perfilIA()) }),
    }).catch(() => {});
  }, 1500);
}

// ---------- Abas ----------
function barraAbas(ativa) {
  const abas = [["casa", "Hoje"], ["chat", "Feedback"], ["pessoa", "Perfil"]];
  if (sessao?.papel === "dev") abas.push(["grafico", "Painel"]);
  return `<nav class="abas" aria-label="Navegação principal"><div class="grupo">
    ${abas.map(([ic, nome]) => `<button class="aba ${nome === ativa ? "ativa" : ""}" data-aba="${nome}" ${nome === ativa ? 'aria-current="page"' : ""}>${icone(ic, 22)}${nome}</button>`).join("")}
  </div></nav>`;
}
function ligarAbas() {
  app.querySelectorAll(".aba:not(.ativa)").forEach((b) => b.addEventListener("click", () => {
    ({ Hoje: () => telaPlano(), Feedback: telaFeedback, Perfil: abrirAjustes, Painel: telaPainel })[b.dataset.aba]?.();
  }));
}

// ---------- Entrada com a chave ----------
const CHAVE_JA_ENTROU = "atualizamed.ja-entrou";
const jaEntrouAntes = () => { try { return localStorage.getItem(CHAVE_JA_ENTROU) === "1"; } catch { return false; } };

async function telaEntrar(aviso = "", modo = null) {
  telaAtual = "entrar";
  let porNome = true;
  try { porNome = (await (await fetch("/api/config-entrada")).json()).entrarPorNome; } catch {}
  modo = modo || (porNome && jaEntrouAntes() ? "nome" : "chave");
  if (!porNome) modo = "chave";
  const ehNome = modo === "nome";
  app.innerHTML = `
    <div class="tela entrar">
      <div class="marca"><span class="logo">${icone("livro", 18)}</span>AtualizaMed</div>
      <div class="entrar-corpo">
        <span class="selo-teste">${icone("aberto", 14)} Fase de testes · acesso restrito</span>
        <h1 class="titulo-xl">${ehNome ? "Que bom te ver de novo" : "Digite a sua chave de acesso"}</h1>
        <p class="sub">${ehNome ? "Digite o seu nome, do jeito que você cadastrou no primeiro acesso."
          : "Você recebeu a chave pelo WhatsApp, junto com o link. Pode digitar com ou sem o traço. Só precisa dela no primeiro acesso em cada aparelho."}</p>
        <form id="form-entrar" class="form-entrar">
          ${ehNome
            ? `<input class="campo" id="nome-entrada" autocomplete="name" autocapitalize="words" placeholder="Seu nome" aria-label="Seu nome">`
            : `<input class="campo campo-chave" id="chave" type="text" inputmode="text" autocomplete="off" autocorrect="off"
                 autocapitalize="none" spellcheck="false" placeholder="ex.: bamo-tika" aria-label="Chave de acesso">`}
          <p class="msg-entrar" id="msg-entrar" role="alert">${esc(aviso)}</p>
          <button class="btn primario largo" id="btn-entrar">Entrar ${icone("seta")}</button>
        </form>
        ${porNome ? `<button class="link trocar-modo" id="trocar-modo">${ehNome ? "Primeiro acesso? Use a sua chave" : "Já entrei antes: entrar só com o meu nome"}</button>` : ""}
      </div>
    </div>`;
  document.getElementById("trocar-modo")?.addEventListener("click", () => telaEntrar("", ehNome ? "chave" : "nome"));
  const campo = document.getElementById(ehNome ? "nome-entrada" : "chave");
  // Sem reformatar enquanto digita (no celular isso embaralhava as letras): o servidor ignora traços, espaços e maiúsculas.
  campo.focus();
  document.getElementById("form-entrar").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = document.getElementById("msg-entrar");
    const botao = document.getElementById("btn-entrar");
    botao.disabled = true;
    msg.textContent = "Conferindo…";
    try {
      const r = await fetch(ehNome ? "/api/entrar-nome" : "/api/entrar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ehNome ? { nome: campo.value } : { chave: campo.value }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro || "Não foi possível entrar");
      sessao = d;
      try { localStorage.setItem(CHAVE_JA_ENTROU, "1"); } catch {}
      // Primeiro acesso de um testador: escolhe o nome para as próximas entradas.
      if (!ehNome && d.papel !== "dev" && !d.nomeLogin && porNome) return telaDefinirNome();
      toast(`Bem-vindo(a), ${(d.nomeLogin || d.nome).split(" ")[0]}!`);
      iniciarApp();
    } catch (err) {
      msg.textContent = err.message;
      botao.disabled = false;
    }
  });
}

function telaDefinirNome() {
  telaAtual = "definir-nome";
  app.innerHTML = `
    <div class="tela entrar">
      <div class="marca"><span class="logo">${icone("livro", 18)}</span>AtualizaMed</div>
      <div class="entrar-corpo">
        <span class="selo-teste">${icone("check", 14)} Chave confirmada</span>
        <h1 class="titulo-xl">Como você quer entrar das próximas vezes?</h1>
        <p class="sub">Da próxima vez, é só digitar este nome — sem a chave. Você continua conectado neste aparelho.</p>
        <form id="form-nome" class="form-entrar">
          <input class="campo" id="nome-login" autocomplete="name" autocapitalize="words" value="${esc(sessao.nome)}" aria-label="Seu nome">
          <p class="msg-entrar" id="msg-nome" role="alert"></p>
          <button class="btn primario largo">Salvar e continuar ${icone("seta")}</button>
        </form>
        <button class="link trocar-modo" id="pular-nome">Prefiro usar sempre a chave</button>
      </div>
    </div>`;
  document.getElementById("pular-nome").onclick = () => iniciarApp();
  document.getElementById("form-nome").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nome = document.getElementById("nome-login").value.trim();
    const r = await fetch("/api/definir-nome", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome }) });
    const d = await r.json();
    if (!r.ok) { document.getElementById("msg-nome").textContent = d.erro; return; }
    sessao.nomeLogin = nome;
    toast(`Pronto! Da próxima vez, entre como “${nome}”.`);
    iniciarApp();
  });
}

// ---------- Avaliação de cada aula ----------
const avaliadas = new Set();
function htmlAvaliacao() {
  if (!est) return "";
  if (avaliadas.has(est.a.id)) return `<div class="avaliar feito">${icone("check", 18)} Obrigado pela avaliação desta aula!</div>`;
  const grupoChips = (campo, opcoes) => `<div class="chips" data-campo="${campo}">${opcoes.map(([v, r]) => `<button class="chip" data-v="${v}">${icone("check", 16)}${r}</button>`).join("")}</div>`;
  return `
    <div class="avaliar" id="avaliar">
      <span class="rotulo">Como foi esta aula para você?</span>
      ${grupoChips("util", [["muito", "Muito útil"], ["sim", "Útil"], ["pouco", "Pouco útil"]])}
      ${grupoChips("nivel", [["basico", "Básico demais"], ["certo", "Na medida"], ["avancado", "Avançado demais"]])}
      <textarea class="campo area-texto curta" id="comentario-aula" rows="2" placeholder="Algum comentário? (opcional)"></textarea>
      <button class="btn secundario largo" id="enviar-avaliacao">Enviar avaliação</button>
    </div>`;
}
function ligarAvaliacao() {
  const caixa = document.getElementById("avaliar");
  if (!caixa) return;
  const escolha = {};
  caixa.querySelectorAll(".chips").forEach((g) => g.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => {
    g.querySelectorAll(".chip").forEach((x) => x.classList.toggle("sel", x === b));
    escolha[g.dataset.campo] = b.dataset.v;
  })));
  document.getElementById("enviar-avaliacao").onclick = () => {
    const comentario = document.getElementById("comentario-aula").value.trim();
    if (!escolha.util && !escolha.nivel && !comentario) return toast("Escolha uma opção ou escreva um comentário");
    registrarEvento("avaliacao_aula", { id: est.a.id, titulo: tituloDe(est.a), modo: est.a.modo, ...escolha, comentario: comentario.slice(0, 1000) });
    avaliadas.add(est.a.id);
    const aviso = { basico: "Anotado: as próximas aulas virão mais aprofundadas.", avancado: "Anotado: as próximas aulas virão mais explicadas." }[escolha.nivel];
    caixa.outerHTML = `<div class="avaliar feito">${icone("check", 18)} Obrigado pela avaliação desta aula!${aviso ? ` ${aviso}` : ""}</div>`;
  };
}

// ---------- Aba Feedback ----------
const AREAS_FEEDBACK = ["Escolha dos artigos", "Videoaula", "Narração", "Resumo", "Miniteste", "Dúvidas (chat)", "Cadastro inicial", "Visual", "Velocidade"];

function telaFeedback() {
  telaAtual = "feedback";
  const estado = { nota: null, areas: [] };
  app.innerHTML = `
    <div class="tela">
      <header class="hoje-topo"><div><p class="data">Fase de testes</p><h1 class="titulo-lg">Sua opinião</h1></div></header>
      <p class="sub" style="margin-top:0">É isso que vai decidir o que muda no app. Seja sincero — críticas ajudam mais que elogios.</p>
      <div class="bloco-feedback">
        <span class="rotulo">De 1 a 5, o quanto o app te ajudou até agora?</span>
        <div class="notas">${[1, 2, 3, 4, 5].map((n) => `<button class="nota" data-n="${n}">${n}</button>`).join("")}</div>
        <div class="notas-legenda"><span>Nada</span><span>Muito</span></div>
      </div>
      <div class="bloco-feedback">
        <span class="rotulo">Sobre o que é o seu comentário? (opcional)</span>
        <div class="chips" id="areas">${AREAS_FEEDBACK.map((a) => `<button class="chip" data-v="${esc(a)}">${icone("check", 16)}${esc(a)}</button>`).join("")}</div>
      </div>
      <label class="rotulo-campo" for="fb-gostou">O que você achou? Do que mais gostou?</label>
      <textarea class="campo area-texto" id="fb-gostou" rows="4"></textarea>
      <label class="rotulo-campo" for="fb-melhorar">O que pode melhorar?</label>
      <textarea class="campo area-texto" id="fb-melhorar" rows="4"></textarea>
      <label class="rotulo-campo" for="fb-erros">Viu alguma informação médica errada ou estranha?</label>
      <textarea class="campo area-texto" id="fb-erros" rows="3" placeholder="Diga qual aula e o que estava errado"></textarea>
      <button class="btn primario largo" id="enviar-feedback" style="margin-top:16px">Enviar feedback</button>
      <p class="dica" style="text-align:center">Pode enviar quantas vezes quiser, a qualquer momento.</p>
    </div>
    ${barraAbas("Feedback")}`;
  ligarAbas();
  app.querySelectorAll(".nota").forEach((b) => b.addEventListener("click", () => {
    estado.nota = Number(b.dataset.n);
    app.querySelectorAll(".nota").forEach((x) => x.classList.toggle("sel", x === b));
  }));
  app.querySelectorAll("#areas .chip").forEach((b) => b.addEventListener("click", () => {
    const v = b.dataset.v;
    estado.areas = estado.areas.includes(v) ? estado.areas.filter((x) => x !== v) : [...estado.areas, v];
    b.classList.toggle("sel");
  }));
  document.getElementById("enviar-feedback").onclick = async (e) => {
    const corpo = { ...estado, gostou: val("fb-gostou"), melhorar: val("fb-melhorar"), erros: val("fb-erros") };
    e.target.disabled = true;
    try {
      const r = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro);
      app.querySelector(".tela").innerHTML = `
        <div class="obrigado">
          <span class="ico-caixa grande">${icone("check", 28)}</span>
          <h1 class="titulo-lg">Muito obrigado!</h1>
          <p class="sub">O seu feedback foi enviado. Ele entra no próximo relatório e ajuda a decidir o que muda.</p>
          <button class="btn secundario largo" id="outro-feedback">Enviar outro</button>
        </div>`;
      document.getElementById("outro-feedback").onclick = telaFeedback;
    } catch (err) {
      toast(err.message || "Não foi possível enviar");
      e.target.disabled = false;
    }
  };
}
const val = (id) => document.getElementById(id).value.trim();

// ---------- Painel do desenvolvedor ----------
async function telaPainel() {
  telaAtual = "painel";
  app.innerHTML = `
    <div class="tela painel">
      <header class="hoje-topo"><div><p class="data">Desenvolvedor</p><h1 class="titulo-lg">Painel do teste</h1></div>
        <button class="btn-icone" id="atualizar-painel" aria-label="Atualizar">${icone("relogio")}</button></header>
      <div id="conteudo-painel"><div class="sk" style="height:120px"></div><div class="sk" style="height:220px;margin-top:12px"></div></div>
    </div>
    ${barraAbas("Painel")}`;
  ligarAbas();
  document.getElementById("atualizar-painel").onclick = telaPainel;
  try {
    const [d, relatorios] = await Promise.all([
      fetch("/api/admin/painel").then((r) => r.json()),
      fetch("/api/admin/relatorios").then((r) => r.json()),
    ]);
    desenharPainelDev(d, relatorios);
  } catch {
    document.getElementById("conteudo-painel").innerHTML = `<div class="vazio">Não foi possível carregar o painel.</div>`;
  }
}

const dataCurta = (ts) => (ts ? new Date(ts).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const NOMES_UTIL = { muito: "Muito útil", sim: "Útil", pouco: "Pouco útil" };
const NOMES_NIVEL = { basico: "Básico demais", certo: "Na medida", avancado: "Avançado demais" };

function desenharPainelDev(d, relatorios) {
  const testadores = d.pessoas.filter((p) => p.papel !== "dev");
  const hoje = hojeISO();
  const ativosHoje = testadores.filter((p) => p.ultimoAcesso?.startsWith(hoje)).length;
  const soma = (k) => testadores.reduce((t, p) => t + (p[k] || 0), 0);
  const comQuiz = testadores.filter((p) => p.acertoMedio !== null);
  const acerto = comQuiz.length ? Math.round(comQuiz.reduce((t, p) => t + p.acertoMedio, 0) / comQuiz.length) : null;
  const comOuvido = testadores.filter((p) => p.ouvidoMedio != null);
  const ouvido = comOuvido.length ? Math.round(comOuvido.reduce((t, p) => t + p.ouvidoMedio, 0) / comOuvido.length) : null;
  const notas = d.feedbacks.filter((f) => f.nota).map((f) => f.nota);
  const custo = d.pessoas.reduce((t, p) => t + (p.ia.custo_se_pago_usd || 0), 0);
  const url = d.urlPublica || location.origin;
  document.getElementById("conteudo-painel").innerHTML = `
    <div class="cartoes-numeros">
      ${[["Pessoas com acesso", testadores.filter((p) => p.ativo).length], ["Ativas hoje", ativosHoje], ["Aulas abertas", soma("aulas")],
         ["Vídeo ouvido (média)", ouvido !== null ? `${ouvido}%` : "—"],
         ["Minitestes", soma("quizzes") + (acerto !== null ? ` · ${acerto}%` : "")], ["Feedbacks", d.feedbacks.length + (notas.length ? ` · nota ${(notas.reduce((a, b) => a + b, 0) / notas.length).toFixed(1)}` : "")],
         ["IA (se fosse paga)", `US$ ${custo.toFixed(2)}`]].map(([r, v]) => `<div class="cartao-numero"><strong>${v}</strong><span>${r}</span></div>`).join("")}
    </div>

    <div class="secao"><h2>Entrada</h2></div>
    <div class="plano">
      <label class="interruptor"><input type="checkbox" id="entrar-por-nome" ${d.config?.entrarPorNome ? "checked" : ""}>
        <span><strong>Entrar só com o nome</strong><br><span class="dica">Depois de ativar com a chave, a pessoa entra digitando o nome. Desligue se notar algum acesso estranho; o seu acesso de desenvolvedor sempre exige a chave.</span></span></label>
    </div>

    <div class="secao"><h2>Convidar alguém</h2></div>
    <div class="plano">
      <p style="margin-top:0">Link do app: <strong class="quebra">${esc(url)}</strong></p>
      <form class="adicionar" id="form-convite">
        <input class="campo" id="nome-convidado" placeholder="Nome da pessoa" autocomplete="off">
        <button class="btn primario quadrado" aria-label="Criar chave">${icone("mais")}</button>
      </form>
      <div id="resultado-convite"></div>
    </div>

    <div class="secao"><h2>Pessoas</h2></div>
    <div class="lista">${d.pessoas.map((p) => `
      <div class="pessoa ${p.ativo ? "" : "inativa"}">
        <div class="pessoa-topo"><strong>${esc(p.nome)}</strong>${p.papel === "dev" ? `<span class="selo diretriz">Dev</span>` : ""}${p.ativo ? "" : `<span class="selo revisao">Sem acesso</span>`}</div>
        <p class="dica" style="margin:2px 0 8px">${esc(p.perfil || "Perfil ainda não preenchido")} · último acesso ${dataCurta(p.ultimoAcesso)}</p>
        ${p.papel !== "dev" ? `<p class="dica" style="margin:0 0 8px">${p.nomeLogin ? `Entra como “${esc(p.nomeLogin)}”` : "Ainda não ativou a chave"} · entradas: ${p.entradas?.chave || 0} pela chave, ${p.entradas?.nome || 0} pelo nome</p>` : ""}
        <div class="metricas">
          <span><strong>${p.diasAtivos}</strong> dias</span><span><strong>${p.aulas}</strong> aulas</span><span><strong>${p.videos}</strong> vídeos</span>
          <span>ouviu <strong>${p.ouvidoMedio != null ? `${p.ouvidoMedio}%` : "—"}</strong>${p.aulasOuvidas ? ` (${p.aulasOuvidas} ${p.aulasOuvidas === 1 ? "aula" : "aulas"})` : ""}</span>
          <span><strong>${p.quizzes}</strong> testes${p.acertoMedio !== null ? ` (${p.acertoMedio}%)` : ""}</span>
          <span><strong>${p.perguntasChat}</strong> perguntas</span><span><strong>${p.feedbacks}</strong> feedbacks</span>
          <span><strong>${p.ia.chamadas}</strong> chamadas IA</span>
          <span>nível <strong>${p.nivel > 0 ? `+${p.nivel}` : p.nivel ?? 0}</strong></span>
        </div>
        ${p.papel !== "dev" ? `<div class="acoes-plano">
          <button class="link" data-nova-chave="${p.id}" data-nome="${esc(p.nome)}">${icone("relogio", 16)}Gerar chave nova</button>
          <button class="link" data-ativo="${p.id}" data-valor="${p.ativo ? 0 : 1}">${p.ativo ? "Tirar acesso" : "Devolver acesso"}</button></div>
          <div id="nova-chave-${p.id}"></div>` : ""}
      </div>`).join("")}</div>

    <div class="secao"><h2>Relatório da IA</h2><button class="link" id="gerar-relatorio">${icone("brilho", 16)} Gerar novo</button></div>
    <div id="relatorio">${relatorios.length ? htmlRelatorio(relatorios[0]) : `<div class="vazio">Ainda não há relatório. Quando chegarem feedbacks, toque em "Gerar novo".</div>`}</div>

    <div class="secao"><h2>Feedbacks</h2><span class="rotulo">${d.feedbacks.length}</span></div>
    <div class="lista">${d.feedbacks.map((f) => `
      <div class="feedback-item">
        <div class="pessoa-topo"><strong>${esc(f.nome)}</strong>${f.nota ? `<span class="selo ecr">Nota ${f.nota}</span>` : ""}<span class="dica" style="margin:0 0 0 auto">${dataCurta(f.ts)}</span></div>
        ${f.areas?.length ? `<p class="dica">${esc(f.areas.join(" · "))}</p>` : ""}
        ${f.gostou ? `<p><strong>Achou:</strong> ${esc(f.gostou)}</p>` : ""}
        ${f.melhorar ? `<p><strong>Melhorar:</strong> ${esc(f.melhorar)}</p>` : ""}
        ${f.erros ? `<p class="alerta-txt"><strong>Erro relatado:</strong> ${esc(f.erros)}</p>` : ""}
      </div>`).join("") || `<div class="vazio">Nenhum feedback ainda.</div>`}</div>

    <div class="secao"><h2>Avaliações das aulas</h2><span class="rotulo">${d.avaliacoes.length}</span></div>
    <div class="lista">${d.avaliacoes.map((a) => `
      <div class="feedback-item">
        <div class="pessoa-topo"><strong>${esc(a.nome)}</strong><span class="dica" style="margin:0 0 0 auto">${dataCurta(a.ts)}</span></div>
        <p class="dica">${esc(a.titulo || "")}</p>
        <p>${[NOMES_UTIL[a.util], NOMES_NIVEL[a.nivel]].filter(Boolean).join(" · ")}${a.comentario ? ` — “${esc(a.comentario)}”` : ""}</p>
      </div>`).join("") || `<div class="vazio">Nenhuma aula avaliada ainda.</div>`}</div>`;

  document.getElementById("form-convite").addEventListener("submit", (e) => criarConvite(e, url));
  app.querySelectorAll("[data-nova-chave]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm(`Gerar uma chave nova para ${b.dataset.nome}? A chave antiga deixa de funcionar.`)) return;
    const r = await fetch("/api/admin/nova-chave", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: b.dataset.novaChave }) });
    const nova = await r.json();
    if (!r.ok) return toast(nova.erro || "Não foi possível gerar");
    mostrarConvite(document.getElementById(`nova-chave-${b.dataset.novaChave}`), b.dataset.nome, nova.chave, url);
  }));
  document.getElementById("entrar-por-nome").addEventListener("change", async (e) => {
    await fetch("/api/admin/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entrarPorNome: e.target.checked }) });
    toast(e.target.checked ? "Entrada pelo nome ligada" : "Entrada pelo nome desligada");
  });
  app.querySelectorAll("[data-ativo]").forEach((b) => b.addEventListener("click", async () => {
    await fetch("/api/admin/ativo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: b.dataset.ativo, ativo: b.dataset.valor === "1" }) });
    telaPainel();
  }));
  document.getElementById("gerar-relatorio").onclick = gerarRelatorioIA;
  ligarDecisoes(relatorios[0]);
}

async function criarConvite(e, url) {
  e.preventDefault();
  const nome = val("nome-convidado");
  if (nome.length < 2) return toast("Escreva o nome da pessoa");
  const r = await fetch("/api/admin/usuarios", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome }) });
  const d = await r.json();
  if (!r.ok) return toast(d.erro || "Não foi possível criar");
  mostrarConvite(document.getElementById("resultado-convite"), nome, d.chave, url);
  document.getElementById("nome-convidado").value = "";
}

function mostrarConvite(caixa, nome, chave, url) {
  const mensagem = `Oi, ${nome.split(" ")[0]}! Você foi convidado(a) para testar o AtualizaMed: um app que escolhe um artigo científico por dia para você, com videoaula, resumo e miniteste.

1. Abra o link no celular (iPhone: Safari · Android: Chrome): ${url}
2. Instale como aplicativo, seguindo a imagem que te mandei.
3. Abra pelo ícone novo e digite a sua chave: ${chave}

A chave só é pedida no primeiro acesso. Depois, você entra só com o seu nome.

A chave é pessoal, não compartilhe. Depois me conta o que achou pela aba Feedback do app.`;
  caixa.innerHTML = `
    <div class="convite">
      <p class="dica">Chave de <strong>${esc(nome)}</strong> (aparece só agora — copie a mensagem):</p>
      <p class="chave-gerada">${esc(chave)}</p>
      <textarea class="campo area-texto mensagem-convite" rows="9">${esc(mensagem)}</textarea>
      <button class="btn primario largo copiar-convite">${icone("documento", 18)} Copiar mensagem para o WhatsApp</button>
    </div>`;
  const texto = caixa.querySelector(".mensagem-convite");
  caixa.querySelector(".copiar-convite").onclick = async () => {
    try { await navigator.clipboard.writeText(texto.value); toast("Mensagem copiada"); }
    catch { texto.select(); toast("Selecionei a mensagem: copie com Ctrl+C"); }
  };
}

async function gerarRelatorioIA() {
  const caixa = document.getElementById("relatorio");
  caixa.innerHTML = `<div class="destaque"><div class="sk" style="height:18px;width:60%"></div><div class="sk" style="height:80px;margin-top:12px"></div>
    <p class="legenda-carregando">${icone("brilho", 16)} A IA está lendo todos os feedbacks e o uso de cada pessoa…</p></div>`;
  try {
    const r = await fetch("/api/admin/relatorio", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const inicio = await r.json();
    if (!r.ok) throw new Error(inicio.erro);
    const d = await aguardarTarefa(inicio);
    caixa.innerHTML = htmlRelatorio(d);
    ligarDecisoes(d);
  } catch (err) {
    caixa.innerHTML = `<div class="vazio">Não foi possível gerar o relatório (${esc(err.message)}).</div>`;
  }
}

const RECOMENDACAO = { aprovar: ["ecr", "IA recomenda aprovar"], manter: ["diretriz", "IA recomenda manter como está"], avaliar: ["revisao", "Avaliar com mais dados"] };
function htmlRelatorio(reg) {
  const r = reg.relatorio || {};
  const lista = (itens, render) => (itens?.length ? itens.map(render).join("") : `<p class="dica">Nada aqui.</p>`);
  const citacoes = (c) => (c?.length ? `<ul class="citacoes">${c.slice(0, 3).map((x) => `<li>“${esc(x)}”</li>`).join("")}</ul>` : "");
  return `
    <div class="relatorio" data-arquivo="${esc(reg.arquivo)}">
      <p class="dica">Gerado em ${dataCurta(reg.gerado)}</p>
      <div class="uma-frase"><span class="rotulo">Resumo</span><p>${esc(r.resumo)}</p></div>
      ${r.satisfacao ? `<p><strong>Satisfação:</strong> ${r.satisfacao.media ? `${Number(r.satisfacao.media).toFixed(1)}/5 — ` : ""}${esc(r.satisfacao.comentario || "")}</p>` : ""}
      ${r.alertasConteudo?.length ? `<section class="alerta-conteudo"><h3>${icone("alerta", 18)} Possíveis erros de conteúdo (prioridade)</h3><ul>${r.alertasConteudo.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></section>` : ""}
      <section><h3>Pontos fortes</h3>${lista(r.pontosFortes, (p) => `<div class="item-rel"><strong>${esc(p.tema)}</strong>${p.pessoas ? ` <span class="dica">· ${p.pessoas} pessoa(s)</span>` : ""}<p>${esc(p.detalhe)}</p>${citacoes(p.citacoes)}</div>`)}</section>
      <section><h3>Problemas</h3>${lista(r.problemas, (p) => `<div class="item-rel"><strong>${esc(p.tema)}</strong> <span class="selo ${p.gravidade === "alta" ? "revisao" : "diretriz"}">${esc(p.gravidade || "")}</span>${p.pessoas ? ` <span class="dica">· ${p.pessoas} pessoa(s)</span>` : ""}<p>${esc(p.detalhe)}</p>${citacoes(p.citacoes)}</div>`)}</section>
      <section><h3>Sugestões — o que muda e o que fica</h3>${lista(r.sugestoes, (s, i) => {
        const [cls, rotulo] = RECOMENDACAO[s.recomendacao] || RECOMENDACAO.avaliar;
        const decisao = reg.decisoes?.[i];
        return `<div class="item-rel sugestao-rel">
          <strong>${esc(s.titulo)}</strong>${s.pessoas ? ` <span class="dica">· pedida por ${s.pessoas}</span>` : ""}
          <p>${esc(s.descricao)}</p>
          <p class="dica"><span class="selo ${cls}">${rotulo}</span> ${esc(s.justificativa)}${s.esforco ? ` · esforço ${esc(s.esforco)}` : ""}</p>
          <div class="decisoes" data-i="${i}">${[["aprovado", "Aprovar"], ["manter", "Manter como está"], ["depois", "Depois"]].map(([v, t]) =>
            `<button class="chip ${decisao === v ? "sel" : ""}" data-decisao="${v}">${icone("check", 16)}${t}</button>`).join("")}</div>
        </div>`;
      })}</section>
      ${r.proximosPassos?.length ? `<section><h3>Próximos passos</h3><ol>${r.proximosPassos.map((p) => `<li>${esc(p)}</li>`).join("")}</ol></section>` : ""}
    </div>`;
}
function ligarDecisoes(reg) {
  if (!reg) return;
  app.querySelectorAll(".decisoes").forEach((g) => g.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", async () => {
    const nova = b.classList.contains("sel") ? null : b.dataset.decisao;
    g.querySelectorAll(".chip").forEach((x) => x.classList.toggle("sel", x === b && !!nova));
    await fetch("/api/admin/decisao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ arquivo: reg.arquivo, indice: Number(g.dataset.i), decisao: nova }) });
  })));
}

// ---------- Início ----------
async function iniciarApp() {
  try {
    const r = await fetch("/api/sessao");
    if (!r.ok) return telaEntrar();
    sessao = await r.json();
  } catch {
    return telaEntrar("Sem conexão com o servidor. Tente de novo em instantes.");
  }
  await IA.iniciar();
  if (!perfil.nome) perfil.nome = (sessao.nomeLogin || sessao.nome || "").split(" ")[0];
  enviarPerfilDepois();
  const basePronta = grupo() === "estudante" ? !!perfil.fase : !!perfil.especialidade;
  const perfilCompleto = perfil.carreira && basePronta && perfil.objetivos.length && (perfil.modoTemas === "auto" || perfil.temas.length);
  if (perfilCompleto && grupo() === "residente" && !perfil.rodizio) irParaPasso("rodizio");
  else if (perfilCompleto) telaPlano();
  else telaBoasVindas();
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
iniciarApp();
