"""Preparo da madrugada: deixa pronta a aula do dia de cada pessoa antes de ela acordar.

Toda noite (PREPARO_HORA, padrão 01:00 no fuso do servidor), para cada pessoa que abriu o app nos últimos dias:
1. pega o próximo artigo da fila dela (enviada pelo app) que ainda não virou aula;
2. gera a aula com o mesmo pedido que o app faria, já com a calibragem de nível da pessoa (fica no cache);
3. narra todas as partes, para o vídeo também abrir na hora.
De manhã, quando a pessoa toca em "Estudar", o servidor encontra a aula pronta. Se algo falhar à noite, nada muda:
a aula é gerada na hora, como antes. Cada pessoa leva uma aula por noite; 3 pessoas por vez, com os trechos de
narração de cada aula em paralelo (100 pessoas cabem em cerca de 40 minutos).
"""
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

import acesso
import nucleo
from conteudo import gerar_estudo

DIAS_ATIVA = 3      # só prepara para quem abriu o app nos últimos dias (fila atualizada recentemente)
PAUSA_ENTRE = 5     # segundos de folga depois de cada pessoa (respeita a cota por minuto da IA)
PESSOAS_JUNTAS = 3  # aulas geradas ao mesmo tempo
TRECHOS_JUNTOS = 6  # trechos de narração gerados ao mesmo tempo, por aula


def alvo_de(uid, fila, eventos):
    """Primeiro artigo da fila que ainda não virou aula para esta pessoa, com o pedido pronto (ou None)."""
    cal = acesso.calibragem(uid, eventos)
    for item in fila.get("itens", []):
        if str(item.get("id")) not in cal["aulas"]:
            return {**item, "calibragem": {"ajuste": cal["ajuste"], "comentarios": cal["comentarios"]}}
    return None


def preparar_uma(uid, dados):
    """Gera (se ainda não existir) a aula e a narração. Devolve 'pronta', 'ja_existia' ou a mensagem de erro."""
    chave = nucleo.chave_estudo(dados)
    if nucleo.ler_estudo(chave):
        return "ja_existia"
    nucleo.contexto.usuario = uid
    estudo = gerar_estudo(dados)
    trechos = [p.get("narracao", "") for s in estudo.get("slides", []) for p in s.get("partes", []) if p.get("narracao")]

    def narrar(texto):
        try:
            nucleo.sintetizar_voz(texto)
        except Exception:  # a narração falta só deste trecho; o app gera na hora
            pass
    with ThreadPoolExecutor(max_workers=TRECHOS_JUNTOS) as grupo:
        list(grupo.map(narrar, trechos))
    return "pronta"


def preparar_todas():
    usuarios = {u["id"]: u for u in acesso.listar_usuarios()}
    eventos = acesso.ler_eventos()
    limite = datetime.now() - timedelta(days=DIAS_ATIVA)
    resumo = {"pronta": 0, "ja_existia": 0, "sem_alvo": 0, "erro": 0}
    trava = threading.Lock()
    pendentes = []
    for uid, fila in acesso.ler_filas().items():
        u = usuarios.get(uid)
        if not u or not u.get("ativo") or datetime.fromisoformat(fila["atualizado"]) < limite:
            continue
        dados = alvo_de(uid, fila, eventos)
        if dados:
            pendentes.append((uid, dados))
        else:
            resumo["sem_alvo"] += 1

    def uma(par):
        uid, dados = par
        try:
            resultado = preparar_uma(uid, dados)
        except Exception as e:
            resultado = "erro"
            print(f"[preparo] {uid}: {type(e).__name__}: {e}", flush=True)
        with trava:
            resumo[resultado] += 1
        time.sleep(PAUSA_ENTRE)
    inicio = time.time()
    with ThreadPoolExecutor(max_workers=PESSOAS_JUNTAS) as grupo:
        list(grupo.map(uma, pendentes))
    print(f"[preparo] {datetime.now():%d/%m %H:%M} aulas preparadas em {time.time() - inicio:.0f} s: {resumo}", flush=True)
    return resumo


def _proxima(hora):
    agora = datetime.now()
    alvo = agora.replace(hour=hora, minute=0, second=0, microsecond=0)
    return alvo if alvo > agora else alvo + timedelta(days=1)


def iniciar():
    """Agenda o preparo diário numa linha de execução própria do servidor."""
    hora = int(nucleo.ler_valor("PREPARO_HORA", "1"))

    def laco():
        while True:
            time.sleep(max(1, (_proxima(hora) - datetime.now()).total_seconds()))
            try:
                preparar_todas()
            except Exception as e:  # nunca derruba o servidor
                print(f"[preparo] falhou: {type(e).__name__}: {e}", flush=True)
    threading.Thread(target=laco, daemon=True).start()
    print(f"[preparo] agendado para {hora:02d}:00 todos os dias", flush=True)
