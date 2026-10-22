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


def criar_usuario(nome, papel="testador"):
    """Cria uma pessoa e devolve (usuario, chave). A chave em texto só existe neste momento."""
    chave = gerar_chave_forte() if papel == "dev" else gerar_chave_simples()
    with _trava:
        dados = _ler()
        usuario = {"id": secrets.token_hex(4), "nome": nome.strip()[:60] or "Sem nome", "papel": papel,
                   "hash": _hash(chave), "criado": datetime.now().isoformat(timespec="seconds"), "ativo": True}
        dados["usuarios"].append(usuario)
        _gravar(dados)
    return publico(usuario), chave


def publico(u):
    return {k: u.get(k) for k in ("id", "nome", "papel", "criado", "ativo", "nomeLogin")}


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
                chave = gerar_chave_simples()
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
    padrao = {"entrarPorNome": True}
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


def salvar_feedback(uid, dados):
    _anexar(ARQ_FEEDBACK, {"ts": datetime.now().isoformat(timespec="seconds"), "usuario": uid, **dados})


def ler_feedbacks():
    return _ler_jsonl(ARQ_FEEDBACK)


def ler_eventos():
    return _ler_jsonl(ARQ_EVENTOS)
