# Feel Lab — prototype jouable

**Jetable.** Sert à régler le game feel et à valider la boucle lobby → course → résultat
avant de transposer dans Unity. Rien ici n'est destiné à la production.

## Lancer

```bash
npm install
npm run dev          # http://127.0.0.1:5273/
```

`?noassets` désactive les modèles Meshy et fait tourner la scène en formes procédurales —
utile pour isoler un problème d'asset.

## Contrôles

| Touche | Action |
|---|---|
| Entrée ou bouton JOUER | Lancer une course depuis le lobby |
| ZQSD / WASD / flèches | Courir |
| Espace | Sauter |
| Maj ou clic gauche | Plonger |
| A / E | Pivoter la caméra |
| R | Recommencer la course |
| Échap | Retour au lobby |
| H | Afficher les réglages |

## Assets 3D

Les `.glb` ne sont **pas versionnés** (~57 Mo). Ils se régénèrent sans reconsommer de
crédits : `tools/meshy-pipeline/state.json` conserve les identifiants de tâches Meshy et
le script re-télécharge les modèles déjà produits.

```bash
cd ../meshy-pipeline
set -a && source ../../.env && set +a
node generate.mjs                 # tous
node generate.mjs player-blob     # un seul
```

## Vérification

```bash
node sanity.mjs                   # physique en headless, sans rendu
node shoot.mjs                    # captures d'écran via Chromium headless
npm run build                     # syntaxe + imports
```

## Ce qui se transpose dans Unity

`src/tuning.js` uniquement — ces 25 constantes sont le livrable réel du prototype.
Le bouton « Copier les réglages » les exporte en JSON.
