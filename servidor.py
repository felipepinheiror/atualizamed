"""Servidor do AtualizaMed (fase de testes, acesso restrito por chave).

- Serve os arquivos de `prototipo/` (a casca do app; sem chave, o app só mostra a tela de entrada).
- Toda rota /api/ exige sessão, exceto entrar/sessão. As do painel exigem a chave de desenvolvedor.
- A IA é do app (chave do projeto no .env); ninguém configura nada.

Rotas principais:
  POST /api/entrar {chave}         abre a sessão (cookie)        GET  /api/sessao      quem está logado
  POST /api/estudo | /api/chat | /api/voz | /api/ia             aula, dúvidas, narração, personalização
  POST /api/evento | /api/perfil | /api/feedback                uso, perfil e opinião de cada pessoa
  GET  /api/admin/painel  POST /api/admin/usuarios | /api/admin/ativo | /api/admin/relatorio | /api/admin/decisao

Rode com:  .venv/Scripts/python servidor.py      (para publicar: .venv/Scripts/python publicar.py)
"""
import json
import os
import threading
import time
from collections import defaultdict, deque
from datetime import datetime
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import acesso
import nucleo
import nuvem
from conteudo import gerar_estudo, gerar_relatorio, personalizar, responder_chat

RAIZ = Path(__file__).resolve().parent
PORTA = int(os.environ.get("PORT") or os.environ.get("PORTA") or "8765")
LIMITE_PEDIDOS = 150          # pedidos às rotas de IA por pessoa...
JANELA_SEGUNDOS = 10 * 60     # ...a cada 10 minutos
TAMANHO_MAXIMO = 80_000       # bytes por pedido
COOKIE = "am_sessao"
COOKIE_APARELHO = "am_aparelho"  # selo do aparelho onde a pessoa já entrou com a chave
# Política de segurança do conteúdo: só scripts do próprio app; conexões só com o servidor, o Europe PMC
# (busca de artigos) e o tradutor gratuito; nada de ser aberto dentro de outro site.
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src https://fonts.gstatic.com; img-src 'self' data:; media-src 'self' blob:; "
       "connect-src 'self' https://www.ebi.ac.uk https://api.mymemory.translated.net; "
       "manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")

pedidos = defaultdict(deque)

# Tarefas demoradas (aula, relatório) rodam em segundo plano: o app pergunta de tempos em tempos se ficaram prontas.
# Assim nenhuma resposta passa do limite de ~100 s do túnel da Cloudflare.
tarefas = {}
_trava_tarefas = threading.Lock()


def iniciar_tarefa(chave, dono, funcao):
    with _trava_tarefas:
        atual = tarefas.get(chave)
        if atual and atual["estado"] == "gerando":
            return
        tarefas[chave] = {"estado": "gerando", "dono": dono, "inicio": time.time()}

    def rodar():
        nucleo.contexto.usuario = dono
        try:
            resultado = funcao()
            tarefas[chave] = {"estado": "pronto", "dono": dono, "resultado": resultado, "fim": time.time()}
        except Exception as e:  # noqa: BLE001 — o erro vai para o app mostrar
            tarefas[chave] = {"estado": "erro", "dono": dono, "erro": str(e) or "falha na IA", "fim": time.time()}

    threading.Thread(target=rodar, daemon=True).start()


def dentro_do_limite(chave):
    agora = time.time()
    fila = pedidos[chave]
    while fila and agora - fila[0] > JANELA_SEGUNDOS:
        fila.popleft()
    if len(fila) >= LIMITE_PEDIDOS:
        return False
    fila.append(agora)
    return True


class Handler(SimpleHTTPRequestHandler):
    timeout = 60                      # derruba conexões paradas (proteção contra "conexões lentas")
    server_version = "AtualizaMed"    # não revela a versão do Python
    sys_version = ""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(RAIZ / "prototipo"), **kwargs)

    # ------------------------------------------------------------ utilidades
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
        self.send_header("X-Robots-Tag", "noindex, nofollow")
        if self.https():
            self.send_header("Strict-Transport-Security", "max-age=31536000")
        super().end_headers()

    def list_directory(self, path):  # nunca lista o conteúdo de pastas
        self.send_error(404, "Não encontrado")
        return None

    def send_head(self):
        # Só serve arquivos da pasta do app; arquivos ocultos (ponto no início) nunca.
        if any(parte.startswith(".") for parte in urlparse(self.path).path.split("/") if parte):
            self.send_error(404, "Não encontrado")
            return None
        return super().send_head()

    def guess_type(self, path):
        if str(path).endswith(".webmanifest"):
            return "application/manifest+json"
        return super().guess_type(path)

    def responder(self, status, obj, cookie=None):
        corpo = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        for c in ([cookie] if isinstance(cookie, str) else cookie or []):
            self.send_header("Set-Cookie", c)
        self.end_headers()
        self.wfile.write(corpo)

    def ip(self):
        # Só vale o cabeçalho que a plataforma da frente garante (a pessoa não consegue falsificá-lo):
        # CF-Connecting-IP no túnel da Cloudflare; na nuvem, o definido em CABECALHO_IP.
        cabecalho = os.environ.get("CABECALHO_IP", "CF-Connecting-IP")
        valor = self.headers.get(cabecalho) or ""
        if os.environ.get("CABECALHO_IP_ULTIMO") == "1":  # cadeia "x, y, z": o último foi posto pela plataforma
            return valor.split(",")[-1].strip() or self.client_address[0]
        return valor.split(",")[0].strip() or self.client_address[0]

    def falha_de_entrada(self, modo):
        acesso.registrar_falha(self.ip())
        presentes = [h for h in ("CF-Connecting-IP", "X-Forwarded-For", "True-Client-IP", "X-Real-IP") if self.headers.get(h)]
        print(f"[acesso] entrada recusada ({modo}) ip={self.ip()} cabeçalhos={presentes}", flush=True)

    def https(self):
        return self.headers.get("X-Forwarded-Proto") == "https" or "https" in (self.headers.get("CF-Visitor") or "")

    def cookie_sessao(self, token, idade, nome=COOKIE):
        seguro = "; Secure" if self.https() else ""
        return f"{nome}={token}; Path=/; Max-Age={idade}; HttpOnly; SameSite=Lax{seguro}"

    def ler_cookie(self, nome):
        c = SimpleCookie(self.headers.get("Cookie") or "")
        return c[nome].value if nome in c else None

    def usuario(self):
        token = self.ler_cookie(COOKIE)
        return acesso.usuario_do_token(token) if token else None

    @staticmethod
    def dados_sessao(u):
        return {"nome": u["nome"], "papel": u["papel"], "id": u["id"], "nomeLogin": u.get("nomeLogin")}

    def abrir_sessao(self, u, modo):
        acesso.registrar_evento(u["id"], "entrou", {"modo": modo})
        cookies = [self.cookie_sessao(acesso.criar_token(u["id"]), acesso.DURACAO_SESSAO)]
        if modo == "chave":  # este aparelho passa a poder entrar só com o nome (o selo fica mesmo depois de "Sair")
            cookies.append(self.cookie_sessao(acesso.criar_selo_aparelho(u["id"]), 3 * acesso.DURACAO_SESSAO, COOKIE_APARELHO))
        return self.responder(200, self.dados_sessao(u), cookie=cookies)

    def ler_corpo(self):
        tamanho = int(self.headers.get("Content-Length", "0"))
        if tamanho > TAMANHO_MAXIMO:
            raise ValueError("pedido grande demais")
        return json.loads(self.rfile.read(tamanho).decode("utf-8") or "{}")

    # ------------------------------------------------------------ GET
    def do_GET(self):
        url = urlparse(self.path)
        if not url.path.startswith("/api/"):
            return super().do_GET()
        if url.path == "/api/config-entrada":
            return self.responder(200, {"entrarPorNome": acesso.config()["entrarPorNome"]})
        u = self.usuario()
        if url.path == "/api/sessao":
            if not u:
                return self.responder(401, {"erro": "sem sessão"})
            # Renova a sessão a cada uso: quem usa o app não precisa entrar de novo.
            return self.responder(200, self.dados_sessao(u), cookie=self.cookie_sessao(acesso.criar_token(u["id"]), acesso.DURACAO_SESSAO))
        if not u:
            return self.responder(401, {"erro": "Entre com a sua chave de acesso"})
        nucleo.contexto.usuario = u["id"]
        if url.path == "/api/status":
            return self.responder(200, nucleo.status())
        if url.path == "/api/meu-dia":  # degrau de nível da pessoa e a aula nova de hoje (se já gerou)
            ev = acesso.ler_eventos()
            cal = acesso.calibragem(u["id"], ev)
            hoje = acesso.aulas_novas_hoje(u["id"], ev)
            return self.responder(200, {"ajuste": cal["ajuste"], "avaliacoes": cal["avaliacoes"], "aulasHoje": sorted(hoje),
                                        "aulasAntes": sorted(set(cal["aulas"]) - hoje), "semLimite": u["papel"] == "dev"})
        if url.path == "/api/tarefa":
            chave = (parse_qs(url.query).get("id") or [""])[0]
            t = tarefas.get(chave)
            if not t or (t["dono"] != u["id"] and u["papel"] != "dev"):
                pronto = nucleo.ler_estudo(chave) if chave and not chave.startswith("relatorio") else None
                return self.responder(200, {**pronto, "doCache": True}) if pronto else self.responder(404, {"erro": "tarefa não encontrada"})
            if t["estado"] == "gerando":
                return self.responder(202, {"gerando": True, "segundos": int(time.time() - t["inicio"])})
            if t["estado"] == "erro":
                tarefas.pop(chave, None)  # permite tentar de novo
                return self.responder(502, {"erro": t["erro"]})
            return self.responder(200, t["resultado"])
        if url.path == "/api/texto":
            pmcid = (parse_qs(url.query).get("pmcid") or [""])[0]
            dados = nucleo.texto_completo(pmcid)
            return self.responder(200 if dados else 404, dados or {"erro": "texto completo indisponível"})
        if url.path.startswith("/api/admin/"):
            if u["papel"] != "dev":
                return self.responder(403, {"erro": "só para o desenvolvedor"})
            if url.path == "/api/admin/painel":
                return self.responder(200, painel())
            if url.path == "/api/admin/relatorios":
                return self.responder(200, listar_relatorios())
        return self.responder(404, {"erro": "não encontrado"})

    # ------------------------------------------------------------ POST
    def do_POST(self):
        caminho = urlparse(self.path).path
        try:
            dados = self.ler_corpo()
        except (ValueError, UnicodeDecodeError) as e:
            return self.responder(400, {"erro": str(e) or "pedido inválido"})

        if caminho == "/api/entrar":
            if not acesso.pode_tentar(self.ip()):
                return self.responder(429, {"erro": "Muitas tentativas. Espere 15 minutos."})
            u = acesso.validar_chave(dados.get("chave", ""))
            if not u:
                self.falha_de_entrada("chave")
                return self.responder(401, {"erro": "Chave não reconhecida. Confira as letras e os números."})
            return self.abrir_sessao(u, "chave")
        if caminho == "/api/entrar-nome":
            if not acesso.config()["entrarPorNome"]:
                return self.responder(403, {"erro": "Entrada pelo nome desligada. Use a sua chave."})
            if not acesso.pode_tentar(self.ip()):
                return self.responder(429, {"erro": "Muitas tentativas. Espere 15 minutos."})
            aparelho = acesso.aparelho_do_selo(self.ler_cookie(COOKIE_APARELHO))
            if not aparelho:
                return self.responder(401, {"erro": "Neste aparelho, entre com a sua chave. Depois disso, o nome passa a valer aqui."})
            u = acesso.validar_nome(dados.get("nome", ""), aparelho)
            if not u:
                self.falha_de_entrada("nome")
                return self.responder(401, {"erro": "Esse não é o nome cadastrado neste aparelho. Confira, ou use a sua chave."})
            return self.abrir_sessao(u, "nome")
        if caminho == "/api/sair":
            return self.responder(200, {"ok": True}, cookie=self.cookie_sessao("", 0))

        u = self.usuario()
        if not u:
            return self.responder(401, {"erro": "Entre com a sua chave de acesso"})
        nucleo.contexto.usuario = u["id"]
        if not dentro_do_limite(u["id"]):
            return self.responder(429, {"erro": "Muitos pedidos — tente de novo em alguns minutos"})

        rotas = {
            "/api/ia": self.rota_ia, "/api/estudo": self.rota_estudo, "/api/chat": self.rota_chat, "/api/voz": self.rota_voz,
            "/api/evento": self.rota_evento, "/api/perfil": self.rota_perfil, "/api/feedback": self.rota_feedback,
            "/api/nivel": self.rota_nivel,
            "/api/definir-nome": self.rota_definir_nome, "/api/admin/config": self.rota_config,
            "/api/admin/nova-chave": self.rota_nova_chave,
            "/api/admin/usuarios": self.rota_novo_usuario, "/api/admin/ativo": self.rota_ativo,
            "/api/admin/relatorio": self.rota_relatorio, "/api/admin/decisao": self.rota_decisao,
        }
        rota = rotas.get(caminho)
        if not rota:
            return self.responder(404, {"erro": "não encontrado"})
        if caminho.startswith("/api/admin/") and u["papel"] != "dev":
            return self.responder(403, {"erro": "só para o desenvolvedor"})
        if rota in (self.rota_ia, self.rota_estudo, self.rota_chat, self.rota_relatorio) and not nucleo.status()["ia"]:
            return self.responder(503, {"erro": "IA não configurada no servidor"})
        try:
            return rota(u, dados)
        except Exception as e:  # erro do provedor de IA, da rede ou do conteúdo devolvido
            self.log_error("Falha em %s: %s", self.path, e)
            return self.responder(502, {"erro": str(e) or "falha"})

    def rota_ia(self, u, dados):
        pedido = dados.get("pedido")
        if not isinstance(pedido, str) or not pedido:
            return self.responder(400, {"erro": "pedido vazio"})
        return self.responder(200, {"resultado": personalizar(pedido)})

    def rota_estudo(self, u, dados):
        if not dados.get("id") or not dados.get("titulo"):
            return self.responder(400, {"erro": "artigo não informado"})
        art = str(dados["id"])
        ev = acesso.ler_eventos()
        # Aula que a pessoa já fez deste artigo: reabre como estava (não gasta a aula do dia).
        feitas = [e["dados"] for e in ev if e.get("usuario") == u["id"] and e["tipo"] == "aula_gerada"
                  and str(e["dados"].get("id")) == art and e["dados"].get("chave")]
        if feitas:
            pronto = nucleo.ler_estudo(feitas[-1]["chave"])
            if pronto:
                return self.responder(200, {**pronto, "doCache": True})
        # Uma aula nova por dia: a próxima libera amanhã (o desenvolvedor não tem limite, para testar).
        hoje = acesso.aulas_novas_hoje(u["id"], ev)
        if u["papel"] != "dev" and hoje and art not in hoje:
            return self.responder(403, {"bloqueada": True, "erro": "Você já fez a aula de hoje. A próxima libera amanhã."})
        cal = acesso.calibragem(u["id"], ev)
        dados["calibragem"] = {"ajuste": cal["ajuste"], "comentarios": cal["comentarios"]}
        chave = nucleo.chave_estudo(dados)
        pronto = nucleo.ler_estudo(chave)
        if pronto:
            return self.responder(200, {**pronto, "doCache": True})
        # Reserva a aula do dia já no pedido (dois toques rápidos em artigos diferentes não geram duas).
        acesso.registrar_evento(u["id"], "aula_gerada", {"id": art, "ajuste": cal["ajuste"], "chave": chave,
                                                         "titulo": str(dados.get("titulo"))[:200]})
        iniciar_tarefa(chave, u["id"], lambda: gerar_estudo(dados))
        return self.responder(202, {"gerando": True, "tarefa": chave})

    def rota_chat(self, u, dados):
        pergunta = str(dados.get("pergunta", "")).strip()
        if not pergunta:
            return self.responder(400, {"erro": "pergunta vazia"})
        resposta = responder_chat(dados)
        acesso.registrar_evento(u["id"], "chat", {"artigo": dados.get("id"), "pergunta": pergunta[:300]})
        return self.responder(200, {"resposta": resposta})

    def rota_voz(self, u, dados):
        corpo = nucleo.sintetizar_voz(dados.get("texto", "")).read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "audio/mpeg")
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def rota_evento(self, u, dados):
        tipo = str(dados.get("tipo", ""))
        if tipo in ("aula_gerada", "nivel_manual"):  # só o servidor registra estes
            return self.responder(400, {"erro": "evento inválido"})
        conteudo = dados.get("dados") if isinstance(dados.get("dados"), dict) else {}
        if tipo == "avaliacao_aula":  # guarda de que degrau era a aula avaliada, para o ajuste ser relativo a ela
            conteudo["ajusteAula"] = acesso.calibragem(u["id"])["aulas"].get(str(conteudo.get("id")), 0)
        acesso.registrar_evento(u["id"], tipo, conteudo)
        return self.responder(200, {"ok": True})

    def rota_nivel(self, u, dados):
        """A própria pessoa escolhe o degrau de profundidade das próximas aulas (Ajustes)."""
        try:
            ajuste = max(acesso.AJUSTE_MIN, min(acesso.AJUSTE_MAX, int(dados.get("ajuste"))))
        except (TypeError, ValueError):
            return self.responder(400, {"erro": "nível inválido"})
        acesso.registrar_evento(u["id"], "nivel_manual", {"ajuste": ajuste})
        return self.responder(200, {"ajuste": ajuste})

    def rota_definir_nome(self, u, dados):
        erro = acesso.definir_nome_login(u["id"], str(dados.get("nome", "")))
        return self.responder(400, {"erro": erro}) if erro else self.responder(200, {"ok": True})

    def rota_config(self, u, dados):
        return self.responder(200, acesso.definir_config(entrarPorNome=bool(dados.get("entrarPorNome"))))

    def rota_perfil(self, u, dados):
        if isinstance(dados.get("perfil"), dict):
            acesso.salvar_perfil(u["id"], {"perfil": dados["perfil"], "descricao": str(dados.get("descricao", ""))[:3000],
                                           "atualizado": datetime.now().isoformat(timespec="seconds")})
        return self.responder(200, {"ok": True})

    def rota_feedback(self, u, dados):
        campos = {
            "nota": dados.get("nota") if dados.get("nota") in (1, 2, 3, 4, 5) else None,
            "gostou": str(dados.get("gostou", ""))[:3000], "melhorar": str(dados.get("melhorar", ""))[:3000],
            "erros": str(dados.get("erros", ""))[:3000], "areas": [str(a)[:40] for a in dados.get("areas", [])][:10],
        }
        if not any([campos["nota"], campos["gostou"], campos["melhorar"], campos["erros"]]):
            return self.responder(400, {"erro": "Escreva alguma coisa ou dê uma nota"})
        acesso.salvar_feedback(u["id"], campos)
        return self.responder(200, {"ok": True})

    # ------------------------------------------------------------ painel do desenvolvedor
    def rota_novo_usuario(self, u, dados):
        nome = str(dados.get("nome", "")).strip()
        if len(nome) < 2:
            return self.responder(400, {"erro": "Informe o nome da pessoa"})
        novo, chave = acesso.criar_usuario(nome, "testador")
        return self.responder(200, {"usuario": novo, "chave": chave})

    def rota_nova_chave(self, u, dados):
        chave = acesso.nova_chave(str(dados.get("id", "")))
        return self.responder(200, {"chave": chave}) if chave else self.responder(400, {"erro": "pessoa não encontrada"})

    def rota_ativo(self, u, dados):
        acesso.definir_ativo(str(dados.get("id", "")), bool(dados.get("ativo")))
        return self.responder(200, {"ok": True})

    def rota_relatorio(self, u, dados):
        def fazer():
            rel = gerar_relatorio(material_relatorio())
            nome = datetime.now().strftime("%Y-%m-%d_%H%M%S") + ".json"
            registro = {"arquivo": nome, "gerado": datetime.now().isoformat(timespec="seconds"), "relatorio": rel, "decisoes": {}}
            (acesso.DADOS / "relatorios" / nome).write_text(json.dumps(registro, ensure_ascii=False, indent=1), encoding="utf-8")
            return registro
        chave = "relatorio-" + datetime.now().strftime("%Y%m%d%H%M%S")
        iniciar_tarefa(chave, u["id"], fazer)
        return self.responder(202, {"gerando": True, "tarefa": chave})

    def rota_decisao(self, u, dados):
        arq = acesso.DADOS / "relatorios" / Path(str(dados.get("arquivo", ""))).name
        if not arq.exists() or dados.get("decisao") not in ("aprovado", "manter", "depois", None):
            return self.responder(400, {"erro": "pedido inválido"})
        registro = json.loads(arq.read_text(encoding="utf-8"))
        registro.setdefault("decisoes", {})[str(dados.get("indice"))] = dados.get("decisao")
        arq.write_text(json.dumps(registro, ensure_ascii=False, indent=1), encoding="utf-8")
        return self.responder(200, {"ok": True})

    def log_message(self, formato, *args):
        if "/api/" in str(args[0] if args else "") or (args and str(args[0]).startswith(("4", "5"))):
            super().log_message(formato, *args)


# ---------------------------------------------------------------- dados do painel
def _resumo_perfil(uid):
    p = (acesso.ler_perfil(uid) or {}).get("perfil") or {}
    partes = [p.get("carreiraTexto"), p.get("especialidade") or p.get("faseTexto"), p.get("rodizio") or p.get("area") or p.get("cursando")]
    return " · ".join(x for x in partes if x)


def _ouvido_por_aula(ev):
    """Maior fração da videoaula ouvida em cada aula (a pessoa pode sair e voltar várias vezes)."""
    ouvido = {}
    for e in ev:
        if e["tipo"] != "video_ouvido":
            continue
        d = e.get("dados") or {}
        try:
            fracao = min(1.0, max(0.0, float(d.get("ouvidas", 0)) / float(d.get("total") or 0)))
        except (TypeError, ValueError, ZeroDivisionError):
            continue
        chave = str(d.get("id"))
        ouvido[chave] = max(ouvido.get(chave, 0.0), fracao)
    return ouvido


def painel():
    usuarios = acesso.listar_usuarios()
    eventos = acesso.ler_eventos()
    feedbacks = acesso.ler_feedbacks()
    ia = nucleo.uso_por_usuario()
    por = defaultdict(list)
    for e in eventos:
        por[e["usuario"]].append(e)
    nomes = {u["id"]: u["nome"] for u in usuarios}
    pessoas = []
    for u in usuarios:
        ev = por[u["id"]]
        quizzes = [e["dados"] for e in ev if e["tipo"] == "quiz_concluido" and e["dados"].get("total")]
        avaliacoes = [e["dados"] for e in ev if e["tipo"] == "avaliacao_aula"]
        ouvido = _ouvido_por_aula(ev)
        pessoas.append({
            **u, "perfil": _resumo_perfil(u["id"]),
            "ultimoAcesso": max((e["ts"] for e in ev), default=None),
            "diasAtivos": len({e["ts"][:10] for e in ev}),
            "aulas": sum(1 for e in ev if e["tipo"] == "aula_aberta"),
            "videos": sum(1 for e in ev if e["tipo"] == "video_concluido"),
            "ouvidoMedio": round(100 * sum(ouvido.values()) / len(ouvido)) if ouvido else None,
            "aulasOuvidas": len(ouvido),
            "quizzes": len(quizzes),
            "acertoMedio": round(100 * sum(q["acertos"] / q["total"] for q in quizzes) / len(quizzes)) if quizzes else None,
            "perguntasChat": sum(1 for e in ev if e["tipo"] == "chat"),
            "avaliacoes": avaliacoes[-5:],
            "feedbacks": sum(1 for f in feedbacks if f["usuario"] == u["id"]),
            "ia": ia.get(u["id"], {"chamadas": 0, "tokens": 0, "custo_se_pago_usd": 0}),
            "nivel": acesso.calibragem(u["id"], ev)["ajuste"],
        })
    url = (acesso.DADOS / "url_publica.txt")
    # Na nuvem o endereço público é fixo e vem da própria plataforma (Render ou Hugging Face).
    nuvem_url = os.environ.get("RENDER_EXTERNAL_URL") or (f"https://{os.environ['SPACE_HOST']}" if os.environ.get("SPACE_HOST") else None)
    entradas = defaultdict(lambda: {"chave": 0, "nome": 0})
    for e in eventos:
        if e["tipo"] == "entrou":
            entradas[e["usuario"]][e["dados"].get("modo", "chave")] += 1
    for p in pessoas:
        p["entradas"] = entradas[p["id"]]
    return {
        "config": acesso.config(),
        "pessoas": pessoas,
        "feedbacks": [{**f, "nome": nomes.get(f["usuario"], "?")} for f in reversed(feedbacks)][:100],
        "avaliacoes": [{**e["dados"], "nome": nomes.get(e["usuario"], "?"), "ts": e["ts"]} for e in reversed(eventos) if e["tipo"] == "avaliacao_aula"][:100],
        "ia": nucleo.status(), "usoTotal": nucleo.resumo_uso(),
        "urlPublica": nuvem_url or (url.read_text(encoding="utf-8").strip() if url.exists() else None),
    }


def material_relatorio():
    """O que vai para a IA: opiniões e uso, identificando as pessoas só pelo perfil (sem chaves)."""
    dados = painel()
    perfis = {p["id"]: f"{p['nome'].split()[0]} ({p['perfil'] or 'perfil não informado'})" for p in dados["pessoas"]}
    return {
        "feedbacks": [{k: f.get(k) for k in ("ts", "nota", "gostou", "melhorar", "erros", "areas")} | {"pessoa": perfis.get(f["usuario"], "?")} for f in dados["feedbacks"]],
        "avaliacoesDasAulas": [{k: a.get(k) for k in ("titulo", "util", "nivel", "comentario")} | {"pessoa": a["nome"]} for a in dados["avaliacoes"]],
        "uso": [{"pessoa": perfis[p["id"]], **{k: p[k] for k in ("diasAtivos", "aulas", "videos", "quizzes", "acertoMedio", "perguntasChat", "feedbacks")}}
                for p in dados["pessoas"] if p["papel"] != "dev"],
    }


def listar_relatorios():
    arquivos = sorted((acesso.DADOS / "relatorios").glob("*.json"), reverse=True)
    return [json.loads(a.read_text(encoding="utf-8")) for a in arquivos[:10]]


if __name__ == "__main__":
    nuvem.iniciar()  # no Hugging Face: restaura os dados guardados antes de atender
    s = nucleo.status()
    ia = f"{s['provedor']} ({s['modelo']})" if s["ia"] else "desligada — configure o .env"
    print(f"AtualizaMed em http://localhost:{PORTA}  |  IA: {ia}  |  pessoas cadastradas: {len(acesso.listar_usuarios())}")
    # Só este computador acessa diretamente; de fora, o acesso é pelo túnel (publicar.py), sempre com chave.
    endereco = "0.0.0.0" if nucleo.ler_valor("REDE_LOCAL") == "1" else "127.0.0.1"
    ThreadingHTTPServer((endereco, PORTA), Handler).serve_forever()
