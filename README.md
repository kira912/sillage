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
- **Saisie rapide par IA** : une phrase tapée ou dictée (« pédiatre jeudi 14h30, rappelle-moi ») devient une ou
  plusieurs notes datées, récurrentes ou en liste, avec un aperçu avant ajout (Claude, via une fonction serveur)
- **Notifications push** de rappel (iPhone : app installée sur l'écran d'accueil, iOS 16.4+)
- **Espace partagé** : on rejoint une fois un espace commun (code d'invitation) ; chaque note est personnelle ou
  partagée, et des étiquettes (#courses, #famille…) partagent automatiquement. Synchronisation automatique,
  **chiffrée de bout en bout** (le serveur ne peut pas lire les notes partagées)

## Stack

Vite + React + TypeScript, Dexie (IndexedDB) pour le stockage local, vite-plugin-pwa (Workbox), date-fns, lucide-react.
Côté serveur (fonctions Vercel dans `api/`) : SDK Anthropic, web-push, Upstash Redis.

Les données restent **sur l'appareil**. Pensez à exporter régulièrement tant qu'il n'y a pas de synchro.

## Développement

Gestionnaire de paquets : **pnpm** (version fixée dans `package.json`).

```sh
pnpm install
pnpm dev        # http://localhost:5173 et http://<ip-du-pc>:5173 depuis le téléphone (même Wi-Fi)
pnpm build && pnpm preview   # tester le service worker / le hors ligne
pnpm test       # tests (Vitest)
```

Les tests des scripts Lua (Redis) et de la synchronisation sur Redis demandent un vrai Redis, exposé avec
l'API REST d'Upstash par le proxy [SRH](https://github.com/hiett/serverless-redis-http) ; sans lui, ils sont ignorés
(la synchronisation est alors testée avec le stockage en mémoire) :

```sh
redis-server --port 6390 --save '' --daemonize yes
docker run -d --rm --name srh --network host -e SRH_MODE=env -e SRH_TOKEN=test \
  -e SRH_CONNECTION_STRING=redis://127.0.0.1:6390 -e SRH_PORT=8079 hiett/serverless-redis-http
SILLAGE_TEST_REDIS_URL=http://127.0.0.1:8079 SILLAGE_TEST_REDIS_TOKEN=test pnpm test
```

Les fonctions de `api/` tournent aussi en local (dev et preview), avec les variables de `.env.local`
(voir `.env.example`). Sans Redis configuré, les rappels sont stockés en mémoire.

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

### Saisie IA et notifications : configuration

Variables d'environnement à définir dans Vercel → *Settings → Environment Variables* (détail dans `.env.example`) :

| Variable | Rôle |
| --- | --- |
| `SILLAGE_ACCESS_CODE` | Code partagé, saisi une fois dans Réglages sur chaque téléphone. Protège l'IA et les rappels (pas l'espace partagé). Choisir un code long et aléatoire (20 caractères ou plus) : après 10 essais erronés, une adresse IP est bloquée 15 min. |
| `ANTHROPIC_API_KEY` | Clé API pour la saisie rapide. `SILLAGE_MODEL` (optionnel) change de modèle. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Clés des notifications : `pnpm dlx web-push generate-vapid-keys`. Ne plus les changer ensuite (sinon réabonnement). |
| `CRON_SECRET` | Secret du déclencheur d'envoi des rappels. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Redis : posées automatiquement en ajoutant l'intégration **Upstash Redis** (Vercel → *Storage*). |

**Envoi des rappels chaque minute** : `GET /api/cron` avec l'en-tête `Authorization: Bearer <CRON_SECRET>`.
Le plan Hobby de Vercel limite ses crons à un par jour, donc :
- plan Hobby : créer une tâche gratuite sur [cron-job.org](https://cron-job.org) (toutes les minutes, URL
  `https://<votre-app>/api/cron`, en-tête `Authorization` ci-dessus) ;
- plan Pro : ajouter `"crons": [{ "path": "/api/cron", "schedule": "* * * * *" }]` dans `vercel.json`
  (Vercel envoie alors lui-même `CRON_SECRET`).

Sur l'iPhone : installer l'app sur l'écran d'accueil, puis Réglages → code d'accès → Notifications → Activer.
Une notification de test confirme que tout fonctionne. Les rappels sont planifiés sur 60 jours glissants et
recalculés à chaque ouverture de l'app. Réglages → « Envoi des rappels » indique si le cron tourne
(« Arrêté » s'il n'est pas passé depuis 10 minutes).

La saisie IA est plafonnée à 30 analyses par heure et par adresse IP, et 500 par jour au total.

**Données transmises** : le texte saisi dans la saisie rapide (pour analyse), et pour les notes avec rappel :
titre, date/heure et lieu. Les notes partagées transitent chiffrées (AES-GCM, clé dérivée du code d'invitation,
jamais envoyée au serveur). Les notes personnelles ne quittent pas le téléphone.

### Espace partagé

Réglages → Partage → *Créer un espace partagé*, puis *Inviter quelqu'un* : l'autre personne colle le code reçu
(par Messages…) dans Réglages → Partage → *Rejoindre*. Pas besoin du code d'accès : chacun peut créer son propre
espace avec les personnes de son choix, et chaque espace est isolé (seul le code d'invitation y donne accès).
Sur iPhone, un lien n'ouvre pas l'app installée : c'est pour ça que l'invitation passe par un code à coller.

- Synchronisation : après chaque modification, toutes les 20 s quand l'app est ouverte, au retour dans l'app.
- Conflit (même note modifiée des deux côtés avant synchronisation) : les deux versions sont fusionnées. Chaque
  champ modifié d'un seul côté est conservé, et le texte est fusionné ligne par ligne (deux personnes qui cochent
  des articles différents d'une liste gardent toutes leurs cases). Si le même passage a été réécrit des deux
  côtés, la version arrivée en premier sur le serveur l'emporte et l'autre est gardée en note personnelle
  « (version en conflit) ».
- Repasser une note en « Perso » la retire de chez les autres (elle part dans leur corbeille).
- Le chiffrement utilise WebCrypto : il faut HTTPS (ou `localhost`) ; en `http://<ip>` le partage est indisponible.
- Redis est nécessaire en production (même intégration Upstash que pour les rappels).
- Contre les abus : 600 appels par 10 min et 5 créations d'espace par heure et par adresse IP, 200 créations par jour
  au total, 30 membres, 5 000 notes et 20 Mo de notes (chiffrées) par espace. Les notes supprimées ne comptent pas,
  et un membre absent depuis 90 jours libère sa place quand l'espace est complet.
- Une note de plus de 45 Ko environ ne peut pas être partagée : elle reste sur le téléphone et les réglages le signalent.
- Un espace dont personne ne se sert pendant un an est supprimé automatiquement ; il l'est aussi quand le dernier
  membre le quitte.

