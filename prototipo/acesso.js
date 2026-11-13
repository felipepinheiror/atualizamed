// Conta (e-mail e senha ou Google), abas, Feedback, avaliação das aulas e Painel do desenvolvedor.
let sessao = null; // { id, nome, papel: "dev" | "testador" }

// Qualquer resposta 401 de /api/ (sessão expirada ou chave desativada) leva de volta à tela de entrada.
const _fetchOriginal = window.fetch.bind(window);
window.fetch = async (url, opcoes) => {
  const r = await _fetchOriginal(url, opcoes);
  const caminho = String(url);
  if (r.status === 401 && caminho.startsWith("/api/") && !/\/api\/(sessao|entrar)/.test(caminho) && sessao) {
    sessao = null;
    telaEntrar("A sua sessão terminou. Entre de novo.");
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

// ---------- Entrar / criar conta ----------
// E-mail e senha (o servidor guarda só um hash) ou "Entrar com Google" (o servidor confere o token no Google).
// Depois de entrar, o aparelho fica conectado por 1 ano; não é preciso entrar de novo a cada uso.
let configEntrada = null;
async function carregarConfigEntrada() {
  if (!configEntrada) configEntrada = await fetch("/api/config-entrada").then((r) => r.json()).catch(() => ({}));
  return configEntrada;
}

async function postEntrada(caminho, corpo) {
  const r = await fetch(caminho, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.erro || "Não foi possível entrar");
  return d;
}

function entrou(d, novo) {
  sessao = d;
  toast(novo ? `Conta criada. Bem-vindo(a), ${d.nome.split(" ")[0]}!` : `Bem-vindo(a), ${d.nome.split(" ")[0]}!`);
  iniciarApp();
}

function ligarGoogle(clientId, aoErro) {
  const caixa = document.getElementById("google-botao");
  if (!clientId || !caixa) return;
  const desenhar = () => {
    google.accounts.id.initialize({
      client_id: clientId,
      callback: async (resp) => {
        try { entrou(await postEntrada("/api/entrar-google", { credencial: resp.credential }), false); }
        catch (err) { aoErro(err.message); }
      },
    });
    google.accounts.id.renderButton(caixa, { theme: "outline", size: "large", shape: "pill", text: "continue_with",
      locale: "pt-BR", width: Math.min(caixa.clientWidth || 320, 400) });
  };
  if (window.google?.accounts?.id) return desenhar();
  const s = document.createElement("script");
  s.src = "https://accounts.google.com/gsi/client";
  s.async = true;
  s.onload = desenhar;
  s.onerror = () => { caixa.innerHTML = ""; };
  document.head.appendChild(s);
}

async function telaEntrar(aviso = "", modo = "entrar") {
  telaAtual = "entrar";
  const criar = modo === "criar";
  const cfg = await carregarConfigEntrada();
  app.innerHTML = `
    <div class="tela entrar">
      <div class="marca"><span class="logo">${icone("livro", 18)}</span>AtualizaMed</div>
      <div class="entrar-corpo">
        <h1 class="titulo-xl">${criar ? "Crie a sua conta" : "Entre na sua conta"}</h1>
        <p class="sub">${criar ? "Leva menos de um minuto. Depois, o app monta o seu plano de estudo."
          : "Um artigo por dia, escolhido para o seu momento de carreira."}</p>
        ${cfg.googleClientId ? `<div id="google-botao" class="google-botao" aria-label="Entrar com Google"></div>
          <div class="divisor-ou"><span>ou com e-mail</span></div>` : ""}
        <form id="form-entrar" class="form-entrar" novalidate>
          ${criar ? `<input class="campo" id="nome" autocomplete="name" autocapitalize="words" placeholder="Seu nome" aria-label="Seu nome">` : ""}
          <input class="campo" id="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none"
            spellcheck="false" placeholder="E-mail" aria-label="E-mail">
          <input class="campo" id="senha" type="password" autocomplete="${criar ? "new-password" : "current-password"}"
            placeholder="${criar ? "Senha (mínimo de 8 caracteres)" : "Senha"}" aria-label="Senha">
          <p class="msg-entrar" id="msg-entrar" role="alert">${esc(aviso)}</p>
          <button class="btn primario largo" id="btn-entrar">${criar ? "Criar conta" : "Entrar"} ${icone("seta")}</button>
        </form>
        <button class="link trocar-modo" id="trocar-modo">${criar ? "Já tenho conta: entrar" : "Não tem conta? Criar agora"}</button>
        ${criar ? "" : `<p class="dica centro">Esqueceu a senha? Entre com o Google, se usou o mesmo e-mail, ou peça uma senha provisória a quem te convidou.</p>`}
      </div>
    </div>`;
  const msg = document.getElementById("msg-entrar");
  document.getElementById("trocar-modo").onclick = () => telaEntrar("", criar ? "entrar" : "criar");
  ligarGoogle(cfg.googleClientId, (m) => { msg.textContent = m; });
  document.getElementById(criar ? "nome" : "email").focus();
  document.getElementById("form-entrar").addEventListener("submit", async (e) => {
    e.preventDefault();
    const botao = document.getElementById("btn-entrar");
    const corpo = { email: val("email"), senha: document.getElementById("senha").value };
    if (criar) corpo.nome = val("nome");
    if (!corpo.email || !corpo.senha || (criar && !corpo.nome)) { msg.textContent = "Preencha todos os campos."; return; }
    botao.disabled = true;
    msg.textContent = criar ? "Criando a sua conta…" : "Conferindo…";
    try {
      entrou(await postEntrada(criar ? "/api/cadastrar" : "/api/entrar", corpo), criar);
    } catch (err) {
      msg.textContent = err.message;
      botao.disabled = false;
    }
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

    <div class="secao"><h2>Convidar alguém</h2></div>
    <div class="plano">
      <p style="margin-top:0">A pessoa cria a própria conta (e-mail e senha, ou Google) neste link: <strong class="quebra">${esc(url)}</strong></p>
      <textarea class="campo area-texto mensagem-convite" id="mensagem-convite" rows="7">${esc(mensagemConvite(url))}</textarea>
      <button class="btn primario largo" id="copiar-convite">${icone("documento", 18)} Copiar mensagem para o WhatsApp</button>
    </div>

    <div class="secao"><h2>Pessoas</h2></div>
    <div class="lista">${d.pessoas.map((p) => `
      <div class="pessoa ${p.ativo ? "" : "inativa"}">
        <div class="pessoa-topo"><strong>${esc(p.nome)}</strong>${p.papel === "dev" ? `<span class="selo diretriz">Dev</span>` : ""}${p.ativo ? "" : `<span class="selo revisao">Sem acesso</span>`}</div>
        <p class="dica" style="margin:2px 0 8px">${esc(p.perfil || "Perfil ainda não preenchido")} · último acesso ${dataCurta(p.ultimoAcesso)}</p>
        <p class="dica" style="margin:0 0 8px">${esc(p.email || "sem e-mail")}${p.google ? " · conta Google" : ""} · entradas: ${Object.values(p.entradas || {}).reduce((a, b) => a + b, 0)}</p>
        <div class="metricas">
          <span><strong>${p.diasAtivos}</strong> dias</span><span><strong>${p.aulas}</strong> aulas</span><span><strong>${p.videos}</strong> vídeos</span>
          <span>ouviu <strong>${p.ouvidoMedio != null ? `${p.ouvidoMedio}%` : "—"}</strong>${p.aulasOuvidas ? ` (${p.aulasOuvidas} ${p.aulasOuvidas === 1 ? "aula" : "aulas"})` : ""}</span>
          <span><strong>${p.quizzes}</strong> testes${p.acertoMedio !== null ? ` (${p.acertoMedio}%)` : ""}</span>
          <span><strong>${p.perguntasChat}</strong> perguntas</span><span><strong>${p.feedbacks}</strong> feedbacks</span>
          <span><strong>${p.ia.chamadas}</strong> chamadas IA</span>
          <span>nível <strong>${p.nivel > 0 ? `+${p.nivel}` : p.nivel ?? 0}</strong></span>
        </div>
        ${p.papel !== "dev" ? `<div class="acoes-plano">
          <button class="link" data-nova-senha="${p.id}" data-nome="${esc(p.nome)}">${icone("relogio", 16)}Senha provisória</button>
          <button class="link" data-ativo="${p.id}" data-valor="${p.ativo ? 0 : 1}">${p.ativo ? "Tirar acesso" : "Devolver acesso"}</button></div>` : ""}
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

  document.getElementById("copiar-convite").onclick = async () => {
    const texto = document.getElementById("mensagem-convite");
    try { await navigator.clipboard.writeText(texto.value); toast("Mensagem copiada"); }
    catch { texto.select(); toast("Selecionei a mensagem: copie com Ctrl+C"); }
  };
  app.querySelectorAll("[data-nova-senha]").forEach((b) => b.addEventListener("click", async () => {
    const senha = prompt(`Senha provisória para ${b.dataset.nome} (pelo menos 8 caracteres). Passe a ela e peça para guardar:`);
    if (!senha) return;
    const r = await fetch("/api/admin/nova-senha", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: b.dataset.novaSenha, senha }) });
    const d = await r.json();
    toast(r.ok ? `Senha de ${b.dataset.nome} definida` : d.erro || "Não foi possível definir");
  }));
  app.querySelectorAll("[data-ativo]").forEach((b) => b.addEventListener("click", async () => {
    await fetch("/api/admin/ativo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: b.dataset.ativo, ativo: b.dataset.valor === "1" }) });
    telaPainel();
  }));
  document.getElementById("gerar-relatorio").onclick = gerarRelatorioIA;
  ligarDecisoes(relatorios[0]);
}

function mensagemConvite(url) {
  return `Oi! Você foi convidado(a) para testar o AtualizaMed: 5 minutos por dia com o artigo e a conduta que importam para você, com videoaula, resumo e miniteste.

1. Abra o link no celular (iPhone: Safari · Android: Chrome): ${url}
2. Crie a sua conta com e-mail e senha, ou toque em "Entrar com Google".
3. Instale como aplicativo, seguindo a imagem que te mandei.

Depois me conta o que achou pela aba Feedback do app.`;
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
  if (!perfil.nome) perfil.nome = (sessao.nome || "").split(" ")[0];
  enviarPerfilDepois();
  const basePronta = grupo() === "estudante" ? !!perfil.fase : !!perfil.especialidade;
  const perfilCompleto = perfil.carreira && basePronta && perfil.objetivos.length && (perfil.modoTemas === "auto" || perfil.temas.length);
  if (perfilCompleto && grupo() === "residente" && !perfil.rodizio) irParaPasso("rodizio");
  else if (perfilCompleto) telaPlano();
  else telaBoasVindas();
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
iniciarApp();
