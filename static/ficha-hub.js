// ficha-hub.js — cola do hub no criador de ficha (o servidor injeta antes do script do site).
// A pergunta "ficha em andamento, retomar?" vinha num confirm() nativo do navegador; aqui vira um popup do site.
// Só essa pergunta (ela passa por um `await` no site); os outros confirm continuam nativos, que são síncronos.
(function () {
  const nativo = window.confirm.bind(window);
  window.confirm = function (msg) {
    if (!/ficha em andamento/i.test(String(msg))) return nativo(msg);
    return new Promise(function (resolver) {
      const dlg = document.createElement("dialog");
      dlg.className = "hub-confirm";
      dlg.innerHTML = '<h3>Ficha em andamento</h3><p>Você tem uma ficha começada. Quer retomar de onde parou ou começar do zero?</p>'
        + '<div class="hub-confirm-acoes"><button type="button" class="zero">Começar do zero</button><button type="button" class="retomar">Retomar</button></div>';
      dlg.querySelector(".retomar").onclick = function () { dlg.close(); resolver(true); };
      dlg.querySelector(".zero").onclick = function () { dlg.close(); resolver(false); };
      dlg.addEventListener("cancel", function (e) { e.preventDefault(); });
      dlg.addEventListener("close", function () { dlg.remove(); });
      document.body.appendChild(dlg);
      dlg.showModal();
    });
  };
})();
