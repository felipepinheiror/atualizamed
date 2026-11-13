"""Guarda os dados do app, CRIPTOGRAFADOS, num repositório privado do Hugging Face quando ele roda na nuvem.

O disco gratuito da nuvem se apaga quando o servidor reinicia ou dorme. Por isso, ao ligar, o servidor baixa o
backup do repositório privado (HF_DADOS_REPO) e, enquanto roda, envia as mudanças a cada 2 minutos e ao desligar.
Fora da nuvem (sem HF_TOKEN e HF_DADOS_REPO), nada disso acontece.

Segurança:
- O backup é um único arquivo cifrado com AES-256-GCM. A chave deriva do segredo do servidor (ATUALIZAMED_SEGREDO),
  que só existe nas variáveis secretas da plataforma: no repositório há apenas bytes ilegíveis, e qualquer
  alteração no arquivo é detectada (a decifração falha).
- Se o backup existir mas não puder ser lido (rede, arquivo alterado), o servidor NÃO salva por cima: a cópia
  boa nunca é substituída por dados vazios.
- O histórico do repositório é compactado de tempos em tempos, para não acumular versões antigas.
- Nunca entram no backup: o segredo do servidor, a chave do desenvolvedor em texto, o link público e o cache de áudio.
"""
import atexit
import fnmatch
import hashlib
import io
import os
import secrets
import signal
import sys
import tarfile
import threading
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
PADROES = ["dados/**", "cache/estudo/**", "cache/uso.jsonl"]
NUNCA = ["dados/segredo.key", "dados/chave-desenvolvedor.txt", "dados/url_publica.txt", "**/*.tmp"]
ARQUIVO = "backup.tar.gz.cifrado"
CABECALHO = b"AMC1"
INTERVALO = 120
COMPACTAR_A_CADA = 30  # envios
_trava = threading.Lock()
_ultima = None
_bloqueado = False  # verdadeiro se o backup existente não pôde ser lido: nunca salvar por cima
_envios = 0


def ativa():
    return bool(os.environ.get("HF_TOKEN") and os.environ.get("HF_DADOS_REPO") and os.environ.get("ATUALIZAMED_SEGREDO"))


def _chave():
    return hashlib.sha256(b"atualizamed-backup-v1|" + os.environ["ATUALIZAMED_SEGREDO"].strip().encode()).digest()


def _cifrar(dados):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    nonce = secrets.token_bytes(12)
    return CABECALHO + nonce + AESGCM(_chave()).encrypt(nonce, dados, CABECALHO)


def _decifrar(bruto):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    if not bruto.startswith(CABECALHO):
        raise ValueError("arquivo de backup desconhecido")
    return AESGCM(_chave()).decrypt(bruto[4:16], bruto[16:], CABECALHO)


def _arquivos():
    for base in ("dados", "cache/estudo", "cache/uso.jsonl"):
        alvo = RAIZ / base
        for arq in ([alvo] if alvo.is_file() else sorted(alvo.rglob("*")) if alvo.exists() else []):
            rel = arq.relative_to(RAIZ).as_posix()
            if arq.is_file() and not any(fnmatch.fnmatch(rel, p) for p in NUNCA):
                yield arq, rel


def _assinatura():
    """Tamanho e data de cada arquivo: se mudar, há algo novo para enviar."""
    return tuple((rel, a.stat().st_size, a.stat().st_mtime_ns) for a, rel in _arquivos())


def _empacotar():
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for arq, rel in _arquivos():
            tar.add(arq, arcname=rel)
    return buf.getvalue()


def _desempacotar(dados):
    with tarfile.open(fileobj=io.BytesIO(dados), mode="r:gz") as tar:
        for m in tar.getmembers():
            destino = (RAIZ / m.name).resolve()
            permitido = any(fnmatch.fnmatch(m.name, p) for p in PADROES) and not any(fnmatch.fnmatch(m.name, p) for p in NUNCA)
            if not m.isfile() or not permitido or RAIZ not in destino.parents:
                continue  # nada fora das pastas de dados, nem links: o backup não escreve em outro lugar
            destino.parent.mkdir(parents=True, exist_ok=True)
            destino.write_bytes(tar.extractfile(m).read())


def restaurar():
    """Baixa e decifra o backup. Sem backup ainda: começa do zero. Backup ilegível: bloqueia os envios."""
    global _ultima, _bloqueado
    from huggingface_hub import HfApi, hf_hub_download
    api = HfApi(token=os.environ["HF_TOKEN"])
    repo = os.environ["HF_DADOS_REPO"]
    for tentativa in range(1, 6):
        try:
            if ARQUIVO not in api.list_repo_files(repo, repo_type="dataset"):
                print("[nuvem] ainda não há backup; começando do zero", flush=True)
                break
            caminho = hf_hub_download(repo, ARQUIVO, repo_type="dataset", token=os.environ["HF_TOKEN"],
                                      cache_dir=str(Path.home() / ".cache" / "atualizamed"), force_download=True)
            _desempacotar(_decifrar(Path(caminho).read_bytes()))
            Path(caminho).unlink(missing_ok=True)
            print("[nuvem] backup restaurado e decifrado", flush=True)
            break
        except Exception as e:
            print(f"[nuvem] tentativa {tentativa} de restaurar falhou ({type(e).__name__}: {e})", flush=True)
            time.sleep(5 * tentativa)
    else:
        _bloqueado = True
        print("[nuvem] ATENÇÃO: backup não pôde ser lido; os envios ficam bloqueados para não apagar a cópia boa", flush=True)
    _ultima = _assinatura()


def salvar(motivo="mudanças"):
    """Cifra e envia o backup se algo mudou desde o último envio."""
    global _ultima, _envios
    if _bloqueado:
        return
    with _trava:
        atual = _assinatura()
        if atual == _ultima:
            return
        from huggingface_hub import HfApi
        api = HfApi(token=os.environ["HF_TOKEN"])
        try:
            api.upload_file(path_or_fileobj=_cifrar(_empacotar()), path_in_repo=ARQUIVO, repo_id=os.environ["HF_DADOS_REPO"],
                            repo_type="dataset", commit_message=f"backup cifrado: {motivo}")
            _ultima = atual
            _envios += 1
            if _envios % COMPACTAR_A_CADA == 0:
                api.super_squash_history(repo_id=os.environ["HF_DADOS_REPO"], repo_type="dataset")
        except Exception as e:  # tenta de novo no próximo ciclo
            print(f"[nuvem] falha ao salvar ({type(e).__name__}: {e})", flush=True)


def _laco():
    while True:
        time.sleep(INTERVALO)
        salvar()


def iniciar():
    if not ativa():
        return
    restaurar()
    threading.Thread(target=_laco, daemon=True).start()
    atexit.register(salvar, "desligando")

    def ao_encerrar(sinal, _quadro):
        salvar("desligando")
        sys.exit(0)
    signal.signal(signal.SIGTERM, ao_encerrar)
