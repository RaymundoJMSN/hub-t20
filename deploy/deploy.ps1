# deploy/deploy.ps1 — sobe o hub pro devilsworks e reinicia.
# Primeira vez no servidor (uma vez só):
#   ssh devilsworks 'sudo cp /home/ubuntu/hub-t20/deploy/hub-t20.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now hub-t20'
#   nginx: proxy_pass http://127.0.0.1:8100 no vhost (hoje magias.raynathus.com.br); certbot --nginx -d <dominio>
#   contas: ssh devilsworks 'cd /home/ubuntu/hub-t20 && node server.mjs --usuario "Nome" senha mestre'
# O que NÃO sobe: dados/estado.json (magias dos usuários), dados/usuarios.json, dados/agenda.json, dados/missoes.json,
# dados/links.json, dados/segredo — são do servidor. Coleções e textos oficiais (texto da Jambo, fora do git) sobem por scp.
param([switch]$Ficha)  # -Ficha: sobe também dados/ficha-site (build do criador de ficha, 25 MB — só quando ele mudar)
$proj = Split-Path $PSScriptRoot -Parent
if ($Ficha) {
  ssh devilsworks 'rm -rf /home/ubuntu/hub-t20/dados/ficha-site.novo'
  scp -q -r (Join-Path $proj 'dados/ficha-site') devilsworks:/home/ubuntu/hub-t20/dados/ficha-site.novo
  ssh devilsworks 'rm -rf /home/ubuntu/hub-t20/dados/ficha-site && mv /home/ubuntu/hub-t20/dados/ficha-site.novo /home/ubuntu/hub-t20/dados/ficha-site'
}
ssh devilsworks 'mkdir -p /home/ubuntu/hub-t20/static /home/ubuntu/hub-t20/data /home/ubuntu/hub-t20/deploy /home/ubuntu/hub-t20/dados/colecoes'
scp (Join-Path $proj 'server.mjs') devilsworks:/home/ubuntu/hub-t20/
scp -r (Join-Path $proj 'static') devilsworks:/home/ubuntu/hub-t20/
scp -r (Join-Path $proj 'data') devilsworks:/home/ubuntu/hub-t20/
scp (Join-Path $proj 'deploy/hub-t20.service') (Join-Path $proj 'deploy/instalar-servidor.sh') devilsworks:/home/ubuntu/hub-t20/deploy/
scp -r (Join-Path $proj 'tools') devilsworks:/home/ubuntu/hub-t20/
foreach ($f in 'dados/textos.json', 'dados/aprimoramentos.json', 'dados/poderes.json') {
  if (Test-Path (Join-Path $proj $f)) { scp (Join-Path $proj $f) devilsworks:/home/ubuntu/hub-t20/dados/ }
}
scp (Join-Path $proj 'dados/colecoes/*.json') devilsworks:/home/ubuntu/hub-t20/dados/colecoes/
ssh devilsworks 'sudo systemctl restart hub-t20 && sleep 1 && curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8100/login'
