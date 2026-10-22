"""Núcleo do AtualizaMed: provedores de IA, texto completo dos artigos, voz e registro de custos.

Provedores (variável IA_PROVEDOR no .env, ou detectado pelas chaves presentes):
- claude   → API da Anthropic (SDK oficial `anthropic`), chave ANTHROPIC_API_KEY
- gemini   → Google Gemini (camada gratuita ou paga), chave GEMINI_API_KEY
- simulado → sem IA de verdade: gera conteúdo de teste a partir do próprio artigo, para testar o app inteiro
- (nenhum) → app no modo básico
"""
import asyncio
import base64
import hashlib
import io
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
import wave
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
CACHE = RAIZ / "cache"
(CACHE / "texto").mkdir(parents=True, exist_ok=True)
(CACHE / "estudo").mkdir(parents=True, exist_ok=True)
(CACHE / "voz").mkdir(parents=True, exist_ok=True)
ARQ_USO = CACHE / "uso.jsonl"
_trava_uso = threading.Lock()
contexto = threading.local()  # contexto.usuario = id de quem fez o pedido (definido pelo servidor a cada requisição)

# Preços em US$ por 1 milhão de tokens: entrada, saída, leitura de cache, escrita de cache.
PRECOS = {
    "claude-opus-5-5": (4.00, 20.00, 0.20, 5.00),
    "claude-sonnet-5-5": (2.00, 10.00, 0.20, 2.50),
    "claude-haiku-5-5": (0.10, 0.50, 0.01, 0.125),
    "gemini-2.5-flash": (0.30, 2.50, 0.03, 0.30),
    "gemini-2.5-flash-lite": (0.10, 0.40, 0.01, 0.10),
    # Voz (tabela oficial do Google, out/2026): saída em tokens de áudio, 25 por segundo de fala.
    # Os modelos 3.8 dobram de preço em 1/jan/2027 (US$ 1,00 / 18,00 e 1,00 / 12,00).
    "gemini-3.8-flash-tts": (0.50, 9.00, 0, 0),
    "gemini-3.8-flash-lite-tts": (0.50, 6.00, 0, 0),
    "gemini-2.5-flash-preview-tts": (0.50, 10.00, 0, 0),
    "gemini-3.1-flash-tts-preview": (1.00, 20.00, 0, 0),
}
# Modelos que aceitam o fallback automático do servidor da Anthropic em caso de recusa.
COM_FALLBACK = ("claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-fable-5")


# ---------------------------------------------------------------- configuração
def ler_env():
    valores = {}
    arquivo = RAIZ / ".env"
    if arquivo.exists():
        for linha in arquivo.read_text(encoding="utf-8").splitlines():
            linha = linha.strip()
            if linha and not linha.startswith("#") and "=" in linha:
                k, v = linha.split("=", 1)
                valores[k.strip()] = v.strip().strip('"').strip("'")
    pegar = lambda k, padrao="": os.environ.get(k) or valores.get(k) or padrao
    provedor = pegar("IA_PROVEDOR").lower()
    if not provedor:
        provedor = "claude" if pegar("ANTHROPIC_API_KEY") else "gemini" if pegar("GEMINI_API_KEY") else ""
    if provedor == "claude":
        forte = pegar("CLAUDE_MODELO", "claude-opus-5-5")
        leve = pegar("CLAUDE_MODELO_LEVE", forte)
    elif provedor == "gemini":
        forte = pegar("GEMINI_MODEL", "gemini-3.8-flash")
        leve = pegar("GEMINI_MODEL_LEVE", forte)
    else:
        forte = leve = pegar("PRECO_REFERENCIA", "claude-sonnet-5-5")  # só para estimar custo no modo simulado
    return {
        "provedor": provedor,
        "forte": forte,
        "leve": leve,
        "anthropic_key": pegar("ANTHROPIC_API_KEY"),
        "gemini_key": pegar("GEMINI_API_KEY"),
        "gemini_gratis": pegar("GEMINI_GRATIS", "1") == "1",
        "gemini_reservas": [m.strip() for m in pegar("GEMINI_RESERVAS", "gemini-3.5-flash,gemini-3-flash-preview,gemini-3.8-flash,gemini-3.7-flash,gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-3.1-flash-lite").split(",") if m.strip()],
        "gemini_tts": [m.strip() for m in pegar("GEMINI_TTS_MODELOS", "gemini-3.8-flash-tts,gemini-3.8-flash-lite-tts,gemini-2.5-flash-preview-tts,gemini-3.1-flash-tts-preview").split(",") if m.strip()],
        "voz_gemini": pegar("VOZ_GEMINI", "0") == "1",  # desligada: a Thalita é a voz única (decisão de 21/out/2026)
        "gemini_tts_key": pegar("GEMINI_TTS_KEY") or pegar("GEMINI_API_KEY"),
        "voz": pegar("VOZ", "pt-BR-ThalitaMultilingualNeural"),  # voz de reserva (Edge), quando o Gemini falha
    }


def ler_valor(chave, padrao=""):
    """Lê uma variável do ambiente ou do .env."""
    if os.environ.get(chave):
        return os.environ[chave]
    arquivo = RAIZ / ".env"
    if arquivo.exists():
        for linha in arquivo.read_text(encoding="utf-8").splitlines():
            if linha.strip().startswith(chave + "="):
                return linha.split("=", 1)[1].strip().strip('"').strip("'")
    return padrao


def status():
    c = ler_env()
    ativo = (c["provedor"] == "claude" and bool(c["anthropic_key"])) or (c["provedor"] == "gemini" and bool(c["gemini_key"])) \
        or c["provedor"] == "simulado"
    return {"ia": ativo, "provedor": c["provedor"] or None, "modelo": c["forte"] if ativo else None,
            "modeloLeve": c["leve"] if ativo else None, "simulado": c["provedor"] == "simulado",
            "voz": VOZ_GEMINI if c["voz_gemini"] and c["gemini_tts_key"] else c["voz"], "vozReserva": c["voz"]}


# ---------------------------------------------------------------- custos
def custo_usd(modelo, entrada, saida, cache_leitura=0, cache_escrita=0):
    p = PRECOS.get(modelo)
    if not p:
        return None
    return round((entrada * p[0] + saida * p[1] + cache_leitura * p[2] + cache_escrita * p[3]) / 1e6, 6)


def registrar_uso(tarefa, provedor, modelo, entrada, saida, cache_leitura=0, cache_escrita=0, gratis=False, estimado=False):
    custo = custo_usd(modelo, entrada, saida, cache_leitura, cache_escrita)
    linha = {
        "ts": datetime.now().isoformat(timespec="seconds"), "usuario": getattr(contexto, "usuario", None),
        "tarefa": tarefa, "provedor": provedor, "modelo": modelo,
        "entrada": entrada, "saida": saida, "cache_leitura": cache_leitura, "cache_escrita": cache_escrita,
        "custo_usd": 0 if gratis else custo, "custo_se_pago_usd": custo, "estimado": estimado,
    }
    with _trava_uso:
        with ARQ_USO.open("a", encoding="utf-8") as f:
            f.write(json.dumps(linha, ensure_ascii=False) + "\n")


def uso_por_usuario():
    """Chamadas de IA e custo (se fosse pago) por pessoa e por tarefa."""
    saida = {}
    if not ARQ_USO.exists():
        return saida
    for linha in ARQ_USO.read_text(encoding="utf-8").splitlines():
        try:
            u = json.loads(linha)
        except ValueError:
            continue
        p = saida.setdefault(u.get("usuario") or "-", {"chamadas": 0, "tokens": 0, "custo_se_pago_usd": 0.0, "tarefas": {}})
        p["chamadas"] += 1
        p["tokens"] += u["entrada"] + u["saida"] + u.get("cache_leitura", 0) + u.get("cache_escrita", 0)
        p["custo_se_pago_usd"] += u.get("custo_se_pago_usd") or 0
        p["tarefas"][u["tarefa"]] = p["tarefas"].get(u["tarefa"], 0) + 1
    return saida


def resumo_uso():
    """Totais por dia e por tarefa (para a tela de custos e para calcular o custo por usuário)."""
    if not ARQ_USO.exists():
        return {"dias": {}, "tarefas": {}, "chamadas": 0}
    dias, tarefas, n = {}, {}, 0
    for linha in ARQ_USO.read_text(encoding="utf-8").splitlines():
        try:
            u = json.loads(linha)
        except ValueError:
            continue
        n += 1
        dia = u["ts"][:10]
        for chave, alvo in ((dia, dias), (u["tarefa"], tarefas)):
            t = alvo.setdefault(chave, {"chamadas": 0, "entrada": 0, "saida": 0, "custo_usd": 0.0, "custo_se_pago_usd": 0.0})
            t["chamadas"] += 1
            t["entrada"] += u["entrada"] + u.get("cache_leitura", 0) + u.get("cache_escrita", 0)
            t["saida"] += u["saida"]
            t["custo_usd"] += u.get("custo_usd") or 0
            t["custo_se_pago_usd"] += u.get("custo_se_pago_usd") or 0
    return {"dias": dias, "tarefas": tarefas, "chamadas": n}


# ---------------------------------------------------------------- provedores
def _json_de(texto):
    texto = texto.strip()
    texto = re.sub(r"^```(?:json)?\s*|\s*```$", "", texto)
    try:
        return json.loads(texto)
    except ValueError:
        m = re.search(r"\{.*\}", texto, re.S)
        bruto = m.group(0) if m else texto
        # Consertos comuns de modelos menores: vírgula sobrando antes de } ou ], aspas tipográficas.
        consertado = re.sub(r",\s*([}\]])", r"\1", bruto).replace("“", '"').replace("”", '"')
        return json.loads(consertado)


_cliente_claude = (None, None)  # (chave usada, cliente) — recria o cliente se a chave do .env mudar


def _claude(cfg, modelo, sistema, mensagens, max_tokens, esforco):
    global _cliente_claude
    import anthropic  # só é necessário quando o provedor é o Claude
    if _cliente_claude[0] != cfg["anthropic_key"] or _cliente_claude[1] is None:
        _cliente_claude = (cfg["anthropic_key"], anthropic.Anthropic(api_key=cfg["anthropic_key"], timeout=180.0))
    cliente = _cliente_claude[1]
    extra = {}
    if modelo.startswith(COM_FALLBACK):
        # Em caso de recusa por política, o próprio servidor da Anthropic refaz o pedido num modelo alternativo.
        extra = {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}
    resp = cliente.beta.messages.create(
        model=modelo,
        max_tokens=max_tokens,
        # O bloco de sistema (instruções + artigo) fica em cache: as perguntas do chat custam ~5% na reutilização.
        system=[{"type": "text", "text": sistema, "cache_control": {"type": "ephemeral"}}],
        messages=mensagens,
        output_config={"effort": esforco},
        **extra,
    )
    if resp.stop_reason == "refusal":
        raise RuntimeError("A IA recusou este pedido.")
    texto = "".join(b.text for b in resp.content if b.type == "text")
    u = resp.usage
    uso = (u.input_tokens, u.output_tokens, u.cache_read_input_tokens or 0, u.cache_creation_input_tokens or 0)
    return texto, uso, resp.model


# Modelos que falharam ou travaram ficam "de castigo" por alguns minutos: o servidor pula direto para o próximo.
_modelos_ruins = {}
QUARENTENA = 10 * 60


def _marcar_ruim(nome):
    _modelos_ruins[nome] = time.time() + QUARENTENA


def _gemini(cfg, modelo, sistema, mensagens, json_saida, esquema=None, pesado=False):
    contents = [{"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]} for m in mensagens]
    geracao = {"temperature": 0.3, "maxOutputTokens": 32000}  # modelos com raciocínio gastam parte disso pensando
    if json_saida:
        geracao["responseMimeType"] = "application/json"
        if esquema:
            geracao["responseJsonSchema"] = esquema  # saída estruturada: o Google garante o formato do JSON
    corpo = json.dumps({"systemInstruction": {"parts": [{"text": sistema}]}, "contents": contents, "generationConfig": geracao}).encode()
    # Modelo principal e reservas. Na camada gratuita um modelo pode ficar sobrecarregado (429/503) ou simplesmente
    # travar sem responder; nos dois casos o servidor desiste dele, tenta o próximo e o evita por 10 minutos.
    lista = [modelo] + [m for m in cfg["gemini_reservas"] if m != modelo]
    agora = time.time()
    candidatos = [m for m in lista if _modelos_ruins.get(m, 0) < agora] or lista
    espera = 100 if pesado else 35  # uma aula completa leva 20–60 s num modelo saudável
    ultimo_erro = "Gemini indisponível"
    for nome in candidatos:
        req = urllib.request.Request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{nome}:generateContent", data=corpo, method="POST",
            headers={"Content-Type": "application/json", "x-goog-api-key": cfg["gemini_key"]},
        )
        try:
            with urllib.request.urlopen(req, timeout=espera) as r:
                dados = json.loads(r.read().decode())
            modelo = nome
            break
        except urllib.error.HTTPError as e:
            try:
                ultimo_erro = json.loads(e.read().decode()).get("error", {}).get("message", "") or f"Erro {e.code} no Gemini"
            except ValueError:
                ultimo_erro = f"Erro {e.code} no Gemini"
            if e.code not in (429, 500, 503, 404):
                raise RuntimeError(ultimo_erro) from None
            _marcar_ruim(nome)
        except (TimeoutError, OSError, urllib.error.URLError):  # travou ou caiu a conexão
            ultimo_erro = f"O modelo {nome} não respondeu a tempo"
            _marcar_ruim(nome)
    else:
        raise RuntimeError(ultimo_erro)
    partes = (dados.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
    texto = "".join(p.get("text", "") for p in partes if not p.get("thought"))
    m = dados.get("usageMetadata", {})
    cache_r = m.get("cachedContentTokenCount", 0)
    uso = (m.get("promptTokenCount", 0) - cache_r, m.get("candidatesTokenCount", 0) + m.get("thoughtsTokenCount", 0), cache_r, 0)
    return texto, uso, modelo


def gerar(tarefa, sistema, mensagens, *, json_saida=True, pesado=False, max_tokens=8000, esforco="low", simulado=None,
          esquema=None, _repetir=False):
    """Chama o provedor configurado e registra tokens e custo. `simulado(mensagens)` gera a resposta de teste."""
    cfg = ler_env()
    modelo = cfg["forte"] if pesado else cfg["leve"]
    prov = cfg["provedor"]
    if prov == "claude":
        texto, uso, modelo_real = _claude(cfg, modelo, sistema, mensagens, max_tokens, esforco)
        registrar_uso(tarefa, prov, modelo_real, *uso)
    elif prov == "gemini":
        texto, uso, modelo_real = _gemini(cfg, modelo, sistema, mensagens, json_saida, esquema, pesado)
        registrar_uso(tarefa, prov, modelo_real, *uso, gratis=cfg["gemini_gratis"])
    elif prov == "simulado":
        resultado = simulado(mensagens)
        texto = json.dumps(resultado, ensure_ascii=False) if json_saida else resultado
        # Estima tokens (~4 caracteres por token) para medir o custo que o modelo de referência teria.
        entrada = (len(sistema) + sum(len(m["content"]) for m in mensagens)) // 4
        saida = int(len(texto) / 4 * (1.6 if pesado else 1.3))  # + raciocínio interno do modelo
        registrar_uso(tarefa, prov, modelo, entrada, saida, estimado=True)
    else:
        raise RuntimeError("IA não configurada no servidor")
    if not json_saida:
        return texto.strip()
    try:
        return _json_de(texto)
    except ValueError:
        # Guarda a resposta crua para diagnóstico.
        (CACHE / "erros").mkdir(exist_ok=True)
        quem = modelo_real if prov != "simulado" else modelo
        (CACHE / "erros" / f"{tarefa}-{int(time.time())}.txt").write_text(f"{quem}\n\n{texto}", encoding="utf-8")
        if _repetir:
            raise RuntimeError("A IA devolveu uma resposta mal formatada — tente de novo.") from None
        return gerar(tarefa, sistema, mensagens, json_saida=True, pesado=pesado, max_tokens=max_tokens,
                     esforco=esforco, simulado=simulado, esquema=esquema, _repetir=True)  # uma nova tentativa


# ---------------------------------------------------------------- texto completo (Europe PMC)
def _texto_de(el):
    return re.sub(r"\s+", " ", "".join(el.itertext())).strip()


def texto_completo(pmcid):
    """Baixa e organiza o texto completo de um artigo de acesso aberto. Guarda em cache no disco."""
    if not re.fullmatch(r"PMC\d+", pmcid or ""):
        return None
    arq = CACHE / "texto" / f"{pmcid}.json"
    if arq.exists():
        return json.loads(arq.read_text(encoding="utf-8"))
    url = f"https://www.ebi.ac.uk/europepmc/webservices/rest/{pmcid}/fullTextXML"
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            xml = r.read()
    except urllib.error.URLError:
        return None
    xml = re.sub(rb"<!DOCTYPE[^>]*>", b"", xml, count=1)
    try:
        raiz = ET.fromstring(xml)
    except ET.ParseError:
        return None
    for pai in list(raiz.iter()):
        for filho in list(pai):
            if filho.tag in ("table-wrap", "fig", "disp-formula", "ref-list", "fn-group", "ack"):
                pai.remove(filho)
    secoes = []
    resumo = raiz.find(".//front//abstract")
    if resumo is not None:
        paragrafos = [_texto_de(p) for p in resumo.iter("p") if _texto_de(p)]
        if paragrafos:
            secoes.append({"titulo": "Resumo", "paragrafos": paragrafos})
    corpo = raiz.find("body")
    if corpo is not None:
        def percorrer(sec, prefixo=""):
            titulo_el = sec.find("title")
            titulo = (prefixo + _texto_de(titulo_el)) if titulo_el is not None else prefixo.rstrip(" ›")
            paragrafos = [_texto_de(p) for p in sec.findall("p") if _texto_de(p)]
            if paragrafos:
                secoes.append({"titulo": titulo or "Texto", "paragrafos": paragrafos})
            for sub in sec.findall("sec"):
                percorrer(sub, (titulo + " › ") if titulo else "")
        soltos = [_texto_de(p) for p in corpo.findall("p") if _texto_de(p)]
        if soltos:
            secoes.append({"titulo": "Texto", "paragrafos": soltos})
        for sec in corpo.findall("sec"):
            percorrer(sec)
    if len(secoes) <= 1:
        return None  # sem corpo do artigo (só o resumo) — trata como não disponível
    dados = {"pmcid": pmcid, "secoes": secoes}
    arq.write_text(json.dumps(dados, ensure_ascii=False), encoding="utf-8")
    return dados


# ---------------------------------------------------------------- versão aberta e legal (OpenAlex / Unpaywall)
# Quando o artigo não está no PMC, procura no OpenAlex (mesma base do Unpaywall) uma versão de acesso aberto legal:
# a publicada em acesso aberto, o manuscrito aceito num repositório ou o preprint. O texto serve só para a IA
# montar a aula; o PDF não é redistribuído no app. Nada de acesso institucional ou pago.
OA_MAX_BYTES = 20 * 1024 * 1024
OA_MAX_PAGINAS = 40
OA_SEM_TEXTO_DIAS = 7  # se não achou, tenta de novo depois de uma semana (versões abertas aparecem com o tempo)
_UA = "Mozilla/5.0 (compatible; AtualizaMed/1.0; leitura de artigos de acesso aberto)"


def _url_publica_segura(url):
    """Só https e só endereços públicos da internet (o servidor nunca busca nada na rede interna)."""
    import ipaddress
    import socket
    from urllib.parse import urlparse
    u = urlparse(url or "")
    if u.scheme != "https" or not u.hostname:
        return False
    try:
        ips = {info[4][0] for info in socket.getaddrinfo(u.hostname, 443)}
    except OSError:
        return False
    return all(ipaddress.ip_address(ip.split("%")[0]).is_global for ip in ips)


class _SoRedirecionaSeguro(urllib.request.HTTPRedirectHandler):
    """Confere cada redirecionamento ANTES de segui-lo (ninguém leva o servidor para um endereço interno)."""
    def redirect_request(self, req, fp, code, msg, headers, novo):
        if not _url_publica_segura(novo):
            raise urllib.error.URLError("redirecionamento para endereço não permitido")
        return super().redirect_request(req, fp, code, msg, headers, novo)


_abrir_seguro = urllib.request.build_opener(_SoRedirecionaSeguro()).open


def _json_de_url(url, timeout=20):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": _UA}), timeout=timeout) as r:
        return json.loads(r.read().decode())


def _doi_do_artigo(art_id):
    """DOI e, se o Europe PMC já tiver ligado, o PMCID do artigo."""
    from urllib.parse import quote
    d = _json_de_url("https://www.ebi.ac.uk/europepmc/webservices/rest/search?resultType=lite&format=json&query="
                     + quote(f'EXT_ID:"{art_id}"'))
    res = (d.get("resultList") or {}).get("result") or []
    return ((res[0].get("doi") or "").strip().lower(), res[0].get("pmcid") or "") if res else ("", "")


def _texto_do_pdf(bruto):
    import io
    from pypdf import PdfReader
    leitor = PdfReader(io.BytesIO(bruto))
    paginas = [(p.extract_text() or "") for p in leitor.pages[:OA_MAX_PAGINAS]]
    texto = "\n".join(paginas)
    texto = re.sub(r"(\w)-\n(\w)", r"\1\2", texto)       # palavras quebradas no fim da linha
    texto = re.sub(r"[ \t]+", " ", texto)
    texto = re.sub(r"\n{2,}", "\n\n", texto).strip()
    # Corta a lista de referências (costuma ficar no último terço e não ajuda a aula).
    corte = max((m.start() for m in re.finditer(r"\n\s*(References|REFERENCES|Bibliography|Referências)\s*\n", texto)), default=-1)
    if corte > len(texto) * 0.5:
        texto = texto[:corte]
    return texto


def texto_aberto(art_id):
    """Texto de uma versão de acesso aberto legal do artigo (ou None). Guarda em cache, inclusive quando não acha."""
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,40}", str(art_id or "")):
        return None
    arq = CACHE / "texto" / f"oa-{art_id}.json"
    if arq.exists():
        salvo = json.loads(arq.read_text(encoding="utf-8"))
        if salvo.get("texto") or time.time() - salvo.get("verificado", 0) < OA_SEM_TEXTO_DIAS * 86400:
            return salvo if salvo.get("texto") else None
    achado = {"verificado": time.time()}
    try:
        doi, pmcid = _doi_do_artigo(art_id)
        obra = {}
        if doi and not pmcid:
            from urllib.parse import quote
            obra = _json_de_url("https://api.openalex.org/works/" + quote("https://doi.org/" + doi, safe="")
                                + "?select=ids,open_access,best_oa_location,locations")
            # 1º: cópia aberta no PMC (o OpenAlex conhece antes de o Europe PMC ligar ao registro): texto estruturado.
            achados = [str((obra.get("ids") or {}).get("pmcid") or "")]
            achados += [str(l.get(k) or "") for l in (obra.get("locations") or []) if l and l.get("is_oa") for k in ("landing_page_url", "pdf_url")]
            pmcid = next((m.group(0) for t in achados for m in [re.search(r"PMC\d+", t)] if m), "")
        if pmcid:
            pmc = texto_completo(pmcid)
            if pmc:
                texto = "\n\n".join(f"## {s['titulo']}\n" + "\n".join(s["paragrafos"]) for s in pmc["secoes"])
                achado.update(texto=texto, fonte=f"https://europepmc.org/article/PMC/{pmcid}", versao="PMC", pmcid=pmcid, doi=doi)
        if not achado.get("texto") and obra:
            # 2º: PDF de acesso aberto (repositórios e preprints costumam liberar; várias editoras bloqueiam robôs).
            prioridade = {"publishedVersion": 0, "acceptedVersion": 1, "submittedVersion": 2}
            locais = [l for l in [obra.get("best_oa_location")] + (obra.get("locations") or []) if l and l.get("is_oa") and l.get("pdf_url")]
            locais.sort(key=lambda l: prioridade.get(l.get("version"), 3))
            vistos = set()
            for local in locais:
                url = local["pdf_url"]
                if url in vistos or not _url_publica_segura(url):
                    continue
                vistos.add(url)
                if len(vistos) > 3:
                    break
                try:
                    with _abrir_seguro(urllib.request.Request(url, headers={"User-Agent": _UA, "Accept": "application/pdf"}), timeout=30) as r:
                        bruto = r.read(OA_MAX_BYTES + 1)
                    if len(bruto) > OA_MAX_BYTES or not bruto.startswith(b"%PDF"):
                        continue
                    texto = _texto_do_pdf(bruto)
                except Exception:
                    continue
                if len(texto) >= 6000:  # menos que isso costuma ser só o resumo ou uma página de capa
                    achado.update(texto=texto, fonte=url, versao=local.get("version"), licenca=local.get("license"), doi=doi)
                    break
    except Exception as e:  # rede, OpenAlex fora do ar: a aula segue com o resumo
        print(f"[texto aberto] {art_id}: {type(e).__name__}: {e}", flush=True)
        return None
    arq.write_text(json.dumps(achado, ensure_ascii=False), encoding="utf-8")
    return achado if achado.get("texto") else None


def texto_para_ia(art, limite=45000):
    """Texto que vai para a IA: completo quando houver (PMC ou versão aberta legal; até ~11 mil tokens), senão o resumo."""
    completo = texto_completo(art.get("pmcid")) if art.get("pmcid") else None
    if completo:
        partes = [f"## {s['titulo']}\n" + "\n".join(s["paragrafos"]) for s in completo["secoes"]]
        return "\n\n".join(partes)[:limite], True
    aberto = texto_aberto(art.get("id"))
    if aberto:
        return aberto["texto"][:limite], True
    return art.get("resumoOriginal", "")[:limite], False


# ---------------------------------------------------------------- voz
# Padrão: Thalita do Microsoft Edge (gratuita, sem limite), voz única para a aula não variar de voz.
# Opcional (VOZ_GEMINI=1 no .env, só com plano pago): Gemini TTS com a voz Sulafat, tentada nos modelos de voz do
# Gemini em ordem; se todos falharem, a Thalita assume. Custo em CUSTO-VOZ-GEMINI.md.
# O texto vai sem instrução de estilo: nos trechos curtos o modelo lia a instrução em voz alta antes da aula.
# Na camada gratuita a cota é de só 10 pedidos por dia por modelo; GEMINI_TTS_KEY permite usar uma chave paga
# só para a voz, deixando o texto das aulas na chave gratuita.
VOZ_GEMINI = "Sulafat"


def _mp3(pcm, taxa):
    import lameenc
    enc = lameenc.Encoder()
    enc.set_bit_rate(64)
    enc.set_in_sample_rate(taxa)
    enc.set_channels(1)
    enc.set_quality(2)
    return bytes(enc.encode(pcm) + enc.flush())


def _gemini_tts(cfg, texto):
    """Narra o texto com a voz Sulafat; devolve o MP3. Pula modelos de castigo e põe de castigo os que falharem."""
    corpo = json.dumps({
        "contents": [{"parts": [{"text": texto}]}],
        "generationConfig": {"responseModalities": ["AUDIO"],
                             "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": VOZ_GEMINI}}}},
    }).encode()
    agora = time.time()
    candidatos = [m for m in cfg["gemini_tts"] if _modelos_ruins.get(m, 0) < agora]
    ultimo_erro = "todos os modelos de voz do Gemini estão de castigo"
    for nome in candidatos:
        req = urllib.request.Request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{nome}:generateContent", data=corpo, method="POST",
            headers={"Content-Type": "application/json", "x-goog-api-key": cfg["gemini_tts_key"]},
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                dados = json.loads(r.read().decode())
            parte = dados["candidates"][0]["content"]["parts"][0]["inlineData"]
        except urllib.error.HTTPError as e:
            ultimo_erro = f"Erro {e.code} no {nome}"
            if e.code not in (429, 500, 503, 404):
                raise RuntimeError(ultimo_erro) from None
            _marcar_ruim(nome)
            try:  # cota do dia esgotada: o Google diz quando ela volta; até lá o modelo nem é tentado
                espera = re.search(r'"retryDelay":\s*"(\d+)', e.read().decode())
                if espera and int(espera.group(1)) > QUARENTENA:
                    _modelos_ruins[nome] = time.time() + int(espera.group(1))
            except (OSError, ValueError):
                pass
            continue
        except (TimeoutError, OSError, urllib.error.URLError, KeyError, IndexError, ValueError):
            ultimo_erro = f"O modelo {nome} não devolveu áudio a tempo"
            _marcar_ruim(nome)
            continue
        bruto, mime = base64.b64decode(parte["data"]), parte.get("mimeType", "")
        if "wav" in mime:  # os modelos 3.8 já mandam WAV; os anteriores, PCM cru de 16 bits
            with wave.open(io.BytesIO(bruto)) as w:
                taxa, pcm = w.getframerate(), w.readframes(w.getnframes())
        else:
            taxa = int(re.search(r"rate=(\d+)", mime).group(1)) if "rate=" in mime else 24000
            pcm = bruto
        m = dados.get("usageMetadata", {})
        registrar_uso("voz", "gemini", nome, m.get("promptTokenCount", 0), m.get("candidatesTokenCount", 0),
                      gratis=cfg["gemini_gratis"])
        return _mp3(pcm, taxa)
    raise RuntimeError(ultimo_erro)


def sintetizar_voz(texto):
    """Gera (ou reaproveita do cache) o MP3 da narração. Retorna o caminho do arquivo."""
    texto = re.sub(r"\s+", " ", texto or "").strip()[:3000]
    if not texto:
        raise ValueError("texto vazio")
    cfg = ler_env()
    pasta, temp = CACHE / "voz", f".{threading.get_ident()}.tmp"
    principal = pasta / ("g-" + hashlib.sha256(f"{VOZ_GEMINI}|{texto}".encode()).hexdigest()[:24] + ".mp3")
    if principal.exists():
        return principal
    if cfg["voz_gemini"] and cfg["gemini_tts_key"]:
        try:
            tmp = principal.with_suffix(temp)
            tmp.write_bytes(_gemini_tts(cfg, texto))
            tmp.replace(principal)
            return principal
        except Exception as e:  # sem cota, sobrecarga, rede: cai para a reserva sem travar a aula
            print(f"[voz] Gemini indisponível ({e}); usando a reserva {cfg['voz']}", flush=True)
    reserva = pasta / (hashlib.sha256(f"{cfg['voz']}|{texto}".encode()).hexdigest()[:24] + ".mp3")
    if not reserva.exists():
        import edge_tts
        tmp = reserva.with_suffix(temp)
        asyncio.run(edge_tts.Communicate(texto, cfg["voz"], rate="-4%").save(str(tmp)))
        tmp.replace(reserva)
    return reserva


# ---------------------------------------------------------------- cache de estudos
def chave_estudo(dados):
    # Aula individual: o perfil completo e o degrau de nível (com os comentários da pessoa) entram na chave,
    # então cada pessoa tem a sua aula do mesmo artigo, e um novo degrau gera uma aula nova.
    cal = json.dumps(dados.get("calibragem") or {}, sort_keys=True, ensure_ascii=False)
    base = "v4|" + "|".join(str(dados.get(k, "")) for k in ("id", "modo", "tempo", "perfil")) + "|" + cal + "|" + ler_env()["forte"]
    return hashlib.sha256(base.encode()).hexdigest()[:24]


def ler_estudo(chave):
    arq = CACHE / "estudo" / f"{chave}.json"
    return json.loads(arq.read_text(encoding="utf-8")) if arq.exists() else None


def gravar_estudo(chave, estudo):
    (CACHE / "estudo" / f"{chave}.json").write_text(json.dumps(estudo, ensure_ascii=False), encoding="utf-8")
