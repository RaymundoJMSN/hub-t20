# -*- coding: utf-8 -*-
"""Reconstroi as magias oficiais de 1o circulo com data/tabela-custos.json.

Dois segmentos:
- numericas (dano/cura/bonus/condicao): a tabela precifica o efeito ->
  meta: mediana ~= orcamento (10), grosso 8-12. Teste de regressao da tabela.
- utilitarias: o preco do efeito DERIVA (orcamento - eixos) -> vira a galeria
  de exemplos precificados do app (tools/exemplos.py).

Uso: python tools/calibrar.py [--csv]
"""
import json
import pathlib
import statistics
import sys

BASE = pathlib.Path(__file__).resolve().parents[1]
DATASET = BASE.parents[0] / "magias-t20" / "dataset.json"
TABELA = json.loads((BASE / "data" / "tabela-custos.json").read_text(encoding="utf-8"))


def custo_area(alvo, t):
    forma, tam = alvo.get("forma"), alvo.get("tamanho_m", 0)
    if tam <= t["areas"]["p_max_m"].get(forma, 3):
        return t["eixos"]["alvo"]["area_p"]
    if tam <= t["areas"]["m_max_m"].get(forma, 6):
        return t["eixos"]["alvo"]["area_m"]
    return t["eixos"]["alvo"]["area_g"]


def custo_dados(dados, tabela_dado, fixo_por_ponto):
    n, resto = dados.split("d")
    faces, _, mais = resto.partition("+")
    return int(n) * tabela_dado[faces] + int(mais or 0) * fixo_por_ponto


def reconstruir(m, t=TABELA):
    """Custo em pontos da magia oficial 'm' (item do dataset). Retorna (total, partes)."""
    e = t["eixos"]
    partes = {}
    partes["execucao"] = e["execucao"].get(m["execucao"]["cat"], 0)
    partes["alcance"] = e["alcance"].get(m["alcance"]["cat"], 0)
    partes["duracao"] = e["duracao"].get(m["duracao"]["cat"], 0)

    alvo = m["alvo"]
    if alvo["tipo"] == "pessoal":
        partes["alvo"] = e["alvo"]["pessoal"]
    elif alvo["tipo"] == "area":
        partes["alvo"] = custo_area(alvo, t)
    elif alvo["tipo"] == "alvos":
        q = alvo.get("qtd", 1)
        if q == "escolhidas":
            partes["alvo"] = e["alvo"]["escolhidas"]
        else:
            partes["alvo"] = e["alvo"]["1alvo"] + (int(q) - 1) * e["alvo"]["alvo_extra"]
        if alvo.get("restrito"):
            partes["alvo"] += e["alvo"].get("restrito", -1)
    else:
        partes["alvo"] = 0

    ofensiva = ("dano" in m) or (m["resistencia"]["modo"] != "nenhuma")
    partes["resistencia"] = e["resistencia"].get(m["resistencia"]["modo"], 0) if ofensiva else 0

    ef = t["efeitos"]
    if "dano" in m:
        partes["dano"] = custo_dados(m["dano"]["dados"], ef["dano_por_dado"],
                                     ef["dano_fixo_por_ponto"])
        if m["duracao"]["cat"] in ("sustentada", "cena", "1dia", "permanente"):
            partes["dano"] *= ef.get("dano_repetivel_mult", 1.5)
        # blast puro: circulo desconta dados (Bola de Fogo)
        puro = ("cura" not in m and "modificador" not in m and not m.get("condicoes")
                and m["duracao"]["cat"] == "instantanea")
        n_bonus = int(ef.get("dano_puro_bonus_dados", {}).get(str(m["circulo"]), 0))
        if puro and n_bonus:
            nd, resto = m["dano"]["dados"].split("d")
            preco = ef["dano_por_dado"][resto.partition("+")[0]]
            partes["dano"] -= min(min(int(nd), n_bonus) * preco, partes["dano"] / 2)
        partes["dano"] += ef.get("custo_tipo_dano", {}).get(m["dano"].get("tipo") or "", 0)
    if "cura" in m:
        c = custo_dados(m["cura"]["dados"], ef["cura_por_dado"], ef["cura_fixa_por_ponto"])
        if "dano" in partes:  # dano OU cura (Infligir Ferimentos): modos alternativos
            partes["dano"] = max(partes["dano"], c)
        else:
            partes["cura"] = c
    if "modificador" in m:
        esc = ef["bonus_escalonado"]
        v = min(abs(m["modificador"]["valor"]), len(esc)) - 1
        partes["bonus"] = esc[v]

    tiers_map = {c: int(tier) for tier, cs in ef["condicoes_tier"].items() for c in cs}
    conds = m.get("condicoes", [])
    if conds:
        ts = sorted((tiers_map.get(c, 1) for c in conds), reverse=True)
        custo_tier = lambda tr: ef["condicao_custo_por_tier"][str(tr)]
        custo = custo_tier(ts[0]) + sum(custo_tier(tr) / 2 for tr in ts[1:])
        if "dano" in m:  # rider de dano ("atordoado na falha"): metade
            custo *= ef.get("condicao_rider_dano_mult", 0.5)
        partes["condicao"] = custo

    # sem efeito numerico detectado = utilitario
    if not any(k in partes for k in ("dano", "cura", "bonus", "condicao")):
        partes["utilitario"] = ef["utilitario_base"]

    return sum(partes.values()), partes


def eh_numerica(m):
    # condicao so conta se ha resistencia (= debuff de verdade); buff com mencao
    # incidental de condicao (Armadura Gelida) cai no segmento utilitario/derivado
    return any(k in m for k in ("dano", "cura", "modificador")) or (
        m.get("condicoes") and m["resistencia"]["modo"] != "nenhuma")


def resumo(nome, custos):
    med = statistics.median(custos)
    dentro = sum(1 for c in custos if 8 <= c <= 12)
    print(f"[{nome}] n={len(custos)} mediana={med} media={statistics.mean(custos):.1f} "
          f"dp={statistics.stdev(custos):.1f} 8-12: {100 * dentro // len(custos)}%")
    hist = {}
    for c in custos:
        hist[round(c)] = hist.get(round(c), 0) + 1
    for v in sorted(hist):
        print(f"  {v:3d} | {'#' * hist[v]}")
    return med


def main():
    ds = json.loads(DATASET.read_text(encoding="utf-8"))
    for circ in range(2, 6):
        ms = [m for m in ds["magias"] if m["circulo"] == circ]
        nums = [reconstruir(m)[0] for m in ms if eh_numerica(m)]
        alvo = TABELA["orcamento"][str(circ)]
        dentro = sum(1 for c in nums if alvo - 3 <= c <= alvo + 3)
        print(f"[{circ}o] orcamento={alvo} numericas n={len(nums)} mediana={statistics.median(nums):.1f} "
              f"na faixa +-3: {100 * dentro // max(1, len(nums))}%")
    c1 = [m for m in ds["magias"] if m["circulo"] == 1]
    orc = TABELA["orcamento"]["1"]

    num = sorted(((reconstruir(m)[0], m) for m in c1 if eh_numerica(m)), key=lambda x: x[0])
    med = resumo("numericas", [c for c, _ in num])

    uti = []
    for m in c1:
        if not eh_numerica(m):
            total, partes = reconstruir(m)
            eixos = total - partes.get("utilitario", 0)
            uti.append((orc - eixos, m))
    uti.sort(key=lambda x: x[0])
    resumo("utilitarias (preco derivado do efeito)", [c for c, _ in uti])

    if "--csv" in sys.argv:
        for c, m in num:
            print(f"{c:5.1f}  {m['nome'][:28]:28s} {reconstruir(m)[1]}")
    else:
        print("\n-- numericas extremas --")
        for c, m in num[:5] + num[-5:]:
            print(f"  {c:5.1f}  {m['nome']}")
        print("-- efeitos utilitarios mais caros (derivado) --")
        for c, m in uti[-5:]:
            print(f"  {c:5.1f}  {m['nome']}")
    return med, [c for c, _ in num]


if __name__ == "__main__":
    med, custos = main()
