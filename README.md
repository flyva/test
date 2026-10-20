# Statistiques IVAO

Page web : on tape un VID, on obtient ses heures de contrôle par terrain et par position
(Tour, Sol, Approche...). Les données viennent de l'API publique v2 d'IVAO
(`https://api.ivao.aero/docs`).

## Architecture

- **`index.html` / `style.css` / `app.js`** : la page, statique, hébergée sur GitHub Pages.
- **`worker/`** : un petit relais (Cloudflare Worker) qui garde la clé d'API IVAO cachée côté
  serveur et interroge IVAO à la place du navigateur. La page ne contient jamais la clé.

On a besoin des deux parce que GitHub Pages ne sert que des fichiers statiques : il ne peut
pas garder un secret. Le Worker, lui, le peut, et c'est gratuit pour cet usage.

## 1. Créer la clé d'API IVAO

1. Va sur https://developers.ivao.aero/ et connecte-toi avec ton compte IVAO.
2. Crée une application, type **Third Party (Members) App**.
3. Dans les réglages de l'application, clique sur **Reset API Key** pour générer une clé.
   Copie-la immédiatement : elle ne sera affichée qu'une fois (tu peux la réafficher plus
   tard depuis le site, mais autant la garder de côté).

## 2. Déployer le Worker (Cloudflare)

Il faut `node` et `npm` (déjà présents sur cette machine).

```bash
cd worker
npm install -g wrangler        # une seule fois
wrangler login                 # ouvre le navigateur, connecte-toi (compte Cloudflare gratuit)
wrangler secret put IVAO_API_KEY   # colle la clé IVAO quand on te la demande
wrangler deploy
```

La dernière commande affiche une URL du genre :

```
https://ivao-stats-proxy.<ton-sous-domaine>.workers.dev
```

Garde cette URL, elle sert à l'étape suivante.

## 3. Relier la page au Worker

Ouvre `app.js` et remplace la première ligne par ta vraie URL :

```js
const API_BASE = 'https://ivao-stats-proxy.<ton-sous-domaine>.workers.dev';
```

## 4. Mettre en ligne sur GitHub Pages

```bash
git init
git add .
git commit -m "Statistiques IVAO"
git branch -M main
git remote add origin https://github.com/<ton-compte>/ivao-stats.git
git push -u origin main
```

Puis sur GitHub : **Settings → Pages → Source : Deploy from a branch → `main` / `/ (root)`**.
La page est en ligne quelques minutes après, à `https://<ton-compte>.github.io/ivao-stats/`.

## Limites connues

- Les positions dont l'indicatif ne commence pas par un code OACI à 4 lettres (ex. un
  centre en route nommé `BORDEAUX_CTR`) sont listées à part, dans « Centres / FIR », plutôt
  que rattachées à un terrain.
- Les réponses sont mises en cache 10 minutes côté Worker (`CACHE_TTL` dans `worker.js`),
  pour ne pas solliciter l'API IVAO à chaque clic sur un VID déjà consulté.
- Non testé avec une vraie clé d'API pour l'instant : le comportement exact (limite de
  débit, VID très anciens ou jamais connectés) sera à vérifier au premier essai réel.
