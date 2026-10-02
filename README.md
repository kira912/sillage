# Sillage

PWA de prise de notes et d'agenda, pensée pour le téléphone, qui fonctionne hors ligne.

## Fonctionnalités

- **Aujourd'hui** : écran d'accueil avec ce qui est en retard, la journée, les 7 prochains jours et les notes épinglées
- **Notes** : titre, texte, étiquettes, couleur, épinglage, recherche insensible aux accents, filtre par étiquette
- **Listes à cocher** (`- [ ] …`) cochables depuis la liste, avec la progression (3/5), « Tout décocher » et « Retirer les cochés »
- **Agenda** mensuel (glisser pour changer de mois), une note datée y apparaît avec heure et lieu
- **Récurrences** : tous les N jours, semaines (choix des jours), mois ou ans, avec une date de fin ; « fait » coché par occurrence
- **Rappels** via le Calendrier de l'iPhone (export `.ics` avec alerte et récurrence)
- Lieu avec ouverture dans Plans
- Suppression en glissant une note vers la gauche, depuis n'importe quelle liste
- Corbeille (30 jours) avec « Annuler » juste après la suppression, et duplication de note
- Sauvegarde JSON (feuille de partage, donc Fichiers / iCloud Drive), restauration, import par copier-coller depuis l'app Notes
- PWA installable, hors ligne, mode sombre, zones sûres de l'iPhone, bouton retour fermant l'éditeur

## Stack

Vite + React + TypeScript, Dexie (IndexedDB) pour le stockage local, vite-plugin-pwa (Workbox), date-fns, lucide-react.

Les données restent **sur l'appareil**. Pensez à exporter régulièrement tant qu'il n'y a pas de synchro.

## Développement

Gestionnaire de paquets : **pnpm** (version fixée dans `package.json`).

```sh
pnpm install
pnpm dev        # http://localhost:5173 et http://<ip-du-pc>:5173 depuis le téléphone (même Wi-Fi)
pnpm build && pnpm preview   # tester le service worker / le hors ligne
```

En `http://` sur le téléphone, l'installation sur l'écran d'accueil et le hors ligne sont désactivés.
Pour les tester sans déployer : `npx cloudflared tunnel --url http://localhost:5173`.

## Déploiement (Vercel)

La configuration est dans `vercel.json` : build pnpm, sortie `dist/`, en-têtes de cache
(service worker et `index.html` toujours revalidés, `/assets` en cache 1 an), en-têtes de sécurité
(CSP stricte, aucune ressource externe) et `noindex`.

**Via GitHub** (recommandé, chaque push redéploie) :
1. Pousser le dépôt sur GitHub.
2. Sur vercel.com : *Add New → Project*, importer le dépôt. Vite et pnpm sont détectés, rien à régler.

**Via la CLI** :
```sh
pnpm dlx vercel        # préproduction
pnpm dlx vercel --prod # production
```

Ensuite, sur l'iPhone : ouvrir l'URL dans Safari → Partager → « Sur l'écran d'accueil ».
Les mises à jour s'installent toutes seules à la réouverture de l'app.

> Les données vivent dans le navigateur, liées au **domaine**. Si l'URL change (autre projet Vercel,
> domaine perso ajouté plus tard), exporter une sauvegarde depuis l'ancienne URL et la restaurer sur la nouvelle.
