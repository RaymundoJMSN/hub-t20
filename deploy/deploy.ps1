# deploy/deploy.ps1 — sobe o hub pro devilsworks e reinicia.
# Primeira vez no servidor (uma vez só):
#   ssh devilsworks 'sudo cp /home/ubuntu/hub-t20/deploy/hub-t20.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now hub-t20'
#   nginx: proxy_pass http://127.0.0.1:8100 no vhost (hoje magias.raynathus.com.br); certbot --nginx -d <dominio>
#   contas: ssh devilsworks 'cd /home/ubuntu/hub-t20 && node server.mjs --usuario "Nome" senha mestre'
#   busca por sentido: docker run -d --name ollama --restart unless-stopped -p 127.0.0.1:11434:11434 -v ollama:/root/.ollama -e OLLAMA_KEEP_ALIVE=24h ollama/ollama
#                      docker exec ollama ollama pull bge-m3
# O que NÃO sobe: dados/estado.json (magias dos usuários), dados/usuarios.json, dados/agenda.json, dados/missoes.json,
# dados/links.json, dados/segredo, dados/arauto-uso.json, dados/arauto-log.jsonl — são do servidor.
# Base, coleções e textos oficiais (texto da Jambo, fora do git) sobem por scp.
param(
  [switch]$Ficha,    # sobe também dados/ficha-site (build do criador de ficha, 25 MB — só quando ele mudar)
  [switch]$Vetores,  # sobe dados/vetores (busca por sentido + trechos dos livros do Arauto, ~140 MB — só quando tools/embutir.mjs rodar)
  [switch]$Arauto    # sobe dados/arauto.json (chave da API e token do bot; gerado por tools/configurar-arauto.py)
)
$proj = Split-Path $PSScriptRoot -Parent
$dest = 'devilsworks:/home/ubuntu/hub-t20'
if ($Ficha) {
  ssh devilsworks 'rm -rf /home/ubuntu/hub-t20/dados/ficha-site.novo'
  scp -q -r (Join-Path $proj 'dados/ficha-site') "$dest/dados/ficha-site.novo"
  ssh devilsworks 'rm -rf /home/ubuntu/hub-t20/dados/ficha-site && mv /home/ubuntu/hub-t20/dados/ficha-site.novo /home/ubuntu/hub-t20/dados/ficha-site'
}
ssh devilsworks 'mkdir -p /home/ubuntu/hub-t20/static /home/ubuntu/hub-t20/lib /home/ubuntu/hub-t20/data /home/ubuntu/hub-t20/deploy /home/ubuntu/hub-t20/dados/colecoes /home/ubuntu/hub-t20/dados/vetores'
scp (Join-Path $proj 'server.mjs') "$dest/"
scp -r (Join-Path $proj 'static') "$dest/"
scp -r (Join-Path $proj 'lib') "$dest/"
scp -r (Join-Path $proj 'data') "$dest/"
scp (Join-Path $proj 'deploy/hub-t20.service') (Join-Path $proj 'deploy/instalar-servidor.sh') "$dest/deploy/"
scp -r (Join-Path $proj 'tools') "$dest/"
# poderes.json + base.json = a base de conhecimento (tools/construir-base.mjs); arauto-primer.md = o mapa do sistema que o Arauto lê
foreach ($f in 'dados/textos.json', 'dados/aprimoramentos.json', 'dados/poderes.json', 'dados/base.json', 'dados/arauto-primer.md', 'dados/ameacas-regras.json') {
  if (Test-Path (Join-Path $proj $f)) { scp (Join-Path $proj $f) "$dest/dados/" }
}
scp (Join-Path $proj 'dados/colecoes/*.json') "$dest/dados/colecoes/"
if ($Vetores) { scp (Join-Path $proj 'dados/vetores/*') "$dest/dados/vetores/" }
if ($Arauto) {
  scp (Join-Path $proj 'dados/arauto.json') "$dest/dados/"
  ssh devilsworks 'chmod 600 /home/ubuntu/hub-t20/dados/arauto.json'
}
ssh devilsworks 'sudo systemctl restart hub-t20 && sleep 2 && curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8100/login && journalctl -u hub-t20 -n 3 --no-pager -o cat'
