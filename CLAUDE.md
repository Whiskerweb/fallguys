# Tumble — règles de travail

Party game de parcours d'obstacles, **jouable dans un navigateur**, à mises réelles en
USDC. Design complet : `docs/superpowers/specs/` — **lire les Amendements en tête** avant
le corps, ils disent ce qui a changé depuis.

L'utilisateur est **directeur produit, pas codeur**. Il ne relira pas le code : les
commentaires et les messages de commit sont le seul endroit où une décision peut survivre.

---

## Avant de toucher quoi que ce soit

**Plusieurs sessions Claude travaillent en parallèle sur ce dépôt.** Observé : traduction
de l'interface, réécriture de scènes, harnais cinéma, tout cela pendant qu'une autre
session ajoutait une carte.

- **Jamais de suppression par joker.** Une session a déjà détruit `diag/_smokehex.mjs` avec
  `diag/_*.mjs` — fichier non suivi, irrécupérable. Lister d'abord, supprimer nommément.
- **Vérifier ce que l'arbre de travail contient avant de commiter.** Il mélange les
  travaux. Pour n'indexer que le sien dans un fichier partagé : écrire temporairement la
  version « mienne seule », `git add`, puis restaurer la version complète.
- Brouillons dans le scratchpad de session, hors du dépôt. Dans `diag/` seulement si un
  `import` l'exige (playwright n'est résolvable que depuis `tools/feel-lab`), et avec un
  préfixe propre à la tâche.
- Mesurer contre `vite preview` sur un port figé plutôt que le serveur de dev : le
  rechargement à chaud déclenché par l'autre session fausse les mesures en cours.

---

## Les quatre morceaux

| | |
|---|---|
| `tools/feel-lab/` | **Le jeu.** Three.js + Rapier, cinq épreuves. Le serveur exécute ces mêmes modules. |
| `serveur/` | **Serveur de jeu autoritatif.** Aucun accès aux soldes. |
| `backend/` | **L'argent.** Supabase, grand livre, USDC devnet. |
| `src/Fallguys.Rules/` | **Noyau de règles** C#, la table des gains. |

`game/` (Unity) est **vide** : la spec le prévoyait, ça n'a jamais été commencé.

---

## Règles dures

**Aucun générateur aléatoire dans le monde du jeu.** C'est la condition légale de la
qualification « compétition de skill » (spec § 5), pas une préférence de style. Tout ce qui
varie dérive de la graine de manche. `Math.random` a déjà été trouvé une fois dans la
physique — la culbute de `character.js` — et c'était à la fois une faille juridique et la
seule source de non-reproductibilité du jeu.

**Aucun bot dans une partie payante.** `serveur/src/politique.js` l'interdit par deux tests
indépendants (la politique, et la mise non nulle). Une garantie qui tient à un seul test
tient à une seule faute de frappe.

**L'argent en micro-unités entières, jamais en flottant.** 1 USDC = 1 000 000. Même type et
même échelle en C#, dans les deux ports JavaScript, et en `bigint` Postgres.

**Trois implémentations de la table des gains** — `PayoutPolicy.cs`, `backend/src/gains.js`,
`tools/feel-lab/src/economie.js` — verrouillées entre elles par les tests, de 3 à 24
joueurs. Le lobby annonce ce que le backend paiera, ou le test tombe.

**Meshy pour le décor, procédural pour tout ce qui porte un collider.** Une hitbox qui ne
correspond pas au visuel est disqualifiante dans un jeu à mises.

**Les secrets ne sortent jamais.** `.env` est ignoré par git. Ne jamais afficher une valeur
— seulement des noms de variables et un statut renseigné/vide.

---

## Pièges qui ont coûté du temps

**La porte des textures, trois éditions et non deux.** Un PNG généré est ignoré en silence
tant que son nom n'est pas dans `TEXTURE_SLOTS` **et** qu'une fabrique n'appelle pas
`painted('<slot>', repeat)` avec un repli procédural. A déjà tué dix textures.

**`world.step()` avance de `world.timestep` (1/60), quoi qu'on lui passe.** Un tick à 30 Hz
vaut donc deux sous-pas, et `tuning.js` a été mesuré à 1/60. Un client qui appelle
`avancerTick` soixante fois par seconde parcourt deux secondes de jeu par seconde réelle.

**`limiterVitesse()` s'appelle APRÈS le pas**, jamais avant : c'est le solveur qui produit
les expulsions. Sans lui, une capsule coincée part à vitesse non bornée puis en NaN — et un
NaN rend *toute* comparaison fausse, donc déclenche à vide chaque zone de la carte.

**Un rayon Rapier ne touche rien tant que le monde n'a pas fait un pas** : la structure
d'accélération n'existe pas avant.

**L'origine d'un rayon doit être DEVANT le corps**, sinon il touche sa propre capsule et
signale un mur en permanence.

**On ne braque pas en approche de fosse ni en vol** : la vitesse est un budget partagé entre
X et Z, et sauter en diagonale ramène la portée de 5,3 m à 3,9 m.

**Libérer l'arène APRÈS le personnage** : il détient un corps dans ce monde physique, et
l'ordre inverse laisse un pointeur wasm mort que rien ne signale avant le plantage.

---

## Vérifier

```bash
dotnet test                                #  58 — la table des gains (PATH=$HOME/.dotnet)
cd backend         && npm test             #  50 — grand livre, RLS, retraits (PGlite)
cd tools/test-harness && npm test          # 111 — serveur, réseau, prédiction
cd tools/feel-lab  && node diag/duel.mjs   #  20 — DEUX navigateurs, une partie
cd tools/feel-lab  && node diag/partie.mjs #  le solo, trois manches
```

Rien ne demande Docker, base de données ni serveur lancé d'avance.

**Les harnais pilotent réellement le personnage**, ils ne jugent pas des images. Et ils ne
mesurent **jamais en images** : à ~10 images/s en rendu logiciel, compter des frames mesure
la machine et non le jeu. Attendre des **états**, pas des durées.

**Les valeurs attendues sont posées à la main.** Un test qui refait le calcul du code testé
ne teste rien.

**Un seuil se règle sur ce qu'on mesure.** L'erreur de prédiction vaut 6,5 cm et le verdict
est à 15 : un test doit casser quand la qualité baisse, pas quand elle s'effondre. Un seuil
trop lâche a laissé passer un client qui simulait deux fois trop vite.

---

## Le jeu en ligne

Le serveur **importe les vrais modules du jeu**, pas une réécriture : une simulation
« serveur » séparée divergerait au premier réglage, et ce jour-là la prédiction du client
cesserait de coller sans que rien ne le signale.

En ligne, **le client ne décide de rien** : ni la carte ni la graine (le serveur les
impose), ni la chute, ni la qualification. Il **prédit** son déplacement, et c'est tout.

`main.js` a exactement **cinq points d'accroche** (`imposee`, `enligne`, `attacher`,
`envoyer`, `avancer`). Tout le netcode vit dans `tools/feel-lab/src/enligne/`. Ce fichier
est édité par plusieurs mains : ne pas y installer de logique réseau.

Le protocole vit dans le jeu et le serveur l'importe de là — comme `moteur.js` (Three,
Rapier) et `economie.js`. Une copie de chaque côté divergerait, et un décodeur qui lit un
octet de trop rend des positions plausibles mais fausses.

---

## Avant le mainnet

Liste complète en tête de `backend/README.md`. En résumé : serveur autoritatif (fait),
`MatchResult` **signé** (à faire — le backend croit encore le client), journal de replay,
géo-restriction, gestion de clé sérieuse, validation juridique.

Cette dernière n'est pas une question d'ingénierie et aucun code de ce dépôt ne la tranche.
