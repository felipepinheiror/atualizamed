"""Acesso restrito da fase de testes: chaves individuais, sessão, eventos de uso e feedback.

Tudo fica em `dados/` (fora do Git):
  acessos.json     pessoas autorizadas (a chave é guardada só como hash)
  segredo.key      segredo do servidor (assina as sessões e protege os hashes)
  eventos.jsonl    o que cada pessoa fez (aulas, testes, avaliações)
  feedback.jsonl   feedbacks enviados pela aba Feedback
  perfis/<id>.json perfil de cada pessoa (para o painel e, depois, para o lote da madrugada)
  relatorios/      relatórios gerados pela IA e as decisões do desenvolvedor
"""
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
DADOS = RAIZ / "dados"
for pasta in (DADOS, DADOS / "perfis", DADOS / "relatorios"):
    pasta.mkdir(parents=True, exist_ok=True)
ARQ_ACESSOS = DADOS / "acessos.json"
ARQ_EVENTOS = DADOS / "eventos.jsonl"
ARQ_FEEDBACK = DADOS / "feedback.jsonl"
DURACAO_SESSAO = 365 * 24 * 3600  # 1 ano (e renova a cada uso)
_trava = threading.Lock()

ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # chave longa (desenvolvedor): sem 0/O e 1/I/L
CONSOANTES = "bdfgjklmnprstvz"
VOGAIS = "aeiou"
# Combinações que formariam palavrões ou palavras constrangedoras: a chave é sorteada de novo.
PROIBIDAS = ("puta", "rola", "foda", "fode", "fudi", "fude", "pika", "teta", "mija", "bosta", "kaga", "piru", "pinu")


def _segredo():
    # Na nuvem o segredo vem de uma variável secreta da plataforma (nunca vai para repositório nenhum).
    if os.environ.get("ATUALIZAMED_SEGREDO"):
        return os.environ["ATUALIZAMED_SEGREDO"].strip().encode()
    arq = DADOS / "segredo.key"
    if not arq.exists():
        arq.write_text(secrets.token_hex(32), encoding="utf-8")
    return arq.read_text(encoding="utf-8").strip().encode()


def normalizar_chave(chave):
    """Ignora traços, espaços e maiúsculas/minúsculas: 'Bamo tika', 'BAMO-TIKA' e 'bamotika' são a mesma chave."""
    return "".join(c for c in str(chave).upper() if c.isascii() and c.isalnum())


def _hash(chave):
    return hmac.new(_segredo(), normalizar_chave(chave).encode(), hashlib.sha256).hexdigest()


def _ler():
    if not ARQ_ACESSOS.exists():
        return {"usuarios": []}
    return json.loads(ARQ_ACESSOS.read_text(encoding="utf-8"))


def _gravar(dados):
    tmp = ARQ_ACESSOS.with_suffix(".tmp")
    tmp.write_text(json.dumps(dados, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(ARQ_ACESSOS)


def gerar_chave_forte():
    """Chave do desenvolvedor: 12 caracteres (60 bits)."""
    corpo = "".join(secrets.choice(ALFABETO) for _ in range(12))
    return f"AM-{corpo[:4]}-{corpo[4:8]}-{corpo[8:]}"


def gerar_chave_simples():
    """Chave de testador: 4 sílabas fáceis de digitar no celular (ex.: bamo-tika), só letras.
    São ~31 milhões de combinações; com o bloqueio de tentativas, adivinhar uma levaria anos."""
    while True:
        silabas = [secrets.choice(CONSOANTES) + secrets.choice(VOGAIS) for _ in range(4)]
        chave = f"{silabas[0]}{silabas[1]}-{silabas[2]}{silabas[3]}"
        if not any(p in chave.replace("-", "") for p in PROIBIDAS):
            return chave


def gerar_chave_link():
    """Chave do link pessoal (atualizamed…/?c=chave): 26 caracteres, ~130 bits. Ninguém digita; impossível adivinhar."""
    return "".join(secrets.choice(ALFABETO) for _ in range(26)).lower()


def criar_usuario(nome, papel="testador"):
    """Cria uma pessoa e devolve (usuario, chave). A chave em texto (o link pessoal) só existe neste momento."""
    chave = gerar_chave_link()
    with _trava:
        dados = _ler()
        usuario = {"id": secrets.token_hex(4), "nome": nome.strip()[:60] or "Sem nome", "papel": papel,
                   "hash": _hash(chave), "criado": datetime.now().isoformat(timespec="seconds"), "ativo": True}
        dados["usuarios"].append(usuario)
        _gravar(dados)
    return publico(usuario), chave


def publico(u):
    return {k: u.get(k) for k in ("id", "nome", "email", "papel", "criado", "ativo", "nomeLogin")} | {"google": bool(u.get("google"))}


# ---------------------------------------------------------------- contas: e-mail e senha, ou Google
# A senha nunca é guardada: só um hash scrypt com sal próprio. Quem tiver um e-mail de ADMIN_EMAILS vira
# desenvolvedor ao entrar (por senha ou Google), sem chave nenhuma.
SENHA_MINIMA = 8


def normalizar_email(email):
    return str(email or "").strip().lower()[:200]


def email_valido(email):
    import re
    return bool(re.fullmatch(r"[^@\s]+@[^@\s]+\.[a-z]{2,}", email))


def _admins():
    valor = os.environ.get("ADMIN_EMAILS")
    if valor is None:
        arq = RAIZ / ".env"
        linhas = arq.read_text(encoding="utf-8").splitlines() if arq.exists() else []
        valor = next((l.split("=", 1)[1] for l in linhas if l.startswith("ADMIN_EMAILS=")), "")
    return {normalizar_email(e) for e in valor.split(",") if e.strip()}


def _hash_senha(senha, sal=None):
    sal = sal or secrets.token_bytes(16)
    h = hashlib.scrypt(senha.encode(), salt=sal, n=2 ** 14, r=8, p=1, dklen=32)
    return f"scrypt${sal.hex()}${h.hex()}"


def _confere_senha(senha, guardado):
    try:
        _, sal, h = str(guardado).split("$")
        return hmac.compare_digest(_hash_senha(senha, bytes.fromhex(sal)).split("$")[2], h)
    except ValueError:
        return False


def _papel_para(email):
    return "dev" if email in _admins() else "testador"


def criar_conta(nome, email, senha):
    """Cadastro por e-mail e senha. Devolve (usuario_publico, None) ou (None, mensagem de erro)."""
    email = normalizar_email(email)
    nome = " ".join(str(nome or "").split())[:60]
    if len(nome) < 2:
        return None, "Escreva o seu nome."
    if not email_valido(email):
        return None, "Confira o e-mail."
    if len(senha or "") < SENHA_MINIMA:
        return None, f"A senha precisa ter pelo menos {SENHA_MINIMA} caracteres."
    with _trava:
        dados = _ler()
        if any(u.get("email") == email for u in dados["usuarios"]):
            return None, "Já existe uma conta com este e-mail. Entre com ele (ou com o Google)."
        u = {"id": secrets.token_hex(4), "nome": nome, "email": email, "senha": _hash_senha(senha),
             "papel": _papel_para(email), "criado": datetime.now().isoformat(timespec="seconds"), "ativo": True}
        dados["usuarios"].append(u)
        _gravar(dados)
    return publico(u), None


def entrar_com_senha(email, senha):
    email = normalizar_email(email)
    u = next((x for x in _ler()["usuarios"] if x.get("email") == email and x.get("senha")), None)
    if not u or not _confere_senha(senha or "", u["senha"]) or not u["ativo"]:
        return None
    return _atualizar_papel(u)


def entrar_com_google(sub, email, nome):
    """Conta do Google já verificada pelo servidor: acha pelo identificador do Google ou pelo e-mail (e liga as
    duas formas de entrar), ou cria a conta."""
    email = normalizar_email(email)
    with _trava:
        dados = _ler()
        u = next((x for x in dados["usuarios"] if x.get("google") == sub), None) or \
            next((x for x in dados["usuarios"] if x.get("email") == email), None)
        if u is None:
            u = {"id": secrets.token_hex(4), "nome": " ".join(str(nome or email.split("@")[0]).split())[:60],
                 "email": email, "papel": _papel_para(email), "criado": datetime.now().isoformat(timespec="seconds"),
                 "ativo": True}
            dados["usuarios"].append(u)
        u["google"] = sub
        _gravar(dados)
    return _atualizar_papel(u) if u["ativo"] else None


def _atualizar_papel(u):
    """Promove a desenvolvedor quem está em ADMIN_EMAILS (vale também para contas criadas antes)."""
    if u.get("email") in _admins() and u.get("papel") != "dev":
        with _trava:
            dados = _ler()
            for x in dados["usuarios"]:
                if x["id"] == u["id"]:
                    x["papel"] = "dev"
                    u = x
            _gravar(dados)
    return u


def definir_senha(uid, senha):
    """O desenvolvedor zera a senha de alguém (quem esqueceu). Devolve None ou a mensagem de erro."""
    if len(senha or "") < SENHA_MINIMA:
        return f"A senha precisa ter pelo menos {SENHA_MINIMA} caracteres."
    with _trava:
        dados = _ler()
        for u in dados["usuarios"]:
            if u["id"] == uid:
                u["senha"] = _hash_senha(senha)
        _gravar(dados)
    return None


def verificar_token_google(credencial, client_id):
    """Confere no próprio Google o token do botão "Entrar com Google". Devolve (sub, email, nome) ou None."""
    import json as _json
    import urllib.parse
    import urllib.request
    if not client_id or not credencial or len(credencial) > 4000:
        return None
    try:
        with urllib.request.urlopen("https://oauth2.googleapis.com/tokeninfo?id_token=" + urllib.parse.quote(credencial),
                                    timeout=10) as r:
            info = _json.loads(r.read().decode())
    except Exception:
        return None
    ok = (info.get("aud") == client_id and info.get("iss") in ("accounts.google.com", "https://accounts.google.com")
          and int(info.get("exp", 0)) > time.time() and str(info.get("email_verified")).lower() == "true")
    return (info["sub"], info["email"], info.get("name") or "") if ok else None


def listar_usuarios():
    return [publico(u) for u in _ler()["usuarios"]]


def usuario_por_id(uid):
    return next((u for u in _ler()["usuarios"] if u["id"] == uid and u["ativo"]), None)


def nova_chave(uid):
    """Troca a chave de um testador (a antiga deixa de funcionar). Devolve a nova chave ou None."""
    with _trava:
        dados = _ler()
        for u in dados["usuarios"]:
            if u["id"] == uid and u["papel"] != "dev":
                chave = gerar_chave_link()
                u["hash"] = _hash(chave)
                _gravar(dados)
                return chave
    return None


def definir_ativo(uid, ativo):
    with _trava:
        dados = _ler()
        for u in dados["usuarios"]:
            if u["id"] == uid and u["papel"] != "dev":
                u["ativo"] = bool(ativo)
        _gravar(dados)


def validar_chave(chave):
    h = _hash(chave)
    return next((u for u in _ler()["usuarios"] if u["ativo"] and hmac.compare_digest(u["hash"], h)), None)


# ---------------------------------------------------------------- entrar pelo nome (depois de ativar com a chave)
import unicodedata  # noqa: E402


def normalizar_nome(nome):
    sem_acento = unicodedata.normalize("NFD", str(nome)).encode("ascii", "ignore").decode()
    return " ".join(sem_acento.lower().split())


def definir_nome_login(uid, nome):
    """Guarda o nome com que a pessoa vai entrar. Precisa ser único. Devolve None ou a mensagem de erro."""
    alvo = normalizar_nome(nome)
    if len(alvo) < 3:
        return "Escreva o seu nome (pelo menos 3 letras)."
    with _trava:
        dados = _ler()
        if any(u["id"] != uid and u.get("nomeLogin") and normalizar_nome(u["nomeLogin"]) == alvo for u in dados["usuarios"]):
            return "Já existe alguém com esse nome. Acrescente o sobrenome."
        for u in dados["usuarios"]:
            if u["id"] == uid:
                u["nomeLogin"] = " ".join(str(nome).split())[:60]
        _gravar(dados)
    return None


def validar_nome(nome, uid_aparelho):
    """Entrada pelo nome: só testadores ativos, e só no aparelho onde a pessoa já entrou com a chave
    (uid_aparelho vem do selo assinado desse aparelho). Num aparelho estranho, o nome sozinho não abre nada.
    O desenvolvedor sempre entra com a chave."""
    alvo = normalizar_nome(nome)
    return next((u for u in _ler()["usuarios"] if u["ativo"] and u["papel"] != "dev" and u.get("nomeLogin")
                 and u["id"] == uid_aparelho and normalizar_nome(u["nomeLogin"]) == alvo), None)


ARQ_CONFIG = DADOS / "config.json"


def config():
    padrao = {"entrarPorNome": False}  # desde nov/2026 a entrada é pelo link pessoal; o nome ficou desligado
    if ARQ_CONFIG.exists():
        padrao.update(json.loads(ARQ_CONFIG.read_text(encoding="utf-8")))
    return padrao


def definir_config(**valores):
    atual = config()
    atual.update(valores)
    ARQ_CONFIG.write_text(json.dumps(atual, ensure_ascii=False), encoding="utf-8")
    return atual


# ---------------------------------------------------------------- sessão (cookie assinado)
def criar_token(uid):
    expira = int(time.time()) + DURACAO_SESSAO
    corpo = f"{uid}.{expira}"
    assinatura = hmac.new(_segredo(), corpo.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{corpo}.{assinatura}"


def usuario_do_token(token):
    try:
        uid, expira, assinatura = (token or "").split(".")
        esperado = hmac.new(_segredo(), f"{uid}.{expira}".encode(), hashlib.sha256).hexdigest()[:32]
        if not hmac.compare_digest(assinatura, esperado) or int(expira) < time.time():
            return None
    except ValueError:
        return None
    return usuario_por_id(uid)  # quem foi desativado perde o acesso na hora


# Selo do aparelho: gravado quando a pessoa entra com a chave; é o que permite entrar só com o nome depois.
# Assinado com outro rótulo, então não serve como sessão (e a sessão não serve como selo).
def criar_selo_aparelho(uid):
    expira = int(time.time()) + 3 * DURACAO_SESSAO
    assinatura = hmac.new(_segredo(), f"aparelho.{uid}.{expira}".encode(), hashlib.sha256).hexdigest()[:32]
    return f"{uid}.{expira}.{assinatura}"


def aparelho_do_selo(selo):
    try:
        uid, expira, assinatura = (selo or "").split(".")
        esperado = hmac.new(_segredo(), f"aparelho.{uid}.{expira}".encode(), hashlib.sha256).hexdigest()[:32]
        if not hmac.compare_digest(assinatura, esperado) or int(expira) < time.time():
            return None
    except ValueError:
        return None
    return uid


# ---------------------------------------------------------------- proteção contra tentativas de adivinhar chaves
_falhas = defaultdict(deque)
_falhas_gerais = deque()
_falhas_dia = deque()


def _limpar(fila, janela):
    agora = time.time()
    while fila and agora - fila[0] > janela:
        fila.popleft()


def pode_tentar(ip, limite=10, janela=15 * 60, limite_geral=60, limite_dia=300):
    """10 erros por endereço a cada 15 min; somando todos os endereços, 60 por 15 min e 300 por dia.
    Com ~31 milhões de chaves possíveis, 300 tentativas por dia tornam adivinhar uma chave inviável na prática,
    mesmo para quem troca de endereço a cada tentativa. Quem já está conectado não é afetado."""
    _limpar(_falhas[ip], janela)
    _limpar(_falhas_gerais, janela)
    _limpar(_falhas_dia, 24 * 3600)
    return len(_falhas[ip]) < limite and len(_falhas_gerais) < limite_geral and len(_falhas_dia) < limite_dia


def registrar_falha(ip):
    agora = time.time()
    _falhas[ip].append(agora)
    _falhas_gerais.append(agora)
    _falhas_dia.append(agora)


# ---------------------------------------------------------------- eventos, perfis e feedback
def _anexar(arq, linha):
    with _trava:
        with arq.open("a", encoding="utf-8") as f:
            f.write(json.dumps(linha, ensure_ascii=False) + "\n")


def _ler_jsonl(arq):
    if not arq.exists():
        return []
    saida = []
    for linha in arq.read_text(encoding="utf-8").splitlines():
        try:
            saida.append(json.loads(linha))
        except ValueError:
            pass
    return saida


TIPOS_EVENTO = {"entrou", "aula_aberta", "video_concluido", "video_ouvido", "quiz_concluido", "avaliacao_aula", "chat",
                "aula_gerada", "nivel_manual"}

# ---------------------------------------------------------------- nível de cada pessoa (aprende com as avaliações)
# O nível parte do perfil (momento de carreira) e recebe um ajuste em degraus, de -2 (mais básico) a +3 (bem mais
# aprofundado). Cada avaliação mexe no ajuste em relação ao nível DAQUELA aula: "Básico demais" numa aula feita
# no degrau 0 leva a pessoa ao degrau 1 (e não soma de novo se ela avaliar outra aula antiga do degrau 0);
# "Avançado demais" desce. A pessoa também pode escolher o degrau à mão em Ajustes ("nivel_manual").
AJUSTE_MIN, AJUSTE_MAX = -2, 3


def calibragem(uid, eventos=None):
    """Degrau atual da pessoa, de que degrau era cada aula dela e os comentários recentes sobre as aulas."""
    ajuste, aulas, comentarios, avaliacoes = 0, {}, [], 0
    for e in (eventos if eventos is not None else ler_eventos()):
        if e.get("usuario") != uid:
            continue
        d = e.get("dados") or {}
        if e["tipo"] == "aula_gerada":
            aulas[str(d.get("id"))] = int(d.get("ajuste", 0))
        elif e["tipo"] == "nivel_manual":
            ajuste = int(d.get("ajuste", 0))
        elif e["tipo"] == "avaliacao_aula":
            avaliacoes += 1
            base = int(d.get("ajusteAula", aulas.get(str(d.get("id")), 0)))
            if d.get("nivel") == "basico":
                ajuste = max(ajuste, base + 1)
            elif d.get("nivel") == "avancado":
                ajuste = min(ajuste, base - 1)
            if str(d.get("comentario") or "").strip():
                comentarios.append(f"{str(d.get('comentario')).strip()[:300]} (sobre: {str(d.get('titulo') or '')[:80]})")
        ajuste = max(AJUSTE_MIN, min(AJUSTE_MAX, ajuste))
    return {"ajuste": ajuste, "aulas": aulas, "comentarios": comentarios[-3:], "avaliacoes": avaliacoes}


# ---------------------------------------------------------------- uma aula nova por dia
def aulas_novas_hoje(uid, eventos=None):
    """Artigos cuja aula esta pessoa gerou hoje (a de hoje pode ser reaberta à vontade)."""
    hoje = datetime.now().date().isoformat()
    return {str((e.get("dados") or {}).get("id")) for e in (eventos if eventos is not None else ler_eventos())
            if e.get("usuario") == uid and e["tipo"] == "aula_gerada" and e["ts"][:10] == hoje}


def registrar_evento(uid, tipo, dados=None):
    if tipo not in TIPOS_EVENTO:
        return
    _anexar(ARQ_EVENTOS, {"ts": datetime.now().isoformat(timespec="seconds"), "usuario": uid, "tipo": tipo, "dados": dados or {}})


def salvar_perfil(uid, perfil):
    (DADOS / "perfis" / f"{uid}.json").write_text(json.dumps(perfil, ensure_ascii=False), encoding="utf-8")


def ler_perfil(uid):
    arq = DADOS / "perfis" / f"{uid}.json"
    return json.loads(arq.read_text(encoding="utf-8")) if arq.exists() else None


PASTA_FILAS = DADOS / "filas"
PASTA_FILAS.mkdir(parents=True, exist_ok=True)
CAMPOS_AULA = ("id", "pmcid", "titulo", "revista", "ano", "tipos", "resumoOriginal", "tema", "modo", "tempo", "publico",
               "perfil", "motivo")


def salvar_fila(uid, itens):
    """Próximos artigos da pessoa, já no formato do pedido de aula (é o que a madrugada usa para preparar a de amanhã)."""
    limpos = []
    for it in itens[:3]:
        if isinstance(it, dict) and it.get("id") and it.get("titulo"):
            item = {k: it.get(k) for k in CAMPOS_AULA}
            item["resumoOriginal"] = str(item.get("resumoOriginal") or "")[:6000]
            item["perfil"] = str(item.get("perfil") or "")[:3000]
            limpos.append(item)
    (PASTA_FILAS / f"{uid}.json").write_text(json.dumps({"atualizado": datetime.now().isoformat(timespec="seconds"),
                                                         "itens": limpos}, ensure_ascii=False), encoding="utf-8")


def ler_filas():
    """{uid: {"atualizado", "itens"}} de todas as pessoas."""
    filas = {}
    for arq in PASTA_FILAS.glob("*.json"):
        try:
            filas[arq.stem] = json.loads(arq.read_text(encoding="utf-8"))
        except ValueError:
            pass
    return filas


def salvar_feedback(uid, dados):
    _anexar(ARQ_FEEDBACK, {"ts": datetime.now().isoformat(timespec="seconds"), "usuario": uid, **dados})


def ler_feedbacks():
    return _ler_jsonl(ARQ_FEEDBACK)


def ler_eventos():
    return _ler_jsonl(ARQ_EVENTOS)
