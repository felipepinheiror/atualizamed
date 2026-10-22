// AtualizaMed — protótipo: onboarding livre → plano personalizado → artigo do dia (artigos reais via Europe PMC).
// Tudo o que o médico escreve é aceito; o catálogo e a IA só oferecem sugestões.
const CHAVE = "atualizamed.perfil";
const app = document.getElementById("app");

let perfil = migrar({ ...novoPerfil(), ...(carregar() || {}) });
let passo = 0;
let voltarParaPlano = false;
let telaAtual = "";

function novoPerfil() {
  return {
    nome: "", carreira: null, carreiraLivre: "", especialidade: "",
    fase: null, cursando: "", interesse: "",     // estudante
    rodizio: "",                                  // residente
    area: "", cenarios: [], publico: [],          // especialistas e professores
    objetivos: [], objetivoLivre: "", sobre: "",
    modoTemas: "auto", temas: [], tempo: "10",
  };
}
// Converte perfis salvos pelas versões anteriores do protótipo.
function migrar(p) {
  if (ESPECIALIDADES[p.especialidade]) {
    const e = ESPECIALIDADES[p.especialidade];
    p.rodizio = (e.rodizios || []).find((r) => r.id === p.rodizio)?.nome || p.rodizioLivre || "";
    if (Array.isArray(p.areas) && p.areas.length) p.area = p.areas.join(", ");
    p.especialidade = e.nome;
  }
  if (p.objetivo && !p.objetivos?.length) p.objetivos = [p.objetivo];
  if (p.tempo === "5") p.tempo = "10"; // a opção de 5 minutos foi removida (aulas curtas demais)
  p.temas = (p.temas || []).map((t) => (typeof t === "string" ? acharTemaNoCatalogo(t) || { pt: t } : t));
  if (p.livre) { p.temas.push({ pt: p.livre }); p.livre = ""; }
  if (p.temas.length && !carregar()?.modoTemas) p.modoTemas = "manual";
  delete p.areas; delete p.rodizioLivre; delete p.proximo; delete p.objetivo;
  return p;
}
function carregar() {
  try { return JSON.parse(localStorage.getItem(CHAVE)); } catch { return null; }
}
function salvar() {
  try { localStorage.setItem(CHAVE, JSON.stringify(perfil)); } catch {}
  enviarPerfilDepois(); // o servidor guarda uma cópia para o painel do desenvolvedor
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const limparHtml = (s) => String(s ?? "").replace(/<[^>]+>/g, "");

// ---------- Perfil derivado ----------
const carreira = () => CARREIRA.find((c) => c.id === perfil.carreira);
const carreiraTexto = () => (perfil.carreira === "outro" ? perfil.carreiraLivre : carreira()?.rotulo || "");
const anoResidencia = () => carreira()?.ano || Number((perfil.carreira === "outro" && perfil.carreiraLivre.match(/\bR\s?(\d)/i)?.[1]) || 0);
const ehResidente = () => !!anoResidencia() || (perfil.carreira === "outro" && /resid/i.test(perfil.carreiraLivre));
// Cada momento de carreira tem as suas próprias perguntas e objetivos.
const grupo = () => (perfil.carreira === "outro" && ehResidente() ? "residente" : GRUPO_DA_CARREIRA[perfil.carreira] || "outro");
const objetivosDoGrupo = () => OBJETIVOS_POR_GRUPO[grupo()];
const objetivoTexto = () => perfil.objetivos
  .map((id) => (id === "outro" ? perfil.objetivoLivre : objetivoDef(id)?.rotulo))
  .filter(Boolean).join("; ");
const faseTexto = () => FASES_CURSO.find((f) => f.id === perfil.fase)?.rotulo || "";
const espCatalogo = () => acharEspecialidade(perfil.especialidade) || acharEspecialidade(perfil.cursando) || acharEspecialidade(perfil.interesse);
const perfilIA = () => ({ ...perfil, carreiraTexto: carreiraTexto(), objetivoTexto: objetivoTexto(), faseTexto: faseTexto() });
const temaJaEscolhido = (pt) => perfil.temas.some((t) => normalizar(t.pt) === normalizar(pt));

// ---------- Sugestões (catálogo → IA) ----------
const memoSugestoes = new Map();

// Guarda a promessa (não só o resultado) para que duas partes da tela pedindo o mesmo gerem uma chamada só.
function obterSugestoes(tipo) {
  const base = [tipo, perfil.especialidade, perfil.carreira, perfil.carreiraLivre, IA.conectada()];
  const chave = JSON.stringify(tipo === "rodizio" ? base : [...base, perfil.fase, perfil.cursando, perfil.interesse, perfil.rodizio, perfil.area,
    perfil.cenarios, perfil.publico, perfil.objetivos, perfil.objetivoLivre, perfil.sobre]);
  if (!memoSugestoes.has(chave)) {
    memoSugestoes.set(chave, calcularSugestoes(tipo).catch((e) => { memoSugestoes.delete(chave); throw e; }));
  }
  return memoSugestoes.get(chave);
}

async function calcularSugestoes(tipo) {
  const idEsp = espCatalogo();
  const ano = anoResidencia();
  let lista = [];

  if (tipo === "rodizio") {
    const rods = ESPECIALIDADES[idEsp]?.rodizios || [];
    if (rods.length) lista = [...rods].sort((a, b) => Number(b.anos.includes(ano)) - Number(a.anos.includes(ano))).map((r) => r.nome);
    else if (IA.conectada()) lista = await IA.sugerirRodizios(perfilIA());
  }

  if (tipo === "area") {
    if (IA.conectada() && perfil.especialidade) lista = await IA.sugerirAreas(perfilIA());
    else lista = Object.keys(ESPECIALIDADES[idEsp]?.areas || {});
  }

  if (tipo === "cursando") lista = CURSANDO_POR_FASE[perfil.fase] || [];
  if (tipo === "interesse") lista = MAIS_COMUNS;

  if (tipo === "temas" || tipo === "trilha") {
    if (IA.conectada()) {
      lista = tipo === "trilha" ? await IA.montarTrilha(perfilIA()) : await IA.sugerirTemas(perfilIA(), 8);
    } else {
      lista = temasDoCatalogo(tipo === "trilha" ? 6 : 10);
    }
  }
  // Se a IA não trouxe nada, cai para o catálogo/texto do perfil (o app nunca fica sem sugestão por causa da IA).
  if (!lista.length && tipo === "area") lista = Object.keys(ESPECIALIDADES[idEsp]?.areas || {});
  if (!lista.length && (tipo === "temas" || tipo === "trilha")) lista = temasDoCatalogo(tipo === "trilha" ? 6 : 10);
  return lista;
}

// Sem IA: temas do rodízio/área no catálogo; se nada bater, o próprio rodízio/área/especialidade vira tema.
function temasDoCatalogo(qtd) {
  const idEsp = espCatalogo();
  const e = ESPECIALIDADES[idEsp];
  let lista = [];
  if (e) {
    const rod = ehResidente() && acharRodizio(idEsp, perfil.rodizio);
    // Área do catálogo que divide uma palavra específica com o que o médico escreveu (ignora "cirurgia", "e"…).
    const genericas = /^(cirurgia|medicina|clinica|e|de|do|da|dos|das|parede)$/;
    const palavras = (s) => normalizar(s).split(/[^a-z]+/).filter((w) => w.length > 3 && !genericas.test(w));
    const minhas = palavras(perfil.area);
    const areaCat = Object.entries(e.areas || {}).find(([nome]) => palavras(nome).some((w) => minhas.some((m) => m.startsWith(w.slice(0, 6)))));
    // Estudantes ficam só na primeira área do catálogo (fundamentos); os demais podem receber todas.
    const todas = Object.values(e.areas || {});
    lista = rod ? rod.temas : areaCat ? areaCat[1] : grupo() === "estudante" ? todas[0] || [] : todas.flat();
  }
  if (!lista.length) lista = [perfil.rodizio, perfil.area, perfil.cursando, perfil.especialidade, perfil.interesse].filter(Boolean).flatMap((s) => s.split(/,|;| e /)).map((s) => ({ pt: s.trim() })).filter((t) => t.pt.length > 2);
  return lista.slice(0, qtd);
}

// Preenche a área de sugestões de um passo. `aoEscolher(item)` decide o que fazer com o clique.
async function carregarSugestoes(tipo, aoEscolher, marcados = () => [], somenteLeitura = false) {
  const caixa = document.getElementById("sugestoes");
  if (!caixa) return;
  caixa.innerHTML = Array.from({ length: 5 }, (_, i) => `<span class="sk chip-sk" style="width:${70 + (i % 3) * 30}px"></span>`).join("");
  let lista = [];
  try { lista = await obterSugestoes(tipo); } catch (e) { console.warn("Sugestões:", e.message); }
  if (document.getElementById("sugestoes") !== caixa) return; // o usuário já mudou de tela
  if (!lista.length) {
    caixa.outerHTML = `<p class="dica" id="sugestoes">Sem sugestões para isso — escreva livremente.</p>`;
    return;
  }
  if (somenteLeitura) {
    caixa.innerHTML = lista.map((item) => `<span class="chip estatico">${esc(typeof item === "string" ? item : item.pt)}</span>`).join("");
    return;
  }
  caixa.innerHTML = lista.map((item, i) => {
    const rotulo = typeof item === "string" ? item : item.pt;
    const sel = marcados().some((m) => normalizar(m) === normalizar(rotulo));
    return `<button class="chip sugestao ${sel ? "sel" : ""}" data-i="${i}" aria-pressed="${sel}">${icone(sel ? "check" : "mais", 16)}${esc(rotulo)}</button>`;
  }).join("");
  caixa.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => aoEscolher(lista[Number(b.dataset.i)], b)));
}

// ---------- Onboarding ----------
const MAIS_COMUNS = ["Cirurgia Geral", "Clínica Médica", "Pediatria", "Ginecologia e Obstetrícia", "Medicina de Família e Comunidade", "Ortopedia e Traumatologia", "Anestesiologia", "Psiquiatria"];

const valor = (x) => (typeof x === "function" ? x() : x);

// Campo de texto livre + sugestões que preenchem o campo (escolha única).
// `placeholder`, `opcional` e `rotuloSug` podem ser funções, para variar conforme o perfil.
function passoTextoLivre({ id, campo, titulo, sub, placeholder, opcional = false, tipoSug, rotuloSug = "Sugestões", lista }) {
  return {
    id, titulo, sub,
    render: () => `
      <input class="campo" type="text" id="campo-${campo}" ${lista ? `list="${lista}"` : ""} placeholder="${esc(valor(placeholder))}" value="${esc(perfil[campo])}" autocomplete="off">
      ${lista === "lista-esp" ? `<datalist id="lista-esp">${ESPECIALIDADES_CFM.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>` : ""}
      ${valor(opcional) ? `<p class="dica">Opcional — pode deixar em branco.</p>` : ""}
      <div class="grupo-titulo rotulo">${esc(valor(rotuloSug))}</div>
      <div class="chips" id="sugestoes"></div>`,
    ligar: () => {
      const input = document.getElementById(`campo-${campo}`);
      input.addEventListener("input", () => { perfil[campo] = input.value.trim(); marcarSugestaoIgual(input.value); atualizarBotao(); });
      carregarSugestoes(tipoSug, (item) => {
        input.value = perfil[campo] = typeof item === "string" ? item : item.pt;
        marcarSugestaoIgual(input.value);
        atualizarBotao();
      }, () => [perfil[campo]]);
    },
    valido: () => valor(opcional) || perfil[campo].length > 1,
  };
}

// Várias escolhas em chips (ex.: onde atua, para quem ensina).
function passoChipsMultiplos({ id, campo, titulo, sub, itens, opcional = false }) {
  return {
    id, titulo, sub,
    render: () => `
      <div class="chips">${itens.map((n, i) => {
        const sel = perfil[campo].includes(n);
        return `<button class="chip ${sel ? "sel" : ""}" data-i="${i}" aria-pressed="${sel}">${icone("check", 16)}${esc(n)}</button>`;
      }).join("")}</div>
      ${opcional ? `<p class="dica">Opcional — escolha quantos quiser.</p>` : `<p class="dica">Escolha quantos quiser.</p>`}`,
    ligar: () => app.querySelectorAll(".conteudo .chip").forEach((b) => b.addEventListener("click", () => {
      const n = itens[b.dataset.i];
      const sel = !perfil[campo].includes(n);
      perfil[campo] = sel ? [...perfil[campo], n] : perfil[campo].filter((x) => x !== n);
      b.classList.toggle("sel", sel);
      b.setAttribute("aria-pressed", String(sel));
      atualizarBotao();
    })),
    valido: () => opcional || perfil[campo].length > 0,
  };
}

// Textos que mudam conforme o perfil.
const TEXTOS_AREA = {
  recem: { titulo: "Você já tem uma área de foco?", sub: "Se ainda atua de forma geral, pode deixar em branco.", placeholder: "Ex.: cirurgia do trauma, hepatologia…" },
  experiente: { titulo: "Qual é a sua área de atuação?", sub: "A subespecialidade ou o tipo de paciente que você mais atende.", placeholder: "Ex.: cirurgia bariátrica, oncologia mamária…" },
  professor: { titulo: "O que você ensina?", sub: "A disciplina, o módulo ou a área em que você dá aulas ou preceptoria.", placeholder: "Ex.: semiologia, cirurgia do aparelho digestivo…" },
  outro: { titulo: "Qual é a sua área de atuação ou foco?", sub: "Escreva com as suas palavras.", placeholder: "Ex.: cuidados paliativos, medicina esportiva…" },
};
const textoArea = (k) => (TEXTOS_AREA[grupo()] || TEXTOS_AREA.outro)[k];
const EXEMPLOS_SOBRE = {
  estudante: "Ex.: Estou no internato de cirurgia e vou prestar residência em 2027. Quero reforçar abdome agudo.",
  residente: "Ex.: Vou prestar R+ em Cirurgia do Aparelho Digestivo. Tenho dificuldade com distúrbios ácido-base.",
  recem: "Ex.: Faço plantões de pronto-socorro e quero ganhar segurança em sepse e via aérea.",
  experiente: "Ex.: Opero principalmente sleeve e bypass; quero acompanhar o impacto dos GLP-1 na indicação cirúrgica.",
  professor: "Ex.: Coordeno a liga de cirurgia e preparo aulas mensais para os internos.",
  outro: "Ex.: Conte o que você faz hoje e o que quer melhorar.",
};
const TITULO_CURSANDO = {
  basico: "Qual disciplina você está cursando?",
  clinico: "Qual módulo ou disciplina você está cursando?",
  internato: "Em qual estágio do internato você está?",
};
function marcarSugestaoIgual(valor) {
  document.querySelectorAll("#sugestoes .chip").forEach((b) => {
    const igual = normalizar(b.textContent) === normalizar(valor);
    b.classList.toggle("sel", igual);
    b.setAttribute("aria-pressed", String(igual));
    b.querySelector(".ico").outerHTML = icone(igual ? "check" : "mais", 16);
  });
}

const PASSOS = [
  {
    id: "nome",
    titulo: () => "Como podemos te chamar?",
    sub: () => "Opcional — só para deixar o app mais pessoal.",
    render: () => `<input class="campo" type="text" id="nome" placeholder="Seu nome" autocomplete="given-name" value="${esc(perfil.nome)}">`,
    ligar: () => document.getElementById("nome").addEventListener("input", (e) => (perfil.nome = e.target.value.trim())),
    valido: () => true,
  },
  {
    id: "carreira",
    titulo: () => "Em que momento da carreira você está?",
    sub: () => "Isso define a profundidade e o tipo de artigo que vamos buscar.",
    render: () => opcoes(CARREIRA, [perfil.carreira]) + campoOutro("carreiraLivre", perfil.carreira === "outro", "Ex.: R4 de cirurgia do aparelho digestivo, fellow em transplante…"),
    ligar: () => {
      ligarOpcoes((id) => {
        const antes = grupo();
        perfil.carreira = id;
        if (grupo() !== antes) perfil.objetivos = []; // cada perfil tem os seus próprios objetivos
        mostrarOutro(id === "outro");
      });
      ligarCampoOutro("carreiraLivre");
    },
    valido: () => !!perfil.carreira && (perfil.carreira !== "outro" || perfil.carreiraLivre.length > 2),
  },
  // ----- Estudante -----
  {
    id: "fase",
    mostrar: () => grupo() === "estudante",
    titulo: () => "Em que fase do curso você está?",
    sub: () => "Assim a profundidade dos artigos combina com o que você já viu.",
    render: () => opcoes(FASES_CURSO, [perfil.fase]),
    ligar: () => ligarOpcoes((id) => { if (id !== perfil.fase) perfil.cursando = ""; perfil.fase = id; }),
    valido: () => !!perfil.fase,
  },
  {
    ...passoTextoLivre({
      id: "cursando", campo: "cursando", tipoSug: "cursando",
      titulo: () => TITULO_CURSANDO[perfil.fase] || "O que você está cursando agora?",
      sub: () => "Os artigos acompanham o que você está vendo agora — dá para trocar a qualquer momento.",
      placeholder: () => (perfil.fase === "internato" ? "Ex.: Cirurgia Geral, Pediatria…" : "Ex.: Fisiologia, Cardiologia…"),
      opcional: () => perfil.fase !== "internato",
      rotuloSug: () => (perfil.fase === "internato" ? "Estágios comuns" : "Disciplinas comuns"),
    }),
    mostrar: () => grupo() === "estudante",
  },
  {
    ...passoTextoLivre({
      id: "interesse", campo: "interesse", tipoSug: "interesse", opcional: true, lista: "lista-esp",
      titulo: () => "Já pensa em alguma especialidade?",
      sub: () => "Se sim, incluímos temas dessa área de vez em quando. Se não, tudo bem.",
      placeholder: "Ex.: Cirurgia Geral, Pediatria… ou deixe em branco",
      rotuloSug: "Mais procuradas",
    }),
    mostrar: () => grupo() === "estudante",
  },
  // ----- Formados e residentes -----
  {
    id: "especialidade",
    mostrar: () => grupo() !== "estudante",
    titulo: () => (grupo() === "residente" ? "Qual é a sua residência?" : "Qual é a sua especialidade?"),
    sub: () => "Pode ser qualquer especialidade, subespecialidade ou área — escreva do seu jeito.",
    render: () => `
      <input class="campo" type="text" id="esp" list="lista-esp" placeholder="Ex.: Cirurgia Geral, Hepatologia, Medicina Paliativa…" value="${esc(perfil.especialidade)}" autocomplete="off">
      <datalist id="lista-esp">${ESPECIALIDADES_CFM.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
      <div class="grupo-titulo rotulo">Mais comuns</div>
      <div class="chips" id="sugestoes">${MAIS_COMUNS.map((n, i) => `<button class="chip sugestao" data-i="${i}">${icone("mais", 16)}${esc(n)}</button>`).join("")}</div>`,
    ligar: () => {
      const input = document.getElementById("esp");
      const definir = (v) => {
        if (normalizar(v) !== normalizar(perfil.especialidade)) Object.assign(perfil, { rodizio: "", area: "", temas: [] });
        perfil.especialidade = v.trim();
        marcarSugestaoIgual(v);
        atualizarBotao();
      };
      input.addEventListener("input", () => definir(input.value));
      app.querySelectorAll("#sugestoes .chip").forEach((b) => b.addEventListener("click", () => { input.value = MAIS_COMUNS[b.dataset.i]; definir(input.value); }));
      marcarSugestaoIgual(input.value);
    },
    valido: () => perfil.especialidade.length > 2,
  },
  {
    ...passoTextoLivre({
      id: "rodizio", campo: "rodizio", tipoSug: "rodizio",
      titulo: () => "Em qual rodízio você está agora?",
      sub: () => "Escreva qualquer rodízio ou estágio. O artigo do dia acompanha o seu rodízio — dá para trocar a qualquer momento.",
      placeholder: "Ex.: Urologia, UTI, Transplante hepático…",
      rotuloSug: "Rodízios comuns",
    }),
    mostrar: () => grupo() === "residente",
  },
  {
    ...passoTextoLivre({
      id: "area", campo: "area", tipoSug: "area",
      opcional: () => ["recem", "outro"].includes(grupo()),
      titulo: () => textoArea("titulo"),
      sub: () => textoArea("sub"),
      placeholder: () => textoArea("placeholder"),
    }),
    mostrar: () => ["recem", "experiente", "professor", "outro"].includes(grupo()),
  },
  {
    ...passoChipsMultiplos({
      id: "cenarios", campo: "cenarios", itens: CENARIOS, opcional: true,
      titulo: () => "Onde você atua hoje?",
      sub: () => "Ajuda a escolher artigos que conversam com a sua rotina.",
    }),
    mostrar: () => ["recem", "experiente"].includes(grupo()),
  },
  {
    ...passoChipsMultiplos({
      id: "publico", campo: "publico", itens: PUBLICOS,
      titulo: () => "Para quem você ensina?",
      sub: () => "O nível dos artigos e dos resumos acompanha o seu público.",
    }),
    mostrar: () => grupo() === "professor",
  },
  {
    id: "objetivos",
    titulo: () => "Quais são os seus objetivos agora?",
    sub: () => "Escolha quantos quiser — os dias de estudo vão alternar entre eles.",
    render: () => {
      const validos = objetivosDoGrupo().map((o) => o.id);
      perfil.objetivos = perfil.objetivos.filter((id) => validos.includes(id));
      return opcoes(objetivosDoGrupo(), perfil.objetivos, false, true) + campoOutro("objetivoLivre", perfil.objetivos.includes("outro"), "Ex.: me preparar para o R+ de digestivo em 2027");
    },
    ligar: () => {
      ligarOpcoes((id, marcado) => {
        perfil.objetivos = marcado ? [...perfil.objetivos, id] : perfil.objetivos.filter((x) => x !== id);
        if (id === "outro") mostrarOutro(marcado);
      }, true);
      ligarCampoOutro("objetivoLivre");
    },
    valido: () => perfil.objetivos.length > 0 && (!perfil.objetivos.includes("outro") || perfil.objetivoLivre.length > 2),
  },
  {
    id: "sobre",
    titulo: () => "Quer contar mais alguma coisa?",
    sub: () => "Quanto mais o app souber sobre você, melhor a escolha dos artigos.",
    render: () => `
      <textarea class="campo area-texto" id="sobre" rows="5" placeholder="${esc(EXEMPLOS_SOBRE[grupo()])}">${esc(perfil.sobre)}</textarea>
      <p class="dica">Opcional.</p>`,
    ligar: () => document.getElementById("sobre").addEventListener("input", (e) => (perfil.sobre = e.target.value.trim())),
    valido: () => true,
  },
  {
    id: "temas",
    titulo: () => "Como você quer montar a sua trilha?",
    sub: () => "Dá para mudar a qualquer momento.",
    render: () => `
      ${opcoes([
        { id: "auto", rotulo: "Monte a trilha para mim", desc: "O app escolhe os temas com base no que você contou", icone: "brilho" },
        { id: "manual", rotulo: "Quero escolher os temas", desc: "Digite qualquer tema, do jeito que você falaria", icone: "lapis" },
      ], [perfil.modoTemas])}
      <div id="area-temas" style="margin-top:8px"></div>`,
    ligar: () => {
      ligarOpcoes((id) => {
        if (id !== perfil.modoTemas) perfil.temas = [];
        perfil.modoTemas = id;
        desenharAreaTemas();
      });
      desenharAreaTemas();
    },
    valido: () => perfil.modoTemas === "auto" || perfil.temas.length > 0,
  },
  {
    id: "tempo",
    titulo: () => "Quanto tempo por dia você tem para estudar?",
    sub: () => "A videoaula, o resumo e o miniteste se ajustam a esse tempo.",
    render: () => opcoes([
      { id: "10", rotulo: "Cerca de 10 minutos", desc: "Videoaula + resumo + 5 perguntas", icone: "relogio" },
      { id: "20", rotulo: "20 minutos ou mais", desc: "Videoaula mais completa + resumo + leitura do artigo", icone: "livro" },
    ], [perfil.tempo]),
    ligar: () => ligarOpcoes((id) => (perfil.tempo = id)),
    valido: () => !!perfil.tempo,
  },
];
const passosAtivos = () => PASSOS.filter((p) => !p.mostrar || p.mostrar());

// Passo de temas: prévia da trilha automática ou campo para digitar os temas.
function desenharAreaTemas() {
  const area = document.getElementById("area-temas");
  if (!area) return;
  if (perfil.modoTemas === "auto") {
    area.innerHTML = `
      <div class="grupo-titulo rotulo">Para começar, a sua trilha terá</div>
      <div class="chips" id="sugestoes"></div>
      <p class="dica">A trilha vai se ajustando conforme você estuda. Quer outros temas? Escolha "Quero escolher os temas".</p>`;
    // Prévia só para leitura; a mesma trilha (já em memória) é a que o plano vai usar.
    carregarSugestoes("trilha", null, undefined, true);
    obterSugestoes("trilha").then((lista) => {
      if (perfil.modoTemas === "auto") perfil.temas = lista.map((t) => (typeof t === "string" ? { pt: t } : { ...t }));
    }).catch(() => {});
  } else {
    area.innerHTML = `
      <form class="adicionar" id="form-tema">
        <input class="campo" type="text" id="novo-tema" placeholder="Ex.: hérnia de hiato recidivada" autocomplete="off">
        <button class="btn primario quadrado" aria-label="Adicionar tema">${icone("mais")}</button>
      </form>
      <div class="grupo-titulo rotulo">Seus temas (1 a 8)</div>
      <div class="chips" id="meus-temas"></div>
      <div class="grupo-titulo rotulo">Sugestões para você</div>
      <div class="chips" id="sugestoes"></div>`;
    desenharMeusTemas();
    document.getElementById("form-tema").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = document.getElementById("novo-tema");
      if (adicionarTema({ pt: input.value.trim() })) input.value = "";
    });
    carregarSugestoes("temas", (item) => {
      const t = typeof item === "string" ? { pt: item } : item;
      if (temaJaEscolhido(t.pt)) removerTema(t.pt); else adicionarTema(t);
    }, () => perfil.temas.map((t) => t.pt));
  }
  atualizarBotao();
}

function adicionarTema(t) {
  if (!t.pt || t.pt.length < 3) return false;
  if (temaJaEscolhido(t.pt)) { toast("Esse tema já está na lista"); return false; }
  if (perfil.temas.length >= 8) { toast("Escolha no máximo 8 temas"); return false; }
  perfil.temas.push(t);
  desenharMeusTemas();
  return true;
}
function removerTema(pt) {
  perfil.temas = perfil.temas.filter((t) => normalizar(t.pt) !== normalizar(pt));
  desenharMeusTemas();
}
function desenharMeusTemas() {
  const caixa = document.getElementById("meus-temas");
  if (!caixa) return;
  caixa.innerHTML = perfil.temas.length
    ? perfil.temas.map((t, i) => `<button class="chip sel removivel" data-i="${i}" aria-label="Remover ${esc(t.pt)}">${esc(t.pt)}${icone("fechar", 14)}</button>`).join("")
    : `<p class="dica" style="margin:0">Nenhum tema ainda. Digite acima ou toque numa sugestão.</p>`;
  caixa.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => removerTema(perfil.temas[b.dataset.i].pt)));
  document.querySelectorAll("#sugestoes .chip").forEach((b) => {
    const sel = temaJaEscolhido(b.textContent);
    b.classList.toggle("sel", sel);
    b.setAttribute("aria-pressed", String(sel));
    b.querySelector(".ico").outerHTML = icone(sel ? "check" : "mais", 16);
  });
  atualizarBotao();
}

function opcoes(itens, selecionados, compacta = false, multipla = false) {
  return `<div class="opcoes" ${multipla ? 'role="group"' : ""}>${itens.map((i) => {
    const sel = selecionados.includes(i.id);
    return `
    <button class="opcao ${compacta ? "compacta" : ""} ${multipla ? "multipla" : ""} ${sel ? "sel" : ""}" data-id="${esc(i.id)}" aria-pressed="${sel}">
      ${i.icone ? `<span class="ico-caixa">${icone(i.icone)}</span>` : ""}
      <span class="txt"><strong>${esc(i.rotulo)}</strong>${i.desc ? `<span class="desc">${esc(i.desc)}</span>` : ""}</span>
      <span class="marcar">${icone("check", 14)}</span>
    </button>`;
  }).join("")}</div>`;
}
function campoOutro(campo, visivel, placeholder) {
  return `<div id="caixa-outro" ${visivel ? "" : "hidden"} style="margin-top:10px">
    <input class="campo" type="text" id="campo-outro" placeholder="${esc(placeholder)}" value="${esc(perfil[campo])}">
  </div>`;
}
function mostrarOutro(visivel) {
  document.getElementById("caixa-outro").hidden = !visivel;
  if (visivel) document.getElementById("campo-outro").focus();
}
function ligarCampoOutro(campoLivre) {
  document.getElementById("campo-outro").addEventListener("input", (e) => { perfil[campoLivre] = e.target.value.trim(); atualizarBotao(); });
}
// Escolha única (padrão) ou múltipla. Liga só as opções do bloco onde cada botão está.
function ligarOpcoes(aoEscolher, multipla = false) {
  app.querySelectorAll(".opcoes").forEach((grupo) => {
    grupo.querySelectorAll(":scope > .opcao").forEach((b) => b.addEventListener("click", () => {
      let marcado = true;
      if (multipla) {
        marcado = !b.classList.contains("sel");
        b.classList.toggle("sel", marcado);
      } else {
        grupo.querySelectorAll(".opcao").forEach((x) => { x.classList.remove("sel"); x.setAttribute("aria-pressed", "false"); });
        b.classList.add("sel");
      }
      b.setAttribute("aria-pressed", String(marcado));
      aoEscolher(b.dataset.id, marcado);
      atualizarBotao();
    }));
  });
}
function atualizarBotao() {
  const b = document.getElementById("avancar");
  const p = passosAtivos()[passo];
  if (b && p) b.disabled = !p.valido();
}

function telaBoasVindas() {
  telaAtual = "boas-vindas";
  app.innerHTML = `
    <div class="tela">
      <div class="marca"><span class="logo">${icone("livro", 18)}</span>AtualizaMed</div>
      <div class="arte" aria-hidden="true">
        <div class="carta c3"></div>
        <div class="carta c2"></div>
        <div class="carta c1">
          <span class="pilula-modo" style="--modo: var(--m-fundamentos)">${icone("livro", 14)} Artigo de hoje</span>
          <div class="barra serif" style="width:92%;margin-top:16px"></div>
          <div class="barra serif" style="width:70%"></div>
          <div class="barra" style="width:55%;margin-top:14px"></div>
          <div class="selos"><span class="selo diretriz">Diretriz</span><span class="selo ecr">ECR</span></div>
          <div class="anel">
            <svg class="progresso" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--surface-2)" stroke-width="3"/><circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--brand)" stroke-width="3" stroke-linecap="round" stroke-dasharray="78 97.4"/></svg>
            <div><strong>4/5</strong><span>miniteste</span></div>
          </div>
        </div>
      </div>
      <h1 class="titulo-xl">Um artigo por dia, escolhido para você.</h1>
      <p class="sub">Conte quem você é e o que quer — com as suas palavras. O app monta a sua trilha e escolhe a leitura certa de cada dia.</p>
      <ul class="beneficios">
        <li><span class="ico-caixa">${icone("alvo")}</span><div><strong>100% do seu jeito</strong><span>Qualquer especialidade, rodízio, área ou tema — ou deixe o app montar a trilha.</span></div></li>
        <li><span class="ico-caixa">${icone("teste")}</span><div><strong>Resumo didático e miniteste</strong><span>Em português, para fixar o que importa em poucos minutos.</span></div></li>
        <li><span class="ico-caixa">${icone("chat")}</span><div><strong>IA para tirar dúvidas</strong><span>Pergunte sobre o artigo do dia quando quiser.</span></div></li>
      </ul>
    </div>
    <div class="rodape-fixo">
      <button class="btn primario largo" id="comecar">Começar ${icone("seta")}</button>
      <p class="nota">Leva cerca de 1 minuto</p>
    </div>`;
  document.getElementById("comecar").onclick = () => { passo = 0; telaPasso(); };
}

function telaPasso() {
  telaAtual = "passo";
  const lista = passosAtivos();
  passo = Math.min(Math.max(passo, 0), lista.length - 1);
  const p = lista[passo];
  const ultimo = passo === lista.length - 1;
  app.innerHTML = `
    <div class="tela">
      <div class="onb-topo">
        <button class="btn-icone" id="voltar" aria-label="Voltar">${icone("voltar")}</button>
        <div class="segmentos">${lista.map((_, i) => `<span class="${i <= passo ? "feito" : ""}"></span>`).join("")}</div>
        <span class="contador">${passo + 1}/${lista.length}</span>
      </div>
      <div class="onb-corpo">
        <h1>${esc(p.titulo())}</h1>
        <p class="sub">${esc(p.sub())}</p>
        <div class="conteudo">${p.render()}</div>
      </div>
    </div>
    <div class="rodape-fixo">
      <button class="btn primario largo" id="avancar">${ultimo || (voltarParaPlano && p.id === "temas") ? "Montar meu plano" : "Continuar"}</button>
    </div>`;
  p.ligar();
  atualizarBotao();
  window.scrollTo(0, 0);
  document.getElementById("voltar").onclick = () => {
    if (voltarParaPlano) { voltarParaPlano = false; salvar(); return telaPlano(); }
    if (passo === 0) return telaBoasVindas();
    passo--; telaPasso();
  };
  document.getElementById("avancar").onclick = () => {
    if (voltarParaPlano && p.id === "temas") { voltarParaPlano = false; salvar(); return telaPlano(); }
    if (passo < passosAtivos().length - 1) { passo++; telaPasso(); }
    else { voltarParaPlano = false; salvar(); telaPlano(); }
  };
}

function irParaPasso(id, retornar = true) {
  passo = Math.max(0, passosAtivos().findIndex((p) => p.id === id));
  voltarParaPlano = retornar;
  telaPasso();
}

// ---------- Estratégias de busca ----------
// Cada objetivo vira um "modo"; com vários objetivos, os temas alternam entre os modos.
function modosDoPerfil() {
  const texto = normalizar(`${perfil.objetivoLivre} ${perfil.sobre}`);
  const modos = perfil.objetivos.map((id) => {
    if (id !== "outro") return objetivoDef(id)?.modo;
    if (/aula|ensin|preceptor/.test(texto)) return "ensino";
    if (/prova|titulo|r\+|concurso|residencia/.test(texto)) return "prova";
    return null;
  }).filter(Boolean);
  if (!modos.length) modos.push(["estudante", "residente"].includes(grupo()) ? "fundamentos" : "atualizacao");
  return [...new Set(modos)];
}

const ano = () => new Date().getFullYear();
function dataMenos(meses) {
  const d = new Date();
  d.setMonth(d.getMonth() - meses);
  return d.toISOString().slice(0, 10);
}

const ESTRATEGIAS = {
  fundamentos: {
    rotulo: "Fundamentos", icone: "livro",
    frase: "revisões consagradas e diretrizes, em linguagem didática, para construir uma base sólida",
    filtro: '(PUB_TYPE:"review" OR PUB_TYPE:"practice guideline" OR PUB_TYPE:"systematic review")',
    periodo: () => `PUB_YEAR:[${ano() - 10} TO ${ano()}]`,
    ordem: "CITED desc",
  },
  prova: {
    rotulo: "Prova", icone: "alvo",
    frase: "diretrizes e revisões de referência — o que costuma ser cobrado — com miniteste no estilo de prova",
    filtro: '(PUB_TYPE:"practice guideline" OR PUB_TYPE:"consensus statement" OR PUB_TYPE:"review")',
    periodo: () => `PUB_YEAR:[${ano() - 8} TO ${ano()}]`,
    ordem: "CITED desc",
  },
  ensino: {
    rotulo: "Ensino", icone: "capelo",
    frase: "diretrizes e revisões de referência recentes, para preparar aulas e discutir com residentes",
    filtro: '(PUB_TYPE:"practice guideline" OR PUB_TYPE:"review" OR PUB_TYPE:"systematic review")',
    periodo: () => `PUB_YEAR:[${ano() - 5} TO ${ano()}]`,
    ordem: "CITED desc",
  },
  atualizacao: {
    rotulo: "Atualização", icone: "brilho",
    frase: "só o que é novo: ensaios clínicos, meta-análises e diretrizes dos últimos 18 meses, com foco no que muda o cuidado",
    filtro: '(PUB_TYPE:"randomized controlled trial" OR PUB_TYPE:"meta-analysis" OR PUB_TYPE:"systematic review" OR PUB_TYPE:"practice guideline")',
    periodo: () => `FIRST_PDATE:[${dataMenos(18)} TO ${dataMenos(0)}]`,
    ordem: "P_PDATE_D desc",
  },
};

async function consultarEuropePMC(consulta, est, qtd) {
  const url = "https://www.ebi.ac.uk/europepmc/webservices/rest/search?" + new URLSearchParams({
    query: consulta, format: "json", pageSize: String(qtd + 6), resultType: "core", sort: est.ordem,
  });
  const r = await fetch(url);
  if (!r.ok) throw new Error("Falha na busca");
  return (await r.json()).resultList?.result || [];
}

// Busca no título; se vier pouca coisa (tema raro ou escrito de forma diferente), amplia para o resumo.
async function buscar(tema, idModo, qtd = 4) {
  const est = ESTRATEGIAS[idModo];
  const q = tema.q;
  // Exclui artigos de COVID-19, que dominam as listas de "mais citados" de 2020–2022 sem ser o foco do tema.
  const semCovid = /covid|sars/i.test(q) ? "" : ' AND NOT TITLE:(COVID OR "SARS-CoV-2" OR coronavirus)';
  const resto = ` AND ${est.filtro} AND ${est.periodo()} AND HAS_ABSTRACT:y${semCovid}`;
  let lista = await consultarEuropePMC(`TITLE:(${q})${resto}`, est, qtd);
  if (lista.length < 2) lista = lista.concat(await consultarEuropePMC(`(TITLE:(${q}) OR ABSTRACT:(${q}))${resto}`, est, qtd));
  const vistos = new Set();
  return lista.filter((a) => !vistos.has(a.id) && vistos.add(a.id))
    .map((a) => ({ ...a, tema: tema.pt, modo: idModo, revista: revistaDe(a), tipos: tiposDe(a).map((t) => t.nome) }))
    .sort((a, b) => pontuar(b) - pontuar(a)).slice(0, qtd);
}

// Ajuste de ordem: diretrizes, acesso aberto (texto completo disponível) e versões mais novas primeiro.
function pontuar(a) {
  const tipos = tiposDe(a).map((x) => x.nome);
  let p = 0;
  if (tipos.includes("Diretriz")) p += 3;
  if (tipos.includes("Meta-análise") || tipos.includes("ECR")) p += 2;
  if (a.isOpenAccess === "Y") p += 2;
  p += Math.max(0, 10 - (ano() - Number(a.pubYear || 0))) * 0.2;
  return p;
}

function tiposDe(a) {
  const t = (a.pubTypeList?.pubType || []).map((x) => x.toLowerCase());
  const s = [];
  if (t.some((x) => x.includes("guideline") || x.includes("consensus"))) s.push({ nome: "Diretriz", cls: "diretriz" });
  if (t.some((x) => x.includes("meta-analysis"))) s.push({ nome: "Meta-análise", cls: "meta-analise" });
  else if (t.some((x) => x.includes("systematic review"))) s.push({ nome: "Revisão sistemática", cls: "meta-analise" });
  if (t.some((x) => x.includes("randomized controlled trial"))) s.push({ nome: "ECR", cls: "ecr" });
  if (!s.length && t.some((x) => x.includes("review"))) s.push({ nome: "Revisão", cls: "revisao" });
  return s;
}

function selos(a) {
  return tiposDe(a).map((t) => `<span class="selo ${t.cls}">${t.nome}</span>`).join("") +
    (a.isOpenAccess === "Y" ? `<span class="selo aberto">${icone("aberto")}Acesso aberto</span>` : "");
}

// Motivo da escolha sem IA (com IA, o motivo vem personalizado do modelo).
function porQue(a) {
  if (a.motivo) return a.motivo;
  const tipos = tiposDe(a).map((x) => x.nome);
  const meses = a.firstPublicationDate ? Math.max(1, Math.round((Date.now() - new Date(a.firstPublicationDate)) / 2.63e9)) : null;
  const contexto = grupo() === "residente" && perfil.rodizio ? ` Escolhido para o seu rodízio de ${perfil.rodizio}.`
    : grupo() === "estudante" && perfil.cursando ? ` Escolhido para o que você está vendo agora: ${perfil.cursando}.` : "";
  if (a.modo === "atualizacao") {
    if (tipos.includes("ECR")) return `Ensaio clínico randomizado publicado há ${meses ?? "poucos"} ${meses === 1 ? "mês" : "meses"} — evidência nova que pode mudar condutas.`;
    if (tipos.includes("Diretriz")) return "Diretriz recente — veja o que mudou em relação à anterior.";
    if (tipos.includes("Meta-análise")) return "Meta-análise recente — resume a evidência mais atual sobre o tema.";
    return "Revisão sistemática recente sobre um tema da sua área de atuação.";
  }
  if (tipos.includes("Diretriz")) return `Diretriz citada ${a.citedByCount} vezes — referência para o dia a dia e para provas.${contexto}`;
  if (tipos.includes("Meta-análise") || tipos.includes("Revisão sistemática")) return `Síntese da evidência, citada ${a.citedByCount} vezes — boa base para entender o tema.${contexto}`;
  return `Revisão citada ${a.citedByCount} vezes — leitura de referência para construir a base.${contexto}`;
}

const linkDe = (a) => (a.pmcid ? `https://europepmc.org/article/PMC/${a.pmcid}` : `https://europepmc.org/article/${a.source}/${a.id}`);
const revistaDe = (a) => a.journalInfo?.journal?.medlineAbbreviation || a.journalInfo?.journal?.title || "";
const tituloDe = (a) => a.tituloPt || limparHtml(a.title);

// ---------- Tela "Hoje" ----------
let artigos = new Map();
let geracao = 0;
// A fila do dia fica guardada no aparelho: voltar do estudo ou reabrir o app no mesmo dia não refaz buscas nem gasta IA.
let filaCache = null;
const CHAVE_FILA = "atualizamed.fila";
function lerFilaSalva() { try { return JSON.parse(localStorage.getItem(CHAVE_FILA)); } catch { return null; } }
function salvarFila(f) { try { localStorage.setItem(CHAVE_FILA, JSON.stringify(f)); } catch { /* sem espaço: segue só em memória */ } }

async function telaPlano() {
  telaAtual = "plano";
  const minhaGeracao = ++geracao;
  const modos = modosDoPerfil();
  const agora = new Date();
  const saudacao = agora.getHours() < 12 ? "Bom dia" : agora.getHours() < 18 ? "Boa tarde" : "Boa noite";
  const dataBruta = agora.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const dataTxt = dataBruta.charAt(0).toUpperCase() + dataBruta.slice(1);
  const g = grupo();
  const CONTEXTO = {
    estudante: { valor: perfil.cursando, rotulo: perfil.fase === "internato" ? "Estágio do internato" : "Cursando agora", icone: "livro", passo: "cursando" },
    residente: { valor: perfil.rodizio, rotulo: `Rodízio atual${anoResidencia() ? ` · R${anoResidencia()}` : ""}`, icone: "rota", passo: "rodizio" },
    professor: { valor: perfil.area, rotulo: "Você ensina", icone: "capelo", passo: "area" },
  };
  const ctx = CONTEXTO[g] || { valor: perfil.area, rotulo: "Área de atuação", icone: "alvo", passo: "area" };
  const linhaPerfil = g === "estudante"
    ? ["Estudante", faseTexto(), perfil.interesse && `interesse em ${perfil.interesse}`].filter(Boolean).join(" · ")
    : `${carreiraTexto()} · ${perfil.especialidade}`;
  const auto = perfil.modoTemas === "auto";
  artigos = new Map();

  app.innerHTML = `
    <div class="tela">
      <header class="hoje-topo">
        <div>
          <p class="data">${esc(dataTxt)}</p>
          <h1 class="titulo-lg">${saudacao}${perfil.nome ? `, ${esc(perfil.nome)}` : ""}</h1>
        </div>
        <span class="sequencia" title="Dias seguidos estudando">${icone("chama", 16)} ${diasSeguidos()} ${diasSeguidos() === 1 ? "dia" : "dias"}</span>
      </header>

      ${ctx.valor ? `
        <button class="contexto" id="trocar-contexto">
          <span class="ico-caixa">${icone(ctx.icone)}</span>
          <span class="txt"><span class="rotulo">${esc(ctx.rotulo)}</span><strong>${esc(ctx.valor)}</strong></span>
          <span class="link">Trocar</span>
        </button>` : ""}

      <div class="secao"><h2>Artigo de hoje</h2></div>
      <div id="hoje">${esqueletoDestaque(auto ? "Montando a sua trilha…" : "Buscando os melhores artigos para você…")}</div>

      <div class="secao"><h2>Próximos dias</h2></div>
      <div id="fila" class="lista">${esqueletoItem()}${esqueletoItem()}${esqueletoItem()}</div>

      <div class="secao"><h2>Seu plano</h2><button class="link" id="editar">${icone("lapis", 16)}Editar respostas</button></div>
      <div class="plano">
        <div class="pilulas">${modos.map((m) => `<span class="pilula-modo" data-modo="${m}">${icone(ESTRATEGIAS[m].icone, 14)} ${ESTRATEGIAS[m].rotulo}</span>`).join("")}</div>
        <p class="perfil-linha">${esc(linhaPerfil)}</p>
        <ul>${modos.map((m) => `<li>${icone("check", 16)}<span><strong>${ESTRATEGIAS[m].rotulo}:</strong> ${ESTRATEGIAS[m].frase}.</span></li>`).join("")}</ul>
        <div class="grupo-titulo rotulo" style="margin-top:18px">${auto ? `${icone("brilho", 12)} Trilha montada pelo app` : "Seus temas"}</div>
        <div class="chips" id="temas-plano">${auto ? `<span class="sk chip-sk" style="width:120px"></span><span class="sk chip-sk" style="width:90px"></span>` : chipsTemasPlano()}</div>
        <div class="acoes-plano">
          ${auto ? `<button class="link" id="nova-trilha">${icone("relogio", 16)}Gerar outra trilha</button>` : ""}
          <button class="link" id="editar-temas">${icone("lapis", 16)}${auto ? "Escolher meus temas" : "Editar temas"}</button>
        </div>
      </div>
    </div>
    ${barraAbas("Hoje")}`;
  ligarAbas();

  document.getElementById("editar").onclick = () => { passo = 0; voltarParaPlano = false; telaPasso(); };
  document.getElementById("editar-temas").onclick = () => { if (auto) { perfil.modoTemas = "manual"; perfil.temas = []; } irParaPasso("temas"); };
  document.getElementById("nova-trilha")?.addEventListener("click", () => { perfil.temas = []; filaCache = null; salvarFila(null); memoSugestoes.clear(); telaPlano(); });
  document.getElementById("trocar-contexto")?.addEventListener("click", () => irParaPasso(ctx.passo));

  const chaveFila = JSON.stringify([hojeISO(), perfil]);
  try {
    let fila;
    if (!filaCache) filaCache = lerFilaSalva();
    // Situação do dia no servidor: aula nova de hoje (se já gerou) e aulas de dias anteriores.
    meuDia = await fetch("/api/meu-dia").then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    if (minhaGeracao !== geracao) return;
    const feita = (a) => jaEstudado(a.id) || (meuDia.aulasAntes || []).includes(String(a.id));
    // Dia novo com o mesmo perfil: a fila continua (o "Libera amanhã" de ontem vira o artigo de hoje).
    const mesmoPerfil = (() => { try { return JSON.stringify(JSON.parse(filaCache.chave)[1]) === JSON.stringify(perfil); } catch { return false; } })();
    if (filaCache && filaCache.chave !== chaveFila && mesmoPerfil && filaCache.fila.filter((a) => !feita(a)).length >= 3) {
      filaCache = { chave: chaveFila, fila: filaCache.fila.filter((a) => !feita(a)) };
      salvarFila(filaCache);
    }
    if (filaCache?.chave === chaveFila) fila = filaCache.fila;
    else {
    // 0. Trilha automática: o app escolhe os temas a partir do perfil (IA ou, sem ela, catálogo/texto do perfil).
    if (auto && !perfil.temas.length) {
      perfil.temas = (await obterSugestoes("trilha")).map((t) => (typeof t === "string" ? { pt: t } : { ...t }));
      salvar();
    }
    if (minhaGeracao !== geracao) return;
    document.getElementById("temas-plano").innerHTML = chipsTemasPlano();

    // 1. Cada tema (texto livre) vira uma consulta em inglês: catálogo → IA → tradução gratuita.
    for (const t of perfil.temas) t.q = t.q || (await IA.consultaPara(t, perfilIA()));
    salvar();
    if (minhaGeracao !== geracao) return;

    // 2. Busca (cada tema num dos modos, alternando) e intercala para a fila não ficar num assunto só.
    const listas = await Promise.all(perfil.temas.map((t, i) => buscar(t, modos[i % modos.length], 4).catch(() => [])));
    fila = [];
    const vistos = new Set();
    for (let i = 0; i < 4; i++) for (const l of listas) if (l[i] && !vistos.has(l[i].id)) { vistos.add(l[i].id); fila.push(l[i]); }

    // 3. Com IA: escolhe, ordena, traduz o título e explica a escolha para este médico.
    if (IA.conectada() && fila.length) {
      try {
        const escolha = await IA.escolherArtigos(perfilIA(), fila.slice(0, 14));
        const porId = new Map(fila.map((a) => [a.id, a]));
        const ordenada = escolha.map((e) => porId.get(e.id) && Object.assign(porId.get(e.id), { tituloPt: e.tituloPt, motivo: e.motivo })).filter(Boolean);
        if (ordenada.length) fila = ordenada;
      } catch (e) {
        console.warn("IA (escolha):", e.message);
      }
    }
    if (minhaGeracao !== geracao) return;
    filaCache = { chave: JSON.stringify([hojeISO(), perfil]), fila };
    salvarFila(filaCache);
    }
    document.getElementById("temas-plano").innerHTML = chipsTemasPlano();
    fila.forEach((a) => artigos.set(a.id, a));

    if (!fila.length) {
      document.getElementById("hoje").innerHTML = `<div class="vazio">Não encontramos artigos para esses temas.<br><button class="link" id="outros-temas">Escrever os temas de outro jeito</button></div>`;
      document.getElementById("outros-temas").onclick = () => { perfil.modoTemas = "manual"; irParaPasso("temas"); };
      document.getElementById("fila").innerHTML = "";
    } else {
      // Uma aula nova por dia: a de hoje fica aberta; as dos próximos dias aparecem travadas (o servidor também barra).
      const [hoje, ...resto] = fila;
      document.getElementById("hoje").innerHTML = cartaoDestaque(hoje);
      document.getElementById("fila").innerHTML = resto.slice(0, 6).map((a, i) => itemFila(a, i + 1)).join("");
    }
    app.querySelectorAll("[data-estudar]").forEach((b) => b.addEventListener("click", () => abrirEstudo(artigos.get(b.dataset.estudar))));
  } catch (e) {
    document.getElementById("hoje").innerHTML = `<div class="vazio">Não foi possível buscar os artigos (${esc(e.message)}).<br>Verifique a internet e tente de novo.</div>`;
  }
}

let meuDia = {}; // { ajuste, aulasHoje, aulasAntes, semLimite } vindo do servidor
const NIVEIS = [[-2, "Bem mais básico"], [-1, "Mais básico"], [0, "Padrão do meu perfil"], [1, "Mais aprofundado"],
  [2, "Bem mais aprofundado"], [3, "Máximo"]];
const liberado = (a) => meuDia.semLimite || jaEstudado(a.id) || (meuDia.aulasHoje || []).includes(String(a.id));
const hojeJaFeita = (a) => !meuDia.semLimite && (meuDia.aulasHoje || []).length > 0 && !liberado(a);

const chipsTemasPlano = () => perfil.temas.map((t) => `<span class="chip estatico">${esc(t.pt)}</span>`).join("") || `<p class="dica" style="margin:0">Sem temas ainda.</p>`;

function cartaoDestaque(a) {
  const est = ESTRATEGIAS[a.modo];
  return `
    <article class="destaque" data-modo="${a.modo}">
      <div class="destaque-topo">
        <span class="pilula-modo">${icone(est.icone, 14)} ${est.rotulo}</span>
        <span class="tempo">${icone("relogio", 15)} ${esc(perfil.tempo)} min</span>
      </div>
      <p class="tema-linha">${esc(a.tema)}${jaEstudado(a.id) ? ` · <span class="feito-txt">${icone("check", 13)} Estudado</span>` : ""}</p>
      <h3 class="titulo-artigo">${esc(tituloDe(a))}</h3>
      ${a.tituloPt ? `<p class="titulo-original">${esc(limparHtml(a.title))}</p>` : ""}
      <p class="meta">${esc(a.revista)} · ${esc(a.pubYear)} · ${a.citedByCount ?? 0} citações</p>
      <div class="selos">${selos(a)}</div>
      <div class="porque"><span class="rotulo">${a.motivo ? `${icone("brilho", 12)} ` : ""}Por que para você</span><p>${esc(porQue(a))}</p></div>
      <ol class="trilha">
        <li><span class="bola">${icone("resumo")}</span>Resumo</li>
        <li><span class="bola">${icone("documento")}</span>Artigo</li>
        <li><span class="bola">${icone("teste")}</span>Miniteste</li>
        <li><span class="bola">${icone("chat")}</span>Tire dúvidas</li>
      </ol>
      <div class="acoes-cartao">
        ${hojeJaFeita(a)
          ? `<button class="btn primario largo" disabled>${icone("cadeado", 18)} Sua aula de hoje já foi feita · libera amanhã</button>`
          : `<button class="btn primario largo" data-estudar="${esc(a.id)}">Começar a estudar ${icone("seta")}</button>`}
        <a class="link" href="${linkDe(a)}" target="_blank" rel="noopener">Abrir na fonte ${icone("externo", 15)}</a>
      </div>
    </article>`;
}

function itemFila(a, i) {
  const d = new Date();
  d.setDate(d.getDate() + i);
  const dia = d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
  const aberto = liberado(a);
  return `
    <button class="item${aberto ? "" : " bloqueado"}" ${aberto ? `data-estudar="${esc(a.id)}"` : `disabled aria-disabled="true"`} data-modo="${a.modo}">
      <span class="item-dia"><span>${esc(dia)}</span><strong>${d.getDate()}</strong></span>
      <span class="item-corpo">
        <span class="tema-linha" style="display:block">${esc(a.tema)} · <span class="modo-txt">${ESTRATEGIAS[a.modo].rotulo}</span>${jaEstudado(a.id) ? ` · <span class="feito-txt">${icone("check", 13)} Estudado</span>` : ""}</span>
        <h4>${esc(tituloDe(a))}</h4>
        ${aberto ? `<span class="selos">${selos(a)}</span>` : `<span class="libera">${icone("cadeado", 13)} Libera ${i === 1 ? "amanhã" : `em ${esc(dia)}, ${d.getDate()}`}</span>`}
      </span>
    </button>`;
}

const esqueletoDestaque = (legenda) => `
  <div class="destaque" aria-label="Carregando">
    <div class="sk" style="width:40%;height:22px"></div>
    <div class="sk" style="width:95%;height:22px;margin-top:20px"></div>
    <div class="sk" style="width:75%;height:22px;margin-top:8px"></div>
    <div class="sk" style="width:50%;height:14px;margin-top:14px"></div>
    <div class="sk" style="width:100%;height:64px;margin-top:18px"></div>
    <p class="legenda-carregando">${esc(legenda)}</p>
  </div>`;
const esqueletoItem = () => `<div class="item"><div class="sk" style="width:46px;height:52px"></div><div style="flex:1"><div class="sk" style="width:40%;height:12px"></div><div class="sk" style="width:95%;height:16px;margin-top:8px"></div><div class="sk" style="width:60%;height:16px;margin-top:6px"></div></div></div>`;

// ---------- Folhas inferiores ----------
const folha = document.getElementById("folha");
function abrirFolha(html) {
  document.getElementById("folha-conteudo").innerHTML = html;
  folha.showModal();
  folha.scrollTop = 0;
}
folha.addEventListener("click", (e) => { if (e.target === folha) folha.close(); });

// Ajustes do perfil. A IA é do próprio app: o médico não configura nada.
function abrirAjustes() {
  const resumo = [carreiraTexto(), faseTexto(), perfil.cursando, perfil.especialidade, perfil.rodizio || perfil.area].filter(Boolean).join(" · ");
  abrirFolha(`
    <span class="rotulo">Perfil</span>
    <h2 class="titulo-lg" style="margin-top:6px">Ajustes</h2>
    <div class="bloco-ajuste">
      <h3>Seu perfil</h3>
      <p class="dica" style="margin-top:6px">${esc(resumo || "Ainda não preenchido")}</p>
      <p class="dica" style="margin-top:2px">Objetivos: ${esc(objetivoTexto() || "—")}</p>
      <button class="btn secundario largo" id="editar-perfil">${icone("lapis", 18)} Editar minhas respostas</button>
      <button class="link" id="recomecar" style="margin-top:6px">Recomeçar do zero</button>
    </div>
    <div class="bloco-ajuste">
      <div class="linha-status">
        <h3>Personalização por IA</h3>
        <span class="status-ia ${IA.conectada() ? "on" : ""}">${IA.conectada() ? `${icone("check", 14)} Ativa` : "Modo básico"}</span>
      </div>
      <p class="dica" style="margin-top:6px">${IA.conectada()
        ? "A IA do AtualizaMed entende o que você escreveu, monta a sua trilha e escolhe e traduz os artigos. Não precisa configurar nada."
        : "A IA está indisponível agora. O app segue funcionando com sugestões prontas e tradução automática."}</p>
      <p class="dica">Nunca escreva dados de pacientes no app.</p>
    </div>
    <div class="bloco-ajuste">
      <h3>Profundidade das aulas</h3>
      <p class="dica" style="margin-top:6px">O app ajusta sozinho quando você marca "Básico demais" ou "Avançado demais" numa aula. Se preferir, escolha aqui.</p>
      <div class="chips" id="chips-nivel" style="margin-top:10px">${NIVEIS.map(([v, r]) => `<button class="chip ${v === (meuDia.ajuste ?? 0) ? "sel" : ""}" data-nivel="${v}">${icone("check", 16)}${r}</button>`).join("")}</div>
    </div>
    ${sessao?.papel === "dev" ? `<div class="bloco-ajuste"><h3>Desenvolvedor</h3>
      <p class="dica" style="margin-top:6px">Uso de cada pessoa, feedbacks e relatório da IA.</p>
      <button class="btn secundario largo" id="abrir-painel">${icone("grafico", 18)} Abrir o painel</button></div>` : ""}
    <div class="bloco-ajuste">
      <h3>Acesso</h3>
      <p class="dica" style="margin-top:6px">Entrou como <strong>${esc(sessao?.nome || "")}</strong>.</p>
      <button class="link" id="sair">Sair deste aparelho</button>
    </div>
    <form method="dialog" style="margin-top:8px"><button class="btn secundario largo">Fechar</button></form>`);
  const marcarNivel = (v) => document.querySelectorAll("[data-nivel]").forEach((x) => x.classList.toggle("sel", Number(x.dataset.nivel) === v));
  fetch("/api/meu-dia").then((r) => r.json()).then((d) => { meuDia = { ...meuDia, ...d }; marcarNivel(d.ajuste ?? 0); }).catch(() => {});
  document.querySelectorAll("[data-nivel]").forEach((b) => b.addEventListener("click", async () => {
    const v = Number(b.dataset.nivel);
    try {
      const d = await postJSON("/api/nivel", { ajuste: v });
      meuDia.ajuste = d.ajuste;
      marcarNivel(d.ajuste);
      toast("As próximas aulas virão neste nível");
    } catch (e) { toast(e.message); }
  }));
  document.getElementById("abrir-painel")?.addEventListener("click", () => { folha.close(); telaPainel(); });
  document.getElementById("sair").onclick = async () => { await fetch("/api/sair", { method: "POST", body: "{}" }); folha.close(); sessao = null; telaEntrar(); };
  document.getElementById("editar-perfil").onclick = () => { folha.close(); passo = 0; voltarParaPlano = false; telaPasso(); };
  document.getElementById("recomecar").onclick = () => {
    perfil = novoPerfil();
    try { localStorage.removeItem(CHAVE); } catch {}
    folha.close();
    telaBoasVindas();
  };
}

let timerToast;
function toast(msg) {
  const el = document.getElementById("aviso-toast");
  el.textContent = msg;
  el.classList.add("visivel");
  clearTimeout(timerToast);
  timerToast = setTimeout(() => el.classList.remove("visivel"), 2400);
}

// A inicialização fica em acesso.js (primeiro confere a chave de acesso).
