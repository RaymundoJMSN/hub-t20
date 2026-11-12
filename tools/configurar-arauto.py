"""
tools/configurar-arauto.py — cria/atualiza dados/arauto.json (configuração do Arauto do hub) a partir do
arauto-config.toml do bot do Papinho, pra a MESMA chave da API servir ao site e ao chat. Nunca imprime a chave.

  python tools/configurar-arauto.py                 usa o caminho padrão do projeto do Papinho
  python tools/configurar-arauto.py <arauto-config.toml>

Gera também o token do bot (botToken) se ainda não existir e o grava nos dois lados:
dados/arauto.json (o hub confere) e [hub] no arauto-config.toml (o bot envia).
"""
import json, secrets, sys, tomllib, re, io, os

AQUI = os.path.dirname(os.path.abspath(__file__))
SAIDA = os.path.join(AQUI, "..", "dados", "arauto.json")
TOML = sys.argv[1] if len(sys.argv) > 1 else r"E:\rayna\Documents\Claude\Projects\Element Self-Host\stack\arauto\arauto-config.toml"
URL_HUB = "https://rpg.raynathus.com.br"

with open(TOML, "rb") as f:
    cfg = tomllib.load(f)
chave = (cfg.get("llm") or {}).get("api_key") or ""
if not chave.startswith("sk-ant-"):
    sys.exit("arauto-config.toml sem [llm] api_key da Anthropic")

try:
    atual = json.load(open(SAIDA, encoding="utf-8"))
except Exception:
    atual = {}
token = atual.get("botToken") or (cfg.get("hub") or {}).get("token") or secrets.token_urlsafe(32)
novo = {"modelo": "claude-haiku-5-5", "esforco": "medium", "limiteDia": 80, "limiteDiaBot": 300, **atual, "chave": chave, "botToken": token}
json.dump(novo, open(SAIDA, "w", encoding="utf-8"), indent=1)

# [hub] no toml do bot: acrescenta a seção se faltar (sem reescrever o resto do arquivo, que tem comentários)
txt = io.open(TOML, encoding="utf-8").read()
if not re.search(r"^\[hub\]", txt, re.M):
    txt = txt.rstrip("\n") + f'\n\n# cérebro do Arauto no hub (rpg.raynathus.com.br): o bot pergunta lá e só cai no RAG local se o hub não responder\n[hub]\nurl = "{URL_HUB}"\ntoken = "{token}"\ntimeout = 150\n'
    io.open(TOML, "w", encoding="utf-8", newline="\n").write(txt)
    print("seção [hub] acrescentada ao arauto-config.toml")
print(f"dados/arauto.json gravado: modelo {novo['modelo']}, chave de {len(chave)} caracteres, token do bot de {len(token)} caracteres (valores não exibidos)")
