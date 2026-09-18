# -*- coding: utf-8 -*-
"""Minera magias-t20.json -> dataset.json estruturado e permanente.

O dataset e O artefato reutilizavel: toda analise futura (tarifas, calibracao,
circulos novos, revisoes) le ele, nunca re-extrai do site. Legivel por maquina:
todo campo bruto vira categoria + numeros; texto original preservado junto.

Uso: python tools/minerar.py   (le ../magias-t20/magias-t20.json, escreve dataset.json la)
"""
import hashlib
import json
import pathlib
import re
import sys
import unicodedata

FONTE = pathlib.Path(__file__).resolve().parents[2] / "magias-t20" / "magias-t20.json"
SAIDA = FONTE.with_name("dataset.json")

VERSAO = 2


def sem_acento(s):
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()


def norm(s):
    return sem_acento((s or "").strip().lower()).rstrip(".;").strip()


def slug(nome):
    return re.sub(r"[^a-z0-9]+", "-", sem_acento(nome.lower())).strip("-")


# ---------------------------------------------------------------- classificadores

EXECUCAO = {  # bruto normalizado -> categoria
    "padrao": "padrao", "acao padrao": "padrao", "completa": "completa",
    "movimento": "movimento", "reacao": "reacao", "livre": "livre",
}


def cat_execucao(v):
    n = norm(v)
    if n in EXECUCAO:
        return EXECUCAO[n]
    if "rodada" in n or "hora" in n or "minuto" in n:
        return "longa"  # ritual: mais de 1 rodada
    return "outro"


ALCANCES = ["pessoal", "toque", "curto", "medio", "longo", "ilimitado"]


def cat_alcance(v):
    n = norm(v)
    for a in ALCANCES:
        if n.startswith(a):
            return a
    return "outro"


def cat_duracao(v):
    n = norm(v)
    if n.startswith("instantanea"):
        return "instantanea"
    if n.startswith("sustentada"):
        return "sustentada"
    if n.startswith("cena"):
        return "cena"
    if n.startswith("permanente"):
        return "permanente"
    if re.match(r"^1 (rodada|turno)", n):
        return "1rodada"
    if "dia" in n:
        return "1dia"
    return "outro"


def cat_resistencia(v):
    n = norm(v)
    if not n or n == "nenhuma":
        return {"teste": None, "modo": "nenhuma"}
    teste = next((t for t in ("fortitude", "reflexos", "vontade") if t in n), "especial")
    for modo in ("anula", "parcial", "reduz a metade", "desacredita"):
        if modo in n:
            return {"teste": teste, "modo": modo.replace(" a ", "-")}
    return {"teste": teste, "modo": "especial"}


RE_AREA = re.compile(
    r"(esfera|cone|linha|cilindro|nuvem|quadrado|cubo)\s*(?:com|de)?\s*(\d+)m")
RE_NALVOS = re.compile(r"^(?:ate\s+)?(\d+)\s")


RESTRITOS = ["humanoide", "animal", "objeto", "arma", "planta", "morto-vivo",
             "construto", "espirito", "monstro"]


def restricao_alvo(n):
    """'1 humanoide' e mais barato que '1 criatura' — detecta o tipo restrito."""
    if "criatura" in n:
        return None
    achados = [r for r in RESTRITOS if r in n]
    return " ou ".join(achados) if achados else None


def cat_alvo(v):
    n = norm(v)
    m = RE_AREA.search(n)
    if m:
        return {"tipo": "area", "forma": m.group(1), "tamanho_m": int(m.group(2))}
    if n == "voce":
        return {"tipo": "pessoal"}
    if "criaturas escolhidas" in n or n == "aliados":
        return {"tipo": "alvos", "qtd": "escolhidas"}
    r = restricao_alvo(n)
    extra = {"restrito": r} if r else {}
    m = RE_NALVOS.match(n)
    if m:
        return {"tipo": "alvos", "qtd": int(m.group(1)), **extra}
    if n.startswith(("1 ", "arma ", "alimento")):
        return {"tipo": "alvos", "qtd": 1, **extra}
    return {"tipo": "outro"}


RE_DADOS = re.compile(r"(\d+)d(\d+)(?:\s*\+\s*(\d+))?")
TIPOS_DANO = ["fogo", "frio", "eletricidade", "acido", "trevas", "luz", "essencia",
              "corte", "impacto", "perfuracao", "psiquico", "veneno"]
# condicoes canonicas T20 (as que aparecem em magias)
CONDICOES = ["abalado", "agarrado", "apavorado", "atordoado", "caido", "cego",
             "confuso", "debilitado", "desprevenido", "em chamas", "enjoado",
             "enredado", "esmorecido", "exausto", "fascinado", "fatigado",
             "fraco", "frustrado", "imovel", "inconsciente", "indefeso", "lento",
             "ofuscado", "paralisado", "pasmo", "petrificado", "sangrando",
             "surdo", "vulneravel", "alquebrado", "doente", "envenenado",
             "enfeiticado", "sobrecarregado", "surpreendido"]


def dados_str(m):
    return f"{m.group(1)}d{m.group(2)}" + (f"+{m.group(3)}" if m.group(3) else "")


def media_dados(s):
    m = RE_DADOS.fullmatch(s.replace(" ", ""))
    n, faces, mais = int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)
    return n * (faces + 1) / 2 + mais


def minerar_descricao(desc):
    n = norm(desc)
    out = {}
    m = re.search(r"(?:causa|causando|sofre|sofrendo)[^.]{0,80}?(\d+d\d+(?:\+\d+)?)"
                  r"(?:\s*pontos)?\s*(?:de\s+)?dano(?:\s+de\s+(\w+))?", n)
    if m:
        out["dano"] = {"dados": m.group(1), "media": media_dados(m.group(1)),
                       "tipo": m.group(2) if m.group(2) in TIPOS_DANO else None}
    m = re.search(r"(?:recupera|cura)[^.]{0,40}?(\d+d\d+(?:\+\d+)?)\s*(?:pontos de vida|pv)", n)
    if m:
        out["cura"] = {"dados": m.group(1), "media": media_dados(m.group(1))}
    # so conta a condicao que a magia IMPOE: frase que remove/da imunidade nao vale
    # (Sopro da Salvacao lista 19 condicoes que ela CURA)
    nega = re.compile(r"\b(imune|imunes|imunidade|remov\w*|encerra|livra|protegid\w*|dissipa)\b")
    conds = []
    for c in CONDICOES:
        rx = re.compile(r"\b" + c.replace(" ", r"\s") + r"[ao]?s?\b")
        if any(rx.search(f) and not nega.search(f) for f in re.split(r"[.;]", n)):
            conds.append(c)
    if conds:
        out["condicoes"] = conds
    m = re.search(r"(?:bonus|penalidade) de ([+-]?\d+) em (\w+)", n)
    if m:
        out["modificador"] = {"valor": int(m.group(1)), "em": m.group(2)}
    return out


# ------------------------------------------------------- aprimoramentos -> deltas

RE_PM = re.compile(r"([+-]?\d+)\s*pm", re.I)


def custo_pm(bruto):
    n = norm(bruto)
    if n.startswith("truque"):
        return {"pm": 0, "truque": True}
    m = RE_PM.search(n)
    pm = int(m.group(1)) if m else None
    restrito = "apenas" in n
    return {"pm": pm, "truque": False, **({"restrito": True} if restrito else {})}


def deltas_aprimoramento(texto):
    """Classifica o efeito de um aprimoramento em deltas de maquina."""
    n = norm(texto)
    ds = []
    m = re.search(r"(?:aumenta|muda) o dano(?: inicial| adicional)?"
                  r"(?: d[aoe][s ]?\w*)* (?:em|para) \+?(\d+d\d+|\d+)", n)
    if m:
        ds.append({"tipo": "dano+", "valor": m.group(1)})
    m = re.search(r"aumenta a cura em \+?(\d+d\d+|\d+)", n)
    if m:
        ds.append({"tipo": "cura+", "valor": m.group(1)})
    m = re.search(r"(?:aumenta|muda) o numero de (?:alvos|\w+) (?:em|para) \+?(\d+)", n)
    if m:
        ds.append({"tipo": "alvos+", "valor": int(m.group(1))})
    if re.search(r"afeta todos os alvos|muda o alvo para criaturas escolhidas", n):
        ds.append({"tipo": "alvos+", "valor": "todos"})
    m = re.search(r"muda o alcance para (\w+)", n)
    if m:
        ds.append({"tipo": "alcance->", "valor": m.group(1)})
    m = re.search(r"muda a execucao para ([\w ]+?)(?:\.|,| e )", n)
    if m:
        ds.append({"tipo": "execucao->", "valor": m.group(1).strip()})
    m = re.search(r"muda a duracao para ([\w ]+?)(?:\.|,| e )", n)
    if m:
        ds.append({"tipo": "duracao->", "valor": m.group(1).strip()})
    m = re.search(r"muda a resistencia para (\w+(?: \w+)?)", n)
    if m:
        ds.append({"tipo": "resistencia->", "valor": m.group(1)})
    if re.search(r"muda a area para|muda o alvo para (uma? )?(esfera|cone|linha|cilindro|nuvem)"
                 r"|aumenta (a area|o raio|o tamanho d)", n):
        ds.append({"tipo": "area->"})
    elif re.search(r"muda o alvo para", n):
        ds.append({"tipo": "alvo->"})
    m = re.search(r"(?:aumenta|muda) (?:o|os|a) (?:bonus|penalidade|pv temporarios|cd)"
                  r"[\w ]{0,25}? (?:em|para) [+-]?(\d+)", n)
    if m:
        ds.append({"tipo": "bonus+", "valor": int(m.group(1))})
    m = re.search(r"muda o tipo d[oe]s? (?:dano|energia)", n)
    if m:
        ds.append({"tipo": "tipo-dano->"})
    if re.search(r"aumenta o circulo|como uma magia de (\d)o circulo", n):
        ds.append({"tipo": "circulo+"})
    if "em vez do normal" in n or n.startswith("em vez"):
        ds.append({"tipo": "substitui"})
    elif not ds or re.search(r"alem do normal|alem disso|tambem", n):
        ds.append({"tipo": "efeito-novo"})
    return ds


# ---------------------------------------------------------------------- pipeline


def minerar():
    bruto = FONTE.read_text(encoding="utf-8")
    magias = json.loads(bruto)
    ds = []
    for i, mg in enumerate(magias):
        item = {
            "id": i,
            "slug": slug(mg["nome"]),
            "nome": mg["nome"],
            "grupo": mg["grupo"],
            "circulo": mg["circulo"],
            "escola": mg["escola"],
            "publicacao": mg["publicacao"],
            "execucao": {"bruto": mg["execucao"], "cat": cat_execucao(mg["execucao"])},
            "alcance": {"bruto": mg["alcance"], "cat": cat_alcance(mg["alcance"])},
            "duracao": {"bruto": mg["duracao"], "cat": cat_duracao(mg["duracao"])},
            "resistencia": {"bruto": mg["resistencia"], **cat_resistencia(mg["resistencia"])},
            "alvo": {"bruto": mg["alvo"], **cat_alvo(mg["alvo"])},
            "descricao": mg["descricao"],
            **minerar_descricao(mg["descricao"]),
            "aprimoramentos": [
                {"bruto_custo": a["Custo"], **custo_pm(a["Custo"]),
                 "texto": a["descricao"], "deltas": deltas_aprimoramento(a["descricao"])}
                for a in mg["Aprimoramentos"]
            ],
        }
        ds.append(item)

    # cobertura da classificacao (quanto ficou "outro"/None = nao entendido)
    def pct(f):
        return round(100 * sum(1 for m in ds if f(m)) / len(ds), 1)

    apr = [a for m in ds for a in m["aprimoramentos"]]
    cobertura = {
        "execucao": pct(lambda m: m["execucao"]["cat"] != "outro"),
        "alcance": pct(lambda m: m["alcance"]["cat"] != "outro"),
        "duracao": pct(lambda m: m["duracao"]["cat"] != "outro"),
        "alvo": pct(lambda m: m["alvo"]["tipo"] != "outro"),
        "apr_custo_pm": round(100 * sum(1 for a in apr if a["pm"] is not None) / len(apr), 1),
        "apr_com_delta_especifico": round(
            100 * sum(1 for a in apr if any(d["tipo"] != "efeito-novo" for d in a["deltas"]))
            / len(apr), 1),
    }
    out = {
        "versao": VERSAO,
        "fonte": FONTE.name,
        "fonte_sha1": hashlib.sha1(bruto.encode()).hexdigest()[:12],
        "n_magias": len(ds),
        "n_aprimoramentos": len(apr),
        "cobertura_pct": cobertura,
        "vocabulario": {"execucao": sorted({m["execucao"]["cat"] for m in ds}),
                        "alcance": ALCANCES,
                        "duracao": sorted({m["duracao"]["cat"] for m in ds}),
                        "condicoes": CONDICOES},
        "magias": ds,
    }
    SAIDA.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(ds)} magias, {len(apr)} aprimoramentos -> {SAIDA}")
    print("cobertura:", json.dumps(cobertura, ensure_ascii=False))
    return out


if __name__ == "__main__":
    d = minerar()
    assert d["n_magias"] == 275, "fonte mudou de tamanho"
    c = d["cobertura_pct"]
    # ~41% dos aprimoramentos oficiais sao efeitos bespoke ("alem do normal...") --
    # "efeito-novo" e classificacao correta pra eles, nao falha; por isso limiar menor.
    minimos = {"apr_com_delta_especifico": 50}
    assert all(v > minimos.get(k, 80) for k, v in c.items()), "cobertura caiu: " + json.dumps(c)
    print("OK")
