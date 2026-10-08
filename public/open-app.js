// Page d'accueil : ce qui doit ouvrir l'app y va directement, avant tout affichage.
// - L'app installée sur l'écran d'accueil (les installations d'avant /app/ démarrent encore sur /).
// - Les liens d'invitation (#rejoindre=…) et d'onglet (#onglet=…) envoyés avant le déplacement de l'app.
;(function () {
  var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
  var hash = location.hash
  if (standalone || /^#(rejoindre|onglet)=/.test(hash)) location.replace('/app/' + hash)
})()
