// Motor de personalização do AtualizaMed.
// - A IA roda no servidor do app (servidor.py → Google Gemini, camada gratuita), com a chave do PROJETO.
//   O médico não cria nem cola chave nenhuma.
// - Se a IA estiver indisponível, o app segue no modo básico: catálogo de sugestões + tradução gratuita (MyMemory).
// O provedor fica isolado no servidor: trocar Gemini por outro modelo (ex.: Claude) não mexe nas telas.
const IA = (() => {
  const CHAVE_CACHE = "atualizamed.cache-consultas";
  let disponivel = false;

  async function iniciar() {
    try {
      const r = await fetch("/api/status");
      disponivel = r.ok && !!(await r.json()).ia;
    } catch { disponivel = false; }
    return disponivel;
  }
  const conectada = () => disponivel;

  async function gerar(pedido) {
    if (!disponivel) throw new Error("IA indisponível");
    const r = await fetch("/api/ia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pedido }),
    });
    const dados = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(dados.erro || `Erro ${r.status} na IA`);
    if (dados.resultado?.erro) throw new Error(dados.resultado.erro);
    return dados.resultado;
  }

  function descreverPerfil(p) {
    const linhas = [
      `Momento da carreira: ${p.carreiraTexto}`,
      p.faseTexto && `Fase do curso: ${p.faseTexto}`,
      p.cursando && `Está cursando agora: ${p.cursando}`,
      p.interesse && `Especialidade de interesse: ${p.interesse}`,
      p.especialidade && `Especialidade/residência: ${p.especialidade}`,
      p.rodizio && `Rodízio atual: ${p.rodizio}`,
      p.area && `Área de atuação/foco (ou o que ensina): ${p.area}`,
      p.cenarios?.length && `Onde atua: ${p.cenarios.join(", ")}`,
      p.publico?.length && `Para quem ensina: ${p.publico.join(", ")}`,
      `Objetivos: ${p.objetivoTexto}`,
      p.sobre && `O que o médico contou: ${p.sobre}`,
      p.modoTemas === "manual" && p.temas?.length && `Temas que ele escolheu: ${p.temas.map((t) => t.pt).join("; ")}`,
      `Tempo por dia: ${p.tempo} min`,
    ];
    return linhas.filter(Boolean).join("\n");
  }

  // Aceita só consultas com parênteses e aspas equilibrados; remove nomes de campo.
  function consultaSegura(q) {
    const s = String(q || "").replace(/\b[A-Z_]+:\s*/g, "").trim().slice(0, 300);
    const aspas = (s.match(/"/g) || []).length;
    let saldo = 0;
    for (const c of s) { if (c === "(") saldo++; if (c === ")") saldo--; if (saldo < 0) break; }
    if (!s || aspas % 2 || saldo !== 0) return null;
    return s;
  }
  // Texto em inglês sem operadores: 2 palavras viram expressão entre aspas; mais que isso, termos com AND
  // (sem palavras genéricas como "management", que restringem demais os títulos).
  function consultaDeTexto(en) {
    const limpo = String(en).replace(/["()]/g, " ").replace(/\s+/g, " ").trim();
    const todas = limpo.split(" ");
    if (todas.length === 2) return `"${limpo}"`;
    const uteis = todas.filter((w) => !/^(the|of|in|and|for|a|an|on|with|to|management|treatment|approach|update|overview|current|patients?)$/i.test(w));
    if (uteis.length <= 1) return uteis[0] || limpo;
    return uteis.join(" AND ");
  }

  function lerCache() { try { return JSON.parse(localStorage.getItem(CHAVE_CACHE) || "{}"); } catch { return {}; } }
  function gravarCache(k, v) { try { const c = lerCache(); c[k] = v; localStorage.setItem(CHAVE_CACHE, JSON.stringify(c)); } catch {} }

  async function traduzirGratis(texto) {
    const url = "https://api.mymemory.translated.net/get?" + new URLSearchParams({ q: texto, langpair: "pt-BR|en" });
    const r = await fetch(url);
    const d = await r.json();
    const t = d?.responseData?.translatedText;
    if (!t || d.quotaFinished) throw new Error("tradução indisponível");
    return t;
  }

  // Tema em português (qualquer texto) → consulta em inglês para o título dos artigos.
  async function consultaPara(tema, perfil) {
    if (tema.q) return tema.q;
    const k = normalizar(tema.pt);
    const cache = lerCache()[k];
    if (cache) return cache;
    const doCatalogo = acharTemaNoCatalogo(tema.pt);
    if (doCatalogo) return doCatalogo.q;
    let q = null;
    if (disponivel) {
      try {
        const r = await gerar(`Gere a consulta de busca para o tema "${tema.pt}", no contexto deste médico:\n${descreverPerfil(perfil)}\n\nFormato: {"q": "consulta em inglês"}`);
        q = consultaSegura(r.q);
      } catch (e) { console.warn("IA (consulta):", e.message); }
    }
    if (!q) {
      // Texto já em inglês? Usa direto. Senão, tradução gratuita.
      const pareceIngles = /^[\x00-\x7F]+$/.test(tema.pt) && /\b(the|of|and|in|disease|syndrome|surgery|cancer|injury|management)\b/i.test(tema.pt);
      try { q = consultaDeTexto(pareceIngles ? tema.pt : await traduzirGratis(tema.pt)); }
      catch { q = consultaDeTexto(tema.pt); }
    }
    gravarCache(k, q);
    return q;
  }

  async function sugerirRodizios(perfil) {
    const r = await gerar(`Liste até 12 rodízios/estágios comuns na residência de "${perfil.especialidade}" no Brasil.
Coloque primeiro os típicos do ano deste residente. Use nomes curtos como os residentes falam.
Perfil:\n${descreverPerfil(perfil)}\n\nFormato: {"rodizios": ["..."]}`);
    return (r.rodizios || []).filter((x) => typeof x === "string").slice(0, 12);
  }

  async function sugerirAreas(perfil) {
    const r = await gerar(`Liste até 10 áreas de atuação ou focos de prática comuns para quem atua em "${perfil.especialidade}".
Perfil:\n${descreverPerfil(perfil)}\n\nFormato: {"areas": ["..."]}`);
    return (r.areas || []).filter((x) => typeof x === "string").slice(0, 10);
  }

  async function sugerirTemas(perfil, qtd = 8, foco = "") {
    const r = await gerar(`Sugira ${qtd} temas de estudo para os próximos dias deste médico${foco ? `. ${foco}` : ""}.
Cada tema deve render bons artigos científicos e ser específico (não "cirurgia" e sim "colecistite aguda grave").
Cubra todos os objetivos dele. Não repita temas que ele já escolheu.
Perfil:\n${descreverPerfil(perfil)}

Formato: {"temas": [{"pt": "tema curto em português (até 6 palavras)", "q": "consulta em inglês"}]}`);
    return (r.temas || []).filter((x) => x?.pt).slice(0, qtd).map((x) => ({ pt: String(x.pt), q: consultaSegura(x.q) || undefined }));
  }

  // Trilha automática: a IA decide os temas a partir de tudo o que o médico contou.
  const montarTrilha = (perfil) => sugerirTemas(perfil, 6,
    "Monte a trilha de estudo dele: comece pelo que é mais útil agora (rodízio atual, área de atuação, objetivos e o que ele contou) e vá do mais essencial ao mais avançado");

  // Escolhe e ordena os melhores artigos para este médico, com título em português e o motivo.
  async function escolherArtigos(perfil, artigos) {
    const lista = artigos.map((a) => ({
      id: a.id, tema: a.tema, modo: a.modo, titulo: limparTexto(a.title), revista: a.revista, ano: a.pubYear,
      tipos: a.tipos, acesso_aberto: a.isOpenAccess === "Y", citacoes: a.citedByCount,
      resumo: limparTexto(a.abstractText).slice(0, 700),
    }));
    const r = await gerar(`Perfil:\n${descreverPerfil(perfil)}

Artigos candidatos (JSON):\n${JSON.stringify(lista)}

Escolha e ordene até 8 artigos, do mais útil para o menos útil para ESTE médico (o primeiro será o artigo de hoje).
Descarte os que fogem do tema, são muito de nicho para o momento dele ou têm baixa qualidade.
Varie temas e objetivos ao longo dos dias. Prefira acesso aberto quando a qualidade for parecida.
Para cada um: título traduzido para o português e o motivo da escolha (1 frase, até 160 caracteres, falando com o médico por "você").

Formato: {"artigos": [{"id": "...", "tituloPt": "...", "motivo": "..."}]}`);
    return (r.artigos || []).filter((x) => x?.id);
  }

  const limparTexto = (s) => String(s ?? "").replace(/<[^>]+>/g, "");

  return { iniciar, conectada, descreverPerfil, consultaPara, sugerirRodizios, sugerirAreas, sugerirTemas, montarTrilha, escolherArtigos };
})();
