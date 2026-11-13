"""Conferência do conteúdo da aula contra o artigo, em camadas.

1. Números (por código, sem IA, sem custo): todo número que importa na aula — porcentagens, decimais, números com
   unidade clínica (mg, h, dias, mmHg…) e inteiros acima de 10 — precisa existir no texto do artigo. Anos e contagens
   pequenas sem unidade ("3 mensagens") ficam de fora. As alternativas ERRADAS do miniteste também ficam de fora:
   elas existem justamente para estar erradas.
2. Afirmações (IA, outro pedido): um revisor confere cada afirmação contra o texto e devolve o que não se sustenta,
   com o trecho do artigo e a correção.
3. Correção (IA, uma rodada): se houver problema grave, a aula volta para ser corrigida e os números são conferidos
   de novo. O que sobrar fica registrado na própria aula e aparece para a pessoa como "pontos a conferir".

O resultado vai em estudo["conferencia"]. Para trocar o modelo revisor no futuro (ex.: um modelo de outra família),
basta mudar a chamada em `conferir_afirmacoes`; o restante não depende do provedor.
"""
import re
from datetime import datetime

UNIDADES = (r"%|mg|mcg|µg|g|kg|ml|mL|l|L|h|horas?|min|minutos?|s|dias?|semanas?|meses|mês|anos?|mmHg|mm|cm|"
            r"UI|U|mEq|mmol|mg/dL|g/dL|bpm|ipm|°C|kg/m2|kg/m²|x|vezes")
# número (com milhar e decimal em qualquer padrão) seguido, opcionalmente, de unidade
_NUM = re.compile(r"(?<![\w.,])(\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,](\d+))?\s*(" + UNIDADES + r")?(?![\w])")
_PALAVRAS_EN = {"zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
                "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "fifteen": 15, "twenty": 20, "thirty": 30,
                "forty": 40, "fifty": 50, "hundred": 100, "half": 50}


# ---------------------------------------------------------------- números por extenso em português (narração)
_UNIDADES_PT = {"zero": 0, "um": 1, "uma": 1, "dois": 2, "duas": 2, "três": 3, "tres": 3, "quatro": 4, "cinco": 5, "seis": 6,
                "sete": 7, "oito": 8, "nove": 9, "dez": 10, "onze": 11, "doze": 12, "treze": 13, "quatorze": 14, "catorze": 14,
                "quinze": 15, "dezesseis": 16, "dezessete": 17, "dezoito": 18, "dezenove": 19, "vinte": 20, "trinta": 30,
                "quarenta": 40, "cinquenta": 50, "sessenta": 60, "setenta": 70, "oitenta": 80, "noventa": 90, "cem": 100,
                "cento": 100, "duzentos": 200, "duzentas": 200, "trezentos": 300, "trezentas": 300, "quatrocentos": 400,
                "quinhentos": 500, "seiscentos": 600, "setecentos": 700, "oitocentos": 800, "novecentos": 900}
_PALAVRA_NUM = r"(?:" + "|".join(sorted(_UNIDADES_PT, key=len, reverse=True)) + r"|mil)"
_SEQ = rf"{_PALAVRA_NUM}(?:\s+(?:e\s+)?{_PALAVRA_NUM})*"
_EXTENSO = re.compile(rf"(?<![\wÀ-ú])({_SEQ})(?:\s+vírgula\s+({_SEQ}))?(?:\s+(por\s+cento|miligramas?|microgramas?|gramas?|"
                      rf"mililitros?|litros?|horas?|minutos?|dias?|semanas?|meses|anos|milímetros?|centímetros?|"
                      rf"milímetros\s+de\s+mercúrio|unidades))?(?![\wÀ-ú])", re.I)
_UNIDADE_EXTENSO = {"por cento": "%", "miligrama": "mg", "micrograma": "mcg", "grama": "g", "mililitro": "mL", "litro": "L",
                    "hora": "h", "minuto": "min", "dia": "dias", "semana": "semanas", "meses": "meses", "anos": "anos",
                    "milímetro": "mm", "centímetro": "cm", "unidades": "U"}


def _ordem(palavra):
    v = _UNIDADES_PT[palavra]
    return 3 if v >= 100 else 2 if v >= 20 else 1


def _inteiros_extenso(seq):
    """Separa números colados por "e": "doze e vinte e quatro" → [12, 24]; "cento e vinte e cinco" → [125].
    Dentro de um número, as ordens só descem (centena → dezena → unidade); se não descer, começa outro número."""
    numeros, total, atual, ultima = [], 0, 0, 4
    for palavra in re.findall(_PALAVRA_NUM, seq.lower()):
        if palavra == "mil":
            total += (atual or 1) * 1000
            atual, ultima = 0, 4
            continue
        ordem = _ordem(palavra)
        if ordem >= ultima:
            numeros.append(total + atual)
            total, atual = 0, 0
        atual += _UNIDADES_PT[palavra]
        ultima = ordem
    numeros.append(total + atual)
    return numeros


def numeros_por_extenso(texto):
    """'quatro vírgula quatro por cento' → (4.4, 1, '%'); 'entre doze e vinte e quatro por cento' → 12 e 24 %."""
    achados = []
    for m in _EXTENSO.finditer(str(texto or "")):
        inteiros = _inteiros_extenso(m.group(1))
        decimal = str(_inteiros_extenso(m.group(2))[0]) if m.group(2) else None
        unidade = m.group(3)
        if unidade:
            unidade = next((v for k, v in _UNIDADE_EXTENSO.items() if unidade.lower().startswith(k)), unidade)
        for i, inteiro in enumerate(inteiros):
            ultimo = i == len(inteiros) - 1
            valor = float(f"{inteiro}.{decimal}") if decimal and ultimo else float(inteiro)
            # a unidade do fim vale para todos ("doze e vinte e quatro por cento" = 12% e 24%)
            achados.append((m.group(0), valor, len(decimal) if decimal and ultimo else 0, unidade))
    return achados


def _valor(inteiro, decimal):
    """'1,234' (milhar em inglês) e '1.234' (milhar em português) → 1234; '4,4' e '4.4' → 4.4."""
    if re.fullmatch(r"\d{1,3}(?:[.,]\d{3})+", inteiro):
        return float(re.sub(r"[.,]", "", inteiro) + (("." + decimal) if decimal else ""))
    return float(inteiro + (("." + decimal) if decimal else ""))


def numeros_da_fonte(texto):
    """Todos os valores numéricos do artigo, com as variações que a aula pode usar legitimamente."""
    vals = set()
    for m in _NUM.finditer(texto or ""):
        inteiro, decimal = m.group(1), m.group(2)
        candidatos = {_valor(inteiro, decimal)}
        if re.fullmatch(r"\d{1,3}[.,]\d{3}", inteiro + ("" if not decimal else "")) and not decimal:
            candidatos.add(float(inteiro.replace(",", ".")))  # "1,234" também pode ser decimal
        for v in candidatos:
            vals.update({v, round(v * 100, 4)})  # proporção 0,12 → 12%
            if v > 1:
                vals.add(round(v / 100, 6))
    for palavra, v in _PALAVRAS_EN.items():
        if re.search(rf"\b{palavra}\b", texto or "", re.I):
            vals.add(float(v))
    return vals


def _relevante(valor, decimal, unidade):
    if unidade or decimal:
        return True
    if 1900 <= valor <= 2100:  # ano
        return False
    return valor > 10


def _confere(valor, casas, fonte):
    for f in fonte:
        if abs(f - valor) < 1e-9:
            return True
        if casas is not None and round(f, casas) == valor:  # aula arredondou o número do artigo
            return True
    return False


def numeros_da_aula(estudo):
    """(onde, texto, valor, casas) de cada número relevante mostrado ao aluno."""
    achados = []

    def varrer(onde, texto):
        for m in _NUM.finditer(str(texto or "")):
            inteiro, decimal, unidade = m.group(1), m.group(2), m.group(3)
            v = _valor(inteiro, decimal)
            if _relevante(v, decimal, unidade):
                achados.append((onde, m.group(0).strip(), v, len(decimal) if decimal else 0))
        # Também os números escritos por extenso (a narração é toda assim, e às vezes a tela também).
        for trecho, v, casas, unidade in numeros_por_extenso(texto):
            if _relevante(v, casas, unidade):
                achados.append((onde, trecho.strip(), v, casas))

    varrer("frase principal", estudo.get("umaFrase"))
    for s in estudo.get("secoes", []):
        for item in s.get("itens", []):
            varrer(f"resumo · {s.get('titulo', '')}", item)
    for p in estudo.get("pontosChave", []):
        varrer("pontos-chave", p)
    for i, s in enumerate(estudo.get("slides", []), 1):
        onde = f"slide {i} · {s.get('titulo', '')}"
        varrer(onde, s.get("titulo"))
        for p in s.get("partes", []):
            varrer(onde, p.get("texto"))
            varrer(onde, p.get("marca"))
            varrer(f"{onde} · narração", p.get("narracao"))
        if s.get("numero"):
            varrer(onde, s["numero"].get("valor"))
        for item in (s.get("grafico") or {}).get("itens", []):
            varrer(onde, item.get("texto"))
        if s.get("proporcao"):
            varrer(onde, s["proporcao"].get("texto"))
    for i, q in enumerate(estudo.get("quiz", []), 1):
        # O enunciado é um caso clínico fictício (idade, sinais vitais inventados de propósito): não entra.
        varrer(f"miniteste {i}", q["alternativas"][q["correta"]] if q.get("alternativas") else "")
        varrer(f"miniteste {i}", q.get("explicacao"))
    return achados


def conferir_numeros(estudo, texto_fonte):
    fonte = numeros_da_fonte(texto_fonte)
    achados = numeros_da_aula(estudo)
    soltos = [{"onde": onde, "trecho": trecho} for onde, trecho, v, casas in achados if not _confere(v, casas, fonte)]
    return {"total": len(achados), "confirmados": len(achados) - len(soltos), "soltos": soltos}


# ---------------------------------------------------------------- revisor por IA
SISTEMA_REVISOR = """Você é o revisor médico do AtualizaMed. Confere se uma aula gerada por IA é FIEL ao artigo científico.
Regras:
- Compare cada afirmação da aula com o TEXTO DO ARTIGO fornecido. Use só o artigo; não use conhecimento externo para
  aprovar uma afirmação que o artigo não sustenta.
- Aponte apenas problemas reais: número, dose, ponto de corte, desfecho, população ou conclusão que o artigo não diz ou
  diz diferente; recomendação apresentada como do artigo sem estar nele; exagero da força da evidência.
- Paráfrases fiéis e arredondamentos razoáveis NÃO são problema.
- "gravidade": "alta" se puder levar a erro de conduta (dose, critério, indicação, número errado); "media" para
  imprecisões que não mudam a conduta.
- Para cada problema, traga o trecho do artigo que mostra o certo (ou diga que o artigo não aborda) e a correção.
- Responda SOMENTE com JSON válido."""

ESQUEMA_REVISAO = {
    "type": "object",
    "properties": {
        "problemas": {"type": "array", "items": {"type": "object", "properties": {
            "onde": {"type": "string"}, "afirmacao": {"type": "string"}, "gravidade": {"type": "string", "enum": ["alta", "media"]},
            "trecho_artigo": {"type": "string"}, "correcao": {"type": "string"}},
            "required": ["onde", "afirmacao", "gravidade", "correcao"]}},
    },
    "required": ["problemas"],
}


def _afirmacoes(estudo):
    """O que o aluno lê ou ouve, em texto compacto (para o revisor)."""
    linhas = [f"[frase principal] {estudo.get('umaFrase', '')}"]
    for s in estudo.get("secoes", []):
        linhas += [f"[resumo · {s.get('titulo', '')}] {i}" for i in s.get("itens", [])]
    linhas += [f"[pontos-chave] {p}" for p in estudo.get("pontosChave", [])]
    for i, s in enumerate(estudo.get("slides", []), 1):
        onde = f"slide {i}"
        if s.get("numero"):
            linhas.append(f"[{onde} · número] {s['numero'].get('valor')} — {s['numero'].get('legenda', '')}")
        for item in (s.get("grafico") or {}).get("itens", []):
            linhas.append(f"[{onde} · gráfico] {item.get('rotulo')}: {item.get('texto')}")
        if s.get("proporcao"):
            linhas.append(f"[{onde} · proporção] {s['proporcao'].get('texto')} — {s['proporcao'].get('legenda', '')}")
        for p in s.get("partes", []):
            linhas.append(f"[{onde}] {p.get('narracao', '')}")
    for i, q in enumerate(estudo.get("quiz", []), 1):
        certa = q["alternativas"][q["correta"]] if q.get("alternativas") else ""
        linhas.append(f"[miniteste {i}] {q.get('pergunta')} → resposta dada como certa: {certa}. Explicação: {q.get('explicacao')}")
    return "\n".join(linhas)


def conferir_afirmacoes(estudo, texto_fonte, numeros, gerar):
    soltos = "\n".join(f"- {n['onde']}: {n['trecho']}" for n in numeros["soltos"]) or "(nenhum)"
    pedido = f"""TEXTO DO ARTIGO:
\"\"\"
{texto_fonte}
\"\"\"

AULA A CONFERIR (cada linha é uma afirmação; entre colchetes, onde ela aparece):
{_afirmacoes(estudo)}

NÚMEROS QUE A CONFERÊNCIA AUTOMÁTICA NÃO ACHOU NO TEXTO (confirme se estão errados ou se são uma forma legítima de
escrever um dado do artigo, como uma conta simples ou outra unidade):
{soltos}

Formato: {{"problemas": [{{"onde": "slide 3", "afirmacao": "...", "gravidade": "alta", "trecho_artigo": "...", "correcao": "..."}}]}}"""
    r = gerar("conferencia", SISTEMA_REVISOR, [{"role": "user", "content": pedido}], esforco="medium", pesado=True,
              max_tokens=8000, esquema=ESQUEMA_REVISAO, simulado=lambda _m: {"problemas": []})
    return [p for p in (r.get("problemas") or []) if isinstance(p, dict) and p.get("afirmacao")][:20]


def resumo_conferencia(numeros, problemas, corrigidos, rodadas):
    graves = [p for p in problemas if p.get("gravidade") == "alta"]
    return {
        "status": "conferida" if not problemas else ("ressalvas_graves" if graves else "ressalvas"),
        "numeros": {"total": numeros["total"], "confirmados": numeros["confirmados"]},
        "problemas": [{k: str(p.get(k, ""))[:400] for k in ("onde", "afirmacao", "gravidade", "trecho_artigo", "correcao")}
                      for p in problemas],
        "corrigidos": corrigidos, "rodadas": rodadas, "data": datetime.now().isoformat(timespec="seconds"),
    }
