// Tela de estudo: videoaula (slides narrados), resumo, artigo completo, miniteste e dúvidas com a IA.
const CHAVE_HIST = "atualizamed.historico";

// ---------- Histórico e sequência de dias ----------
function lerHistorico() { try { return JSON.parse(localStorage.getItem(CHAVE_HIST)) || []; } catch { return []; } }
function registrarEstudo(a, acertos, total) {
  const hist = lerHistorico().filter((h) => h.id !== a.id);
  hist.push({ id: a.id, titulo: tituloDe(a), tema: a.tema, data: hojeISO(), acertos, total });
  registrarEvento("quiz_concluido", { id: a.id, titulo: tituloDe(a), acertos, total });
  try { localStorage.setItem(CHAVE_HIST, JSON.stringify(hist)); } catch {}
}
const hojeISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function diasSeguidos() {
  const dias = new Set(lerHistorico().map((h) => h.data));
  const d = new Date();
  if (!dias.has(hojeISO(d))) d.setDate(d.getDate() - 1); // a sequência continua até o fim de hoje
  let n = 0;
  while (dias.has(hojeISO(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
const jaEstudado = (id) => lerHistorico().some((h) => h.id === id);

// ---------- Público (nível do perfil), usado pela IA e pelo cache compartilhado das aulas ----------
function publicoTexto() {
  const g = grupo();
  if (g === "estudante") return `Estudante de medicina (${faseTexto()}${perfil.cursando ? `, cursando ${perfil.cursando}` : ""})`;
  if (g === "residente") return `${carreiraTexto()} de ${perfil.especialidade}${perfil.rodizio ? `, no rodízio de ${perfil.rodizio}` : ""}`;
  if (g === "professor") return `Professor/preceptor de ${perfil.especialidade}${perfil.area ? ` (ensina ${perfil.area})` : ""}${perfil.publico.length ? ` para ${perfil.publico.join(", ")}` : ""}`;
  return `${carreiraTexto()} — ${perfil.especialidade}${perfil.area ? ` (${perfil.area})` : ""}`;
}

const dadosArtigo = (a) => ({
  id: a.id, pmcid: a.pmcid || null, titulo: limparHtml(a.title), revista: a.revista, ano: a.pubYear, tipos: a.tipos,
  resumoOriginal: limparHtml(a.abstractText).slice(0, 6000), tema: a.tema,
});

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// Pede uma tarefa demorada e vai perguntando ao servidor até ficar pronta (sem estourar o tempo do túnel).
async function aguardarTarefa(resposta, aoProgresso, continuar = () => true) {
  let d = resposta;
  while (d?.gerando && continuar()) {
    await dormir(3000);
    const r = await fetch(`/api/tarefa?id=${encodeURIComponent(d.tarefa)}`);
    const novo = await r.json().catch(() => ({}));
    if (r.status === 202) { aoProgresso?.(novo.segundos || 0); continue; }
    if (!r.ok) throw Object.assign(new Error(novo.erro || `Erro ${r.status}`), { status: r.status });
    d = novo;
  }
  return d;
}

async function postJSON(url, corpo) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.erro || `Erro ${r.status}`), { status: r.status });
  return d;
}

// ---------- Tela ----------
let est = null; // estado da tela de estudo aberta

function abrirEstudo(a) {
  if (!a) return;
  telaAtual = "estudo";
  pararAudio();
  registrarOuvido();
  registrarEvento("aula_aberta", { id: a.id, titulo: limparHtml(a.title), tema: a.tema, modo: a.modo });
  est = { a, aba: "video", estudo: null, erroEstudo: null, texto: undefined, slide: 0, revelado: -1, tocando: false, audios: new Map(),
    ouvidas: new Set(), ouvidasEnviadas: -1, quiz: { i: 0, respostas: [] }, chat: [] };
  const e = ESTRATEGIAS[a.modo];
  app.innerHTML = `
    <div class="tela estudo" data-modo="${a.modo}">
      <div class="estudo-topo">
        <button class="btn-icone" id="sair-estudo" aria-label="Voltar">${icone("voltar")}</button>
        <span class="pilula-modo">${icone(e.icone, 14)} ${e.rotulo}</span>
        <a class="btn-icone" href="${linkDe(a)}" target="_blank" rel="noopener" aria-label="Abrir na fonte">${icone("externo", 18)}</a>
      </div>
      <p class="tema-linha">${esc(a.tema)}</p>
      <h1 class="titulo-artigo" id="titulo-estudo">${esc(tituloDe(a))}</h1>
      <p class="meta">${esc(a.revista)} · ${esc(a.pubYear)}</p>
      <div class="selos">${selos(a)}</div>
      <nav class="abas-estudo" role="tablist">
        ${[["video", "brilho", "Videoaula"], ["resumo", "resumo", "Resumo"], ["artigo", "documento", "Artigo"], ["teste", "teste", "Teste"], ["duvidas", "chat", "Dúvidas"]]
          .map(([id, ic, nome]) => `<button role="tab" class="aba-estudo" data-aba="${id}" aria-selected="${id === "video"}">${icone(ic, 18)}<span>${nome}</span></button>`).join("")}
      </nav>
      <div id="painel"></div>
    </div>`;
  document.getElementById("sair-estudo").onclick = () => { pararAudio(); registrarOuvido(); est = null; telaPlano(); };
  app.querySelectorAll(".aba-estudo").forEach((b) => b.addEventListener("click", () => trocarAba(b.dataset.aba)));
  window.scrollTo(0, 0);
  desenharPainel();
  carregarEstudo();
  carregarTexto();
}

function trocarAba(aba) {
  if (!est) return;
  if (aba !== "video") { pausarAudio(); registrarOuvido(); }
  est.aba = aba;
  app.querySelectorAll(".aba-estudo").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.aba === aba)));
  desenharPainel();
}

async function carregarEstudo() {
  const meu = est;
  try {
    // A aula é individual: vai o perfil completo e o motivo da escolha deste artigo para esta pessoa.
    const inicio = await postJSON("/api/estudo", { ...dadosArtigo(meu.a), modo: meu.a.modo, tempo: perfil.tempo, publico: publicoTexto(),
      perfil: IA.descreverPerfil(perfilIA()), motivo: porQue(meu.a) });
    const estudo = await aguardarTarefa(inicio, (seg) => {
      const leg = document.getElementById("progresso-aula");
      if (leg) leg.textContent = seg < 60 ? `Preparando há ${seg} s…` : `Preparando há ${Math.floor(seg / 60)} min ${seg % 60} s… (a IA gratuita está mais lenta agora)`;
    }, () => est === meu);
    if (est !== meu || !estudo || estudo.gerando) return;
    if (est !== meu) return;
    meu.estudo = estudo;
    if (estudo.tituloPt) { meu.a.tituloPt = meu.a.tituloPt || estudo.tituloPt; document.getElementById("titulo-estudo").textContent = tituloDe(meu.a); }
    prepararAudio(0, 0).catch(() => {});
  } catch (e) {
    if (est !== meu) return;
    meu.erroEstudo = e.status === 503 ? "sem-ia" : e.message;
  }
  if (["video", "resumo", "teste"].includes(meu.aba)) desenharPainel();
}

async function carregarTexto() {
  const meu = est;
  if (!meu.a.pmcid) { meu.texto = null; if (meu.aba === "artigo") desenharPainel(); return; }
  try {
    const r = await fetch(`/api/texto?pmcid=${encodeURIComponent(meu.a.pmcid)}`);
    meu.texto = r.ok ? await r.json() : null;
  } catch { meu.texto = null; }
  if (est === meu && meu.aba === "artigo") desenharPainel();
}

function desenharPainel() {
  const painel = document.getElementById("painel");
  if (!painel || !est) return;
  const precisaEstudo = ["video", "resumo", "teste"].includes(est.aba);
  if (precisaEstudo && est.erroEstudo) { painel.innerHTML = painelSemAula(); ligarSemAula(); return; }
  if (precisaEstudo && !est.estudo) { painel.innerHTML = carregandoAula(); return; }
  ({ video: painelVideo, resumo: painelResumo, artigo: painelArtigo, teste: painelTeste, duvidas: painelDuvidas })[est.aba]();
}

const carregandoAula = () => `
  <div class="carregando-aula">
    <div class="sk" style="width:100%;aspect-ratio:16/9;border-radius:18px"></div>
    <p class="legenda-carregando">${icone("brilho", 16)} Preparando a sua aula: lendo o artigo, escrevendo o resumo, os slides e o miniteste…</p>
    <p class="dica" style="text-align:center" id="progresso-aula">Na primeira vez pode levar 1 a 2 minutos. Depois fica salva.</p>
    <p class="dica" style="text-align:center">Pode sair desta tela: a aula continua sendo preparada.</p>
  </div>`;

function painelSemAula() {
  if (est.erroEstudo === "sem-ia") return `
    <div class="vazio">A videoaula, o resumo em português e o miniteste precisam da IA, que está desligada agora.<br>
    Enquanto isso, você pode ler o <button class="link" data-ir="artigo">artigo completo</button>.</div>`;
  return `<div class="vazio">Não foi possível preparar a aula (${esc(est.erroEstudo)}).<br><button class="link" id="tentar-de-novo">Tentar de novo</button></div>`;
}
function ligarSemAula() {
  document.querySelector("[data-ir]")?.addEventListener("click", (e) => trocarAba(e.target.dataset.ir));
  document.getElementById("tentar-de-novo")?.addEventListener("click", () => { est.erroEstudo = null; desenharPainel(); carregarEstudo(); });
}

// ---------- Videoaula: slides animados, montados parte a parte junto com a narração ----------
// Cada slide tem um layout (abertura, lista, fluxo, comparacao, destaque, alerta, fechamento) e 2–4 partes.
// Cada parte tem o texto de tela e o seu trecho de narração: o texto entra quando a voz chega nele.
const ROTULO_LAYOUT = { lista: "Pontos-chave", fluxo: "Passo a passo", comparacao: "Comparação", destaque: "Em números", alerta: "Atenção no plantão", fechamento: "Para levar", abertura: "" };

// Formato antigo (tópicos + uma narração só) → partes.
function partesDe(s) {
  // Numeração escrita pela IA ("1.", "2)") é redundante: o layout já numera ou marca os itens.
  if (s.partes?.length) return s.partes.map((p) => ({ ...p, texto: String(p.texto || "").replace(/^\s*\d+\s*[.)]\s*/, "") }));
  const frases = String(s.narracao || "").split(/(?<=[.!?])\s+/);
  const topicos = s.topicos?.length ? s.topicos : [""];
  const por = Math.max(1, Math.ceil(frases.length / topicos.length));
  return topicos.map((t, k) => ({ texto: t, narracao: frases.slice(k * por, (k + 1) * por).join(" ") || t }));
}
// **termo** → destaque animado.
const comTermos = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<mark class="termo">$1</mark>');

function htmlCorpoSlide(s, partes) {
  const parte = (p, k, extra = "") => `<div class="parte ${extra}" data-k="${k}">${extra.includes("com-num") ? `<span class="num">${k + 1}</span>` : ""}<span class="parte-txt">${comTermos(p.texto)}</span></div>`;
  switch (s.layout) {
    case "abertura":
      return `<div class="abertura-partes">${partes.map((p, k) => parte(p, k)).join("")}</div>`;
    case "fluxo": {
      // Fluxograma: início → passos → desfecho, ligados por setas em SVG que se desenham quando a voz chega no passo.
      const conector = (k) => `<span class="liga conector" data-k="${k}" aria-hidden="true"><svg viewBox="0 0 20 32">
        <path class="linha" pathLength="1" d="M10 1V27"/><path class="ponta" d="M4 21l6 7 6-7"/><circle class="pulso" cx="10" cy="4" r="2.6"/></svg></span>`;
      const tipo = (k) => (k === 0 ? "inicio" : k === partes.length - 1 ? "fim" : "");
      return `<div class="fluxograma">${partes.map((p, k) => (k ? conector(k) : "") + parte(p, k, `no-fluxo com-num ${tipo(k)}`)).join("")}</div>`;
    }
    case "comparacao": {
      // Versus: cabeçalhos das duas opções, eixo central que cresce e itens pareados linha a linha, cada um entrando do seu lado.
      const cols = [0, 1].map((c) => partes.map((p, k) => ({ p, k })).filter((x) => (x.p.coluna === 1 ? 1 : 0) === c));
      const celula = (x, c) => (x ? parte(x.p, x.k, `item-vs lado-${c}`) : `<span></span>`);
      const linhas = Array.from({ length: Math.max(cols[0].length, cols[1].length) }, (_, r) => {
        const [a, b] = [cols[0][r], cols[1][r]];
        return celula(a, 0) + `<span class="liga eixo-vs" data-k="${Math.min(a?.k ?? 99, b?.k ?? 99)}" aria-hidden="true"></span>` + celula(b, 1);
      });
      return `<div class="versus">
        <div class="cab-vs lado-0">${esc(s.colunas?.[0] || "")}</div><span class="selo-vs" aria-hidden="true">vs</span>
        <div class="cab-vs lado-1">${esc(s.colunas?.[1] || "")}</div>${linhas.join("")}</div>`;
    }
    case "destaque":
      return `<div class="destaque-num"><strong class="valor" data-valor="${esc(s.numero?.valor || "")}">${esc(s.numero?.valor || "")}</strong>
        <span class="legenda-num">${esc(s.numero?.legenda || "")}</span></div>
        <div class="lista-partes compacta">${partes.map((p, k) => parte(p, k, "com-num")).join("")}</div>`;
    case "alerta":
      return `<div class="lista-partes alerta-partes">${partes.map((p, k) => parte(p, k)).join("")}</div>`;
    case "fechamento":
      return `<div class="lista-partes check-partes">${partes.map((p, k) => `<div class="parte" data-k="${k}"><span class="check">${icone("check", 14)}</span><span class="parte-txt">${comTermos(p.texto)}</span></div>`).join("")}</div>`;
    default:
      return `<div class="lista-partes">${partes.map((p, k) => parte(p, k, "com-num")).join("")}</div>`;
  }
}

function painelVideo() {
  const { slides } = est.estudo;
  const s = slides[est.slide];
  const partes = partesDe(s);
  const painel = document.getElementById("painel");
  painel.innerHTML = `
    <div class="player">
      <div class="slide layout-${s.layout || "lista"}" id="slide" aria-live="polite">
        <div class="slide-fundo" aria-hidden="true"><span></span><span></span></div>
        <span class="slide-num">${est.slide + 1}/${slides.length}</span>
        <div class="slide-cabeca">
          <span class="slide-icone">${icone(s.icone || "livro", s.layout === "abertura" ? 30 : 20)}</span>
          <div>${ROTULO_LAYOUT[s.layout] ? `<span class="slide-rotulo">${ROTULO_LAYOUT[s.layout]}</span>` : ""}<h2>${comTermos(s.titulo)}</h2></div>
        </div>
        <div class="slide-corpo">${htmlCorpoSlide(s, partes)}</div>
        <span class="slide-marca">${icone("livro", 13)} AtualizaMed</span>
      </div>
      <div class="barra-slides">${slides.map((_, i) => `<button class="seg" data-i="${i}" aria-label="Slide ${i + 1}"><span style="width:${i < est.slide ? 100 : 0}%"></span></button>`).join("")}</div>
      <div class="controles">
        <button class="btn-icone" id="ant" aria-label="Slide anterior" ${est.slide === 0 ? "disabled" : ""}>${icone("voltar")}</button>
        <button class="btn primario redondo" id="tocar" aria-label="Tocar">${icone("play", 24)}</button>
        <button class="btn-icone" id="prox" aria-label="Próximo slide" ${est.slide === slides.length - 1 ? "disabled" : ""}>${icone("avancar")}</button>
        <button class="velocidade" id="vel">${(est.velocidade || 1).toString().replace(".", ",")}×</button>
      </div>
      <p class="legenda-slide" id="legenda"></p>
      <div id="fim-aula"></div>
      ${blocoParaVoce()}
      ${avisoIA()}
    </div>`;
  // Retoma da parte em que parou (ou do começo do slide, se ainda não tocou).
  document.getElementById("tocar").onclick = () => (est.tocando ? pausarAudio() : tocarParte(est.slide, Math.max(0, est.revelado ?? -1)));
  document.getElementById("ant").onclick = () => irSlide(est.slide - 1);
  document.getElementById("prox").onclick = () => irSlide(est.slide + 1);
  document.getElementById("vel").onclick = () => {
    const v = [1, 1.25, 1.5][([1, 1.25, 1.5].indexOf(est.velocidade || 1) + 1) % 3];
    est.velocidade = v;
    if (est.audioAtual) est.audioAtual.playbackRate = v;
    document.getElementById("vel").textContent = `${v.toString().replace(".", ",")}×`;
  };
  painel.querySelectorAll(".seg").forEach((b) => b.addEventListener("click", () => irSlide(Number(b.dataset.i))));
  atualizarSlide();
}

// Atualiza só os estados (sem recriar o slide), para as animações não recomeçarem.
function atualizarSlide() {
  const slideEl = document.getElementById("slide");
  if (!slideEl || !est?.estudo) return;
  const s = est.estudo.slides[est.slide];
  const partes = partesDe(s);
  const rev = est.revelado ?? -1;
  const estatico = rev < 0; // ainda não tocou: mostra o slide inteiro para revisão
  slideEl.classList.toggle("estatico", estatico);
  slideEl.querySelectorAll(".parte").forEach((el) => {
    const k = Number(el.dataset.k);
    el.classList.toggle("visivel", estatico || k <= rev);
    el.classList.toggle("atual", !estatico && est.tocando && k === rev);
  });
  // Ligações dos diagramas (setas do fluxograma, eixo do versus): aparecem junto com a parte e "correm" enquanto ela é narrada.
  slideEl.querySelectorAll(".liga").forEach((el) => {
    const k = Number(el.dataset.k);
    el.classList.toggle("visivel", estatico || k <= rev);
    el.classList.toggle("atual", !estatico && est.tocando && k === rev);
  });
  const valor = slideEl.querySelector(".valor");
  if (valor && !valor.dataset.animado && (estatico || rev >= 0)) { valor.dataset.animado = "1"; contarNumero(valor); }
  const legenda = document.getElementById("legenda");
  legenda.textContent = estatico ? "Toque em ▶ para assistir à aula narrada." : partes[rev]?.narracao || "";
  legenda.classList.toggle("vazia", estatico);
  const botao = document.getElementById("tocar");
  botao.innerHTML = est.tocando ? icone("pausa", 24) : icone("play", 24);
  botao.setAttribute("aria-label", est.tocando ? "Pausar" : "Tocar");
  const ultimo = est.slide === est.estudo.slides.length - 1 && rev >= partes.length - 1 && !est.tocando;
  document.getElementById("fim-aula").innerHTML = ultimo
    ? `<button class="btn secundario largo" id="ir-teste">${icone("teste", 18)} Fazer o miniteste</button>` : "";
  document.getElementById("ir-teste")?.addEventListener("click", () => trocarAba("teste"));
}

// Número em destaque sobe de zero até o valor (ex.: "4,4%", "72 h", "1 em 3").
function contarNumero(el) {
  const original = el.dataset.valor;
  const m = original.match(/(\d+(?:[.,]\d+)?)/);
  if (!m || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const alvo = parseFloat(m[1].replace(",", "."));
  const casas = (m[1].split(/[.,]/)[1] || "").length;
  const inicio = performance.now();
  const passo = (agora) => {
    const t = Math.min(1, (agora - inicio) / 1100);
    const atual = (alvo * (1 - Math.pow(1 - t, 3))).toFixed(casas).replace(".", m[1].includes(",") ? "," : ".");
    el.textContent = original.replace(m[1], atual);
    if (t < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

const chaveAudio = (si, pi) => `${si}-${pi}`;
function prepararAudio(si, pi) {
  if (!est?.estudo) return Promise.reject(new Error("sem aula"));
  const slide = est.estudo.slides[si];
  const parte = slide && partesDe(slide)[pi];
  if (!parte) return Promise.resolve(null);
  const k = chaveAudio(si, pi);
  if (est.audios.has(k)) return est.audios.get(k);
  const meu = est;
  const promessa = fetch("/api/voz", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texto: parte.narracao }) })
    .then((r) => { if (!r.ok) throw new Error("voz indisponível"); return r.blob(); })
    .then((b) => URL.createObjectURL(b));
  meu.audios.set(k, promessa);
  promessa.catch(() => meu.audios.delete(k));
  return promessa;
}
// Próximas partes já vão sendo narradas em segundo plano.
function adiantarAudios(si, pi, quantas = 3) {
  let s = si, p = pi;
  for (let n = 0; n < quantas; n++) {
    p++;
    if (p >= partesDe(est.estudo.slides[s]).length) { s++; p = 0; }
    if (s >= est.estudo.slides.length) return;
    prepararAudio(s, p).catch(() => {});
  }
}

async function tocarParte(si, pi) {
  const meu = est;
  pararAudio(false);
  const mudouSlide = meu.slide !== si || !document.getElementById("slide");
  meu.slide = si;
  meu.revelado = pi;
  meu.tocando = true;
  if (mudouSlide) painelVideo(); else atualizarSlide();
  let url;
  try { url = await prepararAudio(si, pi); } catch { meu.tocando = false; toast("Não foi possível carregar a narração"); return atualizarSlide(); }
  if (est !== meu || meu.slide !== si || meu.revelado !== pi || !meu.tocando || !url) return;
  const audio = new Audio(url);
  audio.playbackRate = meu.velocidade || 1;
  meu.audioAtual = audio;
  adiantarAudios(si, pi);
  const n = partesDe(meu.estudo.slides[si]).length;
  audio.ontimeupdate = () => {
    const seg = document.querySelector(`.seg[data-i="${si}"] span`);
    if (seg && audio.duration) seg.style.width = `${((pi + audio.currentTime / audio.duration) / n) * 100}%`;
  };
  audio.onended = () => {
    meu.ouvidas.add(chaveAudio(si, pi));
    if (est !== meu) return;
    if (pi < n - 1) tocarParte(si, pi + 1);
    else if (si < meu.estudo.slides.length - 1) setTimeout(() => est === meu && meu.tocando && tocarParte(si + 1, 0), 600);
    else { meu.tocando = false; meu.audioAtual = null; atualizarSlide(); registrarEvento("video_concluido", { id: meu.a.id }); }
  };
  audio.play().catch(() => { meu.tocando = false; atualizarSlide(); });
}
// Quanto da videoaula a pessoa ouviu: partes narradas até o fim ÷ total de partes da aula.
// Vai ao sair da aula, ao trocar de aba ou ao esconder o app; só reenvia se ela ouviu mais desde o último envio
// (o painel fica com o maior valor de cada aula).
function registrarOuvido(e = est) {
  if (!e?.estudo?.slides || e.ouvidas.size <= e.ouvidasEnviadas) return;
  const total = e.estudo.slides.reduce((t, s) => t + partesDe(s).length, 0);
  if (!total) return;
  e.ouvidasEnviadas = e.ouvidas.size;
  registrarEvento("video_ouvido", { id: e.a.id, ouvidas: e.ouvidas.size, total, fracao: Math.round((100 * e.ouvidas.size) / total) / 100 });
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") registrarOuvido(); });
window.addEventListener("pagehide", () => registrarOuvido());

function irSlide(i) {
  if (!est?.estudo || i < 0 || i >= est.estudo.slides.length) return;
  if (est.tocando) return tocarParte(i, 0);
  est.slide = i;
  est.revelado = -1;
  painelVideo();
  prepararAudio(i, 0).catch(() => {});
}
function pausarAudio() {
  if (!est) return;
  est.audioAtual?.pause();
  est.tocando = false;
  if (est.aba === "video" && est.estudo) atualizarSlide();
}
function pararAudio(redesenhar = true) {
  if (!est) return;
  if (est.audioAtual) { est.audioAtual.onended = null; est.audioAtual.pause(); }
  est.audioAtual = null;
  if (redesenhar) est.tocando = false;
}

// O que ESTA pessoa deve extrair do artigo (decidido pela IA a partir do perfil).
const blocoParaVoce = () => (est.estudo?.paraVoce?.length ? `
  <div class="para-voce"><span class="rotulo">${icone("alvo", 14)} O que você vai tirar deste artigo</span>
    <ul>${est.estudo.paraVoce.map((p) => `<li>${icone("check", 16)}<span>${esc(p)}</span></li>`).join("")}</ul></div>` : "");

const avisoIA = () => `<div class="aviso-ia">${icone("brilho", 18)}<span>Conteúdo gerado por IA a partir do artigo${est.estudo?.textoCompletoUsado ? " completo" : " (só o resumo — o texto completo não é aberto)"}. Pode conter erros: confira na fonte antes de aplicar na prática.</span></div>`;

// ---------- Resumo ----------
function painelResumo() {
  const r = est.estudo;
  const forca = { alta: "Evidência forte", moderada: "Evidência moderada", baixa: "Evidência limitada" }[r.evidencia?.forca] || "";
  document.getElementById("painel").innerHTML = `
    <div class="resumo">
      ${blocoParaVoce()}
      <div class="uma-frase"><span class="rotulo">Em uma frase</span><p>${esc(r.umaFrase)}</p></div>
      ${r.evidencia ? `<div class="evidencia"><span class="selo ${r.evidencia.forca === "alta" ? "ecr" : r.evidencia.forca === "baixa" ? "revisao" : "diretriz"}">${esc(forca)}</span><span>${esc(r.evidencia.comentario || "")}</span></div>` : ""}
      ${r.secoes.map((s) => `<section><h3>${esc(s.titulo)}</h3><ul>${s.itens.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></section>`).join("")}
      ${r.pontosChave.length ? `<section class="pontos"><h3>${icone("alvo", 18)} Para levar</h3><ol>${r.pontosChave.map((p) => `<li>${esc(p)}</li>`).join("")}</ol></section>` : ""}
      ${htmlAvaliacao()}
      <p class="fonte">Fonte: ${esc(limparHtml(est.a.title))}. ${esc(est.a.revista)}, ${esc(est.a.pubYear)}. <a href="${linkDe(est.a)}" target="_blank" rel="noopener">Abrir ${icone("externo", 13)}</a></p>
      ${avisoIA()}
    </div>`;
  ligarAvaliacao();
}

// ---------- Artigo completo ----------
function painelArtigo() {
  const painel = document.getElementById("painel");
  if (est.texto === undefined) { painel.innerHTML = `<div class="sk" style="height:18px;width:60%"></div><div class="sk" style="height:120px;margin-top:12px"></div>`; return; }
  if (!est.texto) {
    painel.innerHTML = `
      <div class="artigo-texto">
        <p class="dica">Este artigo não é de acesso aberto. Abaixo, o resumo original; o texto completo está na revista.</p>
        <h3>Resumo (inglês)</h3><p>${esc(limparHtml(est.a.abstractText))}</p>
        <a class="btn secundario largo" href="${linkDe(est.a)}" target="_blank" rel="noopener">Abrir na fonte ${icone("externo", 16)}</a>
      </div>`;
    return;
  }
  painel.innerHTML = `
    <div class="artigo-texto">
      <p class="dica">Texto original (inglês), de acesso aberto via Europe PMC. Tabelas e figuras estão na fonte.</p>
      <nav class="indice">${est.texto.secoes.map((s, i) => `<a href="#sec-${i}">${esc(s.titulo)}</a>`).join("")}</nav>
      ${est.texto.secoes.map((s, i) => `<section id="sec-${i}"><h3>${esc(s.titulo)}</h3>${s.paragrafos.map((p) => `<p>${esc(p)}</p>`).join("")}</section>`).join("")}
    </div>`;
}

// ---------- Miniteste ----------
function painelTeste() {
  const { quiz } = est.estudo;
  const q = est.quiz;
  const painel = document.getElementById("painel");
  if (q.i >= quiz.length) {
    const acertos = q.respostas.filter((r, i) => r === quiz[i].correta).length;
    const pct = Math.round((acertos / quiz.length) * 100);
    painel.innerHTML = `
      <div class="resultado">
        <div class="anel-grande" style="--pct:${pct}"><strong>${acertos}/${quiz.length}</strong><span>acertos</span></div>
        <h2>${pct >= 80 ? "Mandou bem!" : pct >= 50 ? "Bom caminho!" : "Vale revisar o resumo"}</h2>
        <p class="sub">${pct >= 80 ? "Você fixou os pontos principais do artigo." : "Reveja o resumo ou tire as dúvidas com a IA."}</p>
        <div class="acoes-resultado">
          <button class="btn secundario largo" id="refazer">Refazer o teste</button>
          <button class="btn primario largo" data-ir="duvidas">${icone("chat", 18)} Tirar dúvidas</button>
        </div>
      </div>
      ${htmlAvaliacao()}`;
    ligarAvaliacao();
    document.getElementById("refazer").onclick = () => { est.quiz = { i: 0, respostas: [] }; painelTeste(); };
    painel.querySelector("[data-ir]").onclick = () => trocarAba("duvidas");
    return;
  }
  const atual = quiz[q.i];
  const resposta = q.respostas[q.i];
  const respondida = resposta !== undefined;
  painel.innerHTML = `
    <div class="quiz">
      <div class="quiz-topo"><span class="rotulo">Pergunta ${q.i + 1} de ${quiz.length}</span>
        <div class="segmentos">${quiz.map((_, i) => `<span class="${i < q.i || (i === q.i && respondida) ? "feito" : ""}"></span>`).join("")}</div></div>
      <h2 class="pergunta">${esc(atual.pergunta)}</h2>
      <div class="opcoes">${atual.alternativas.map((alt, i) => {
        const estado = !respondida ? "" : i === atual.correta ? "certa" : i === resposta ? "errada" : "apagada";
        return `<button class="opcao alternativa ${estado}" data-i="${i}" ${respondida ? "disabled" : ""}>
          <span class="letra">${"ABCD"[i]}</span><span class="txt"><strong>${esc(alt)}</strong></span>
          ${estado === "certa" ? `<span class="marcar ok">${icone("check", 14)}</span>` : estado === "errada" ? `<span class="marcar nao">${icone("fechar", 14)}</span>` : ""}
        </button>`;
      }).join("")}</div>
      ${respondida ? `
        <div class="explicacao ${resposta === atual.correta ? "ok" : "nao"}">
          <strong>${resposta === atual.correta ? "Correto!" : `Resposta certa: ${"ABCD"[atual.correta]}`}</strong>
          <p>${esc(atual.explicacao)}</p>
        </div>
        <button class="btn primario largo" id="seguir">${q.i === quiz.length - 1 ? "Ver resultado" : "Próxima pergunta"} ${icone("seta")}</button>` : ""}
    </div>`;
  painel.querySelectorAll(".alternativa:not([disabled])").forEach((b) => b.addEventListener("click", () => {
    q.respostas[q.i] = Number(b.dataset.i);
    painelTeste();
  }));
  document.getElementById("seguir")?.addEventListener("click", () => {
    q.i++;
    if (q.i >= quiz.length) registrarEstudo(est.a, q.respostas.filter((r, i) => r === quiz[i].correta).length, quiz.length);
    painelTeste();
  });
}

// ---------- Dúvidas (chat) ----------
const SUGESTOES_CHAT = ["Qual é a principal conclusão?", "Isso muda a minha conduta?", "Explique a metodologia de forma simples", "Quais são as limitações do estudo?"];

function painelDuvidas() {
  const painel = document.getElementById("painel");
  painel.innerHTML = `
    <div class="chat">
      <div class="mensagens" id="mensagens">
        <div class="msg ia">Olá! Pergunte o que quiser sobre este artigo — eu respondo com base no texto dele.</div>
        ${est.chat.map((m) => `<div class="msg ${m.papel}">${esc(m.texto)}</div>`).join("")}
        ${est.pensando ? `<div class="msg ia pensando"><span></span><span></span><span></span></div>` : ""}
      </div>
      ${est.chat.length ? "" : `<div class="chips sugestoes-chat">${SUGESTOES_CHAT.map((s) => `<button class="chip sugestao">${icone("mais", 16)}${esc(s)}</button>`).join("")}</div>`}
      <form class="adicionar enviar" id="form-chat">
        <input class="campo" id="pergunta" placeholder="Escreva a sua dúvida…" autocomplete="off" ${est.pensando ? "disabled" : ""}>
        <button class="btn primario quadrado" aria-label="Enviar" ${est.pensando ? "disabled" : ""}>${icone("seta")}</button>
      </form>
      <p class="dica">Respostas geradas por IA, com base no artigo. Não escreva dados de pacientes.</p>
    </div>`;
  painel.querySelectorAll(".sugestoes-chat .chip").forEach((b) => b.addEventListener("click", () => perguntar(b.textContent.trim())));
  document.getElementById("form-chat").addEventListener("submit", (e) => { e.preventDefault(); perguntar(document.getElementById("pergunta").value.trim()); });
  const lista = document.getElementById("mensagens");
  lista.scrollTop = lista.scrollHeight;
}

async function perguntar(texto) {
  if (!texto || est.pensando) return;
  const meu = est;
  const historico = meu.chat.slice();
  meu.chat.push({ papel: "usuario", texto });
  meu.pensando = true;
  painelDuvidas();
  try {
    const r = await postJSON("/api/chat", { ...dadosArtigo(meu.a), publico: publicoTexto(), perfil: IA.descreverPerfil(perfilIA()), historico, pergunta: texto });
    meu.chat.push({ papel: "ia", texto: r.resposta });
  } catch (e) {
    meu.chat.push({ papel: "ia", texto: e.status === 503 ? "A IA está desligada agora — não consigo responder." : `Não consegui responder (${e.message}). Tente de novo.` });
  }
  meu.pensando = false;
  if (est === meu && meu.aba === "duvidas") painelDuvidas();
}
