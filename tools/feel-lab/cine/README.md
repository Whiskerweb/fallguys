# Cinéma — sortir des rushes vidéo du jeu

Cinq familles de plans, à monter ailleurs. Les vidéos sortent dans `shots/cine/`,
en **1920×1080, 30 images/s, h264**, une par plan.

| Script | Ce qu'il tourne | Sortie |
| --- | --- | --- |
| `cine/plan-cartes.mjs` | Une carte, vue de l'extérieur : la caméra fait le tour du terrain **en le remontant** du départ à l'arrivée. Joueur masqué. 22 s. | `carte-<epreuve>.mp4` |
| `cine/plan-persos.mjs` | Un personnage court **vers la caméra**, qui recule devant lui. Même terrain, même graine, même cadrage pour les cinq. 7 s. | `perso-<modele>.mp4` |
| `cine/plan-jeu.mjs` | **Vue arrière, caméra du jeu**, un personnage qui joue vraiment, cinq figurants autour de lui. 20 à 26 s. | `jeu-<epreuve>.mp4` |
| `cine/plan-portes.mjs` | **Traversée des Portes.** La caméra zigzague à travers les sept murs ; à chaque fois, la porte qu'elle vise — et elle seule — explose juste avant le passage. 17 s. | `portes-traversee.mp4` |
| `cine/plan-danse.mjs` | **Les cinq personnages alignes qui dansent**, chacun sur sa propre chorégraphie. 14 s. | `danse-troupe.mp4` |
| `cine/sonde.mjs` | Ne tourne rien : mesure la taille jouable de chaque carte et le coût d'une image. | `shots/cine/sonde/` |

Chaque script accepte `--apercu` : six à huit images fixes au lieu de la vidéo. C'est ce
qu'il faut lancer après avoir touché un cadrage — juger une composition sur six images
coûte une minute, la juger sur la vidéo en coûte dix.

## Lancer

Le harnais a besoin d'un serveur qui serve le jeu. **Ne pas utiliser `npm run dev` :** le
rechargement à chaud de Vite fait disparaître `window.__probeGame` au milieu d'un plan, et
une autre session qui édite une source suffit à perdre trois mille images. On sert donc un
build FIGÉ :

```bash
npx vite build --outDir /tmp/cinedist --emptyOutDir
npx vite preview --outDir /tmp/cinedist --host 127.0.0.1 --port 5399 --strictPort &
node cine/plan-cartes.mjs
```

`CINE_PORT` change le port, `CINE_FPS` la cadence, `CINE_IMAGES` le dossier des images
intermédiaires (par défaut hors du dépôt : un plan de 22 s en pèse 600 Mo avant encodage).

## Le temps du film n'est pas le temps de la montre

Le rendu est **logiciel** : une image coûte entre 0,4 et 0,8 seconde. Filmer l'écran en
temps réel donnerait donc une vidéo à deux images par seconde, et sa durée dépendrait de
la charge de la machine.

`noyau.mjs` remplace donc l'horloge du jeu. `requestAnimationFrame` est mis en file plutôt
qu'appelé par le navigateur, `performance.now` — la source de temps de `THREE.Clock` — ne
renvoie plus que le temps VIRTUEL, et `__cineAvancer(ms)` fait avancer les deux d'un pas
exact avant de vider la file. Une image rendue vaut 1/30 s de film, quoi qu'il en coûte à
calculer. Deux conséquences pratiques :

- **`waitForFunction` doit sonder en `polling`**, jamais en `raf` (son défaut) : le rail
  d'animation étant neutralisé, il attendrait pour toujours.
- Le jeu ne tourne plus tout seul. Entre deux `avancer()`, le monde est arrêté — c'est ce
  qui permet de téléporter un personnage, de creuser une tour ou de replacer cinq
  figurants sans qu'une seule image ne le montre.

## La caméra n'est pas branchée dans le jeu

`preparer()` enveloppe `composer.render` : la caméra du plan est posée juste AVANT le
rendu, donc après que la boucle de jeu a calculé la sienne. Aucune ligne de `src/` ne
connaît le cinéma, et `plan-jeu.mjs` n'a qu'à ne rien poser (`window.__cineCam = null`)
pour retrouver la vraie caméra du joueur.

L'image se lit sur le **canevas** (`toDataURL`), pas sur la page : le HUD, qui est du DOM,
n'y figure jamais et n'a donc pas à être masqué. `preserveDrawingBuffer` est forcé à la
création du contexte WebGL — sans lui, lire le canevas hors du cycle de rendu renvoie du
noir (voir `diag/README.md`).

## Ce qui est mesuré plutôt qu'écrit

Aucune coordonnée de caméra n'est écrite en dur.

- **La taille de la carte** vient de `__cineEnveloppe`, qui ne retient de `arena.group`
  que les maillages de taille humaine situés dans le couloir de jeu. Mesurée naïvement,
  une carte fait 1300 m de large sur les cinq épreuves — le décor lointain, la mer et le
  plan de sol pèsent plus que la piste, et la caméra se retrouvait à un kilomètre.
- **Le tracé** vient de `releverRail`, qui **marche** le long du parcours : chaque tranche
  de Z est sondée autour de la position de la précédente, on retient la surface la plus
  haute — une piste de jeu est toujours posée au-dessus de ce qui l'entoure — et chaque
  rayon repart sous toute intersection perchée bien au-dessus de la tranche précédente,
  sans quoi la première arche venue devient le sol. Deux épreuves seulement exposent des
  `trajectoires`, et pas dans le même format ; les trois autres n'exposent rien. Le rayon,
  lui, marche partout.
- **Le rayon de cadrage** prend le maximum de deux contraintes, largeur ET hauteur. Sans
  la seconde, L'Hexagone — 49 m de large pour 68 m de haut — se cadrait sur sa largeur et
  la caméra finissait à l'intérieur de la tour.

## Trois pièges qui ne se voient pas à l'image

Ils ont tous les trois la même signature : le plan reste **plausible**. Rien ne casse,
aucune erreur n'est levée, et seule une mesure les révèle.

**`hit.timeOfImpact`, jamais `hit.toi`.** Rapier a renommé le champ. L'ancien nom renvoie
`undefined`, donc une cote `NaN`, donc — après le comblement des trous — un rail
parfaitement plat à la hauteur du départ. Les cinq cartes ont d'abord été tournées comme
ça : les plans étaient jolis, ils ne suivaient simplement plus le terrain. `diag/` lit ce
champ partout, et `scenes/hexagone.js` (`__ray`) donne l'idiome de référence.

**Une arène qui vient d'être construite ne répond à aucun rayon.** Rapier tient ses
requêtes de scène dans une structure mise à jour par `world.step()` : tant que le monde
n'a pas fait un pas, `castRay` renvoie `null` partout. Comme le harnais arrête le temps,
ce pas n'arrive jamais tout seul — `releverRail` fait donc tourner deux images avant de
sonder.

**La médiane d'une nappe de rayons donne la PELOUSE.** La première version sondait
cinquante-deux mètres de large : la piste n'en fait qu'une quinzaine, la moitié des rayons
tombent à côté, et la médiane suivait donc le terrain naturel. Sur Le Rondin, elle donnait
le fond du lagon. D'où la marche décrite plus haut.

## Deux mises en scène assumées

**Les plans de personnage écartent les obstacles mobiles** (`?skip=rollers,balls,…`). Le
premier essai a été tourné sur le parcours complet : un rouleau est passé entre la caméra
et le personnage sur deux plans sur six, un ballon l'a couché au troisième. Ces cinq plans
n'existent que pour être substituables au montage ; un obstacle qui frappe l'un et pas
l'autre leur retire leur seule raison d'être. Le jeu obstacles compris est montré par
`plan-jeu.mjs`.

**La porte des Portes casse pour de vrai.** Rien n'est animé à la main : la règle du
mini-jeu brise une porte franchissable quand un point de référence — le joueur, en partie —
arrive à 1,25 m d'elle. `plan-portes.mjs` lui donne simplement un AUTRE point : un
« ouvreur » invisible qui précède la caméra de sept mètres sur son propre rail. La rupture
filmée est donc celle du jeu, avec ses neuf quartiers de papier, sa gerbe de confettis à la
teinte de la porte et l'onde de choc qui fait frémir les voisines — et comme l'ouvreur suit
exactement la trajectoire de la caméra, seule la porte traversée cède. Deux réglages du jeu
sont neutralisés le temps du plan, en enveloppant `arena.update` : `masquerMurs`, qui efface
le mur que la caméra traverse (indispensable en partie, désastreux ici — le mur
disparaîtrait juste avant qu'on le franchisse), et le point de rupture.

**Les danses se greffent, elles ne se recopient pas.** Les cinq chorégraphies arrivent dans
des glTF à part, avec leur propre maillage dont on ne garde rien. Elles s'appliquent telles
quelles parce que les personnages du catalogue et les fichiers de danse partagent le même
squelette à 24 os — `Hips`, `Spine`, `LeftUpLeg`… — et qu'un `AnimationMixer` relie ses
pistes aux os PAR LEUR NOM : 72 pistes sur 72 trouvent leur os sur les cinq. C'est la même
raison qui permet au jeu de monter un unique clip d'attente sur les cinq personnages.

Les fichiers vivent dans `public/models/danse-*.glb` mais **pas dans le manifeste** : le jeu
ne les joue jamais, il n'a aucune raison de télécharger six mégaoctets de danse au
démarrage. Le harnais les charge à la demande, par le chargeur du jeu (`__probeAssets`).
Le `ClipRig` du personnage est gelé le temps du plan — deux mixeurs sur le même squelette se
battraient — et la danse est ajoutée sur SON mixeur : un seul mixeur, une seule animation.

**Les figurants ne jouent pas, ils courent.** Le prototype est solo : un seul personnage a
un corps physique. Les cinq autres silhouettes sont de vrais modèles rigges, animés par
leurs propres clips, mais déplacés par le harnais — calés sur la position du joueur, les
pieds posés sur le sol relevé au rayon à chaque image. Ce que le plan montre honnêtement,
c'est la densité visuelle d'une manche et les cinq personnages du catalogue côte à côte.
Aucun skin n'est inventé.

## La sonde ajoutée au jeu

`plan-jeu.mjs` a besoin d'instancier un personnage rigge de plus, ce qu'aucune sonde ne
permettait. `src/main.js` expose donc `window.__probeFigurant(nom, hauteur)`, à côté des
autres sondes de diagnostic. Elle ne rend qu'un modèle animé, sans corps ni collider, et
rien en partie ne l'appelle.
