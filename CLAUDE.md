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
| `serveur/` | **Serveur de jeu autoritatif.** Aucun accès aux soldes ; il SIGNE ce qu'il dit au backend. |
| `backend/` | **L'argent.** Supabase, grand livre, USDC sur Solana (un wallet par joueur, un par partie), le jeton BG et son brûlage, la page `/suivi`. |
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
`tools/feel-lab/src/economie.js` — verrouillées entre elles par les tests. Elles tiennent
cinq choses : les **modes** (duel 2 / squad 4 / arena 16), les **dix issues** de chaque
mode, le **tirage** lui-même, la **roue de chaque rang** (case par case, XP compris), et
l'échelle des salons réduits de 3 à 24 joueurs. L'écran de fin annonce ce que le backend
paiera, ou le test tombe.

**LA ROUE TIRE À LA FIN DE LA PARTIE, et c'est une décision du directeur produit (2
septembre 2026), pas d'ingénierie.** Elle tirait au salon, avant la mise, et c'était la
position juridique du § 5 (aucune machine ne décide de l'issue une fois la mise engagée).
Le directeur produit a été prévenu de ce point, de la licence sous laquelle Betclic opère,
et de l'alternative « tirée avant, scellée, révélée après » ; il a choisi le tirage après.
C'est consigné dans l'amendement du 2 septembre de la spec. **Ne pas le « réparer »** en
ramenant le tirage au salon : c'est un choix produit. La validation juridique est en tête
de la liste d'avant-mainnet, et aucun code d'ici ne la tranche.

**Le mécanisme : un tableau à dix lignes par mode, en VINGTIÈMES de mise.** Une issue
donne, rang par rang, le gain en vingtièmes de mise (20 = la mise). Une ligne distribue
entre 70 % et 100 % du pot — **jamais plus : la maison ne sort jamais un centime** — et ce
qu'elle ne distribue pas est le rake de CETTE partie, de 0 % (JACKPOT en duel) à 17,5 %
(FLAT en duel). Pondérées par leurs poids, les dix lignes distribuent EXACTEMENT 90 % du
pot : **le rake vaut 10 % en moyenne, au vingtième près, et `verifierRoue` l'exige.** La
première version tenait 90 % sur CHAQUE ligne ; le directeur produit a vu trois fois
« 3.60 » sur la roue d'un duel et demandé de petites variations et une case à 4,00. À rake
fixe, dix montants distincts n'existaient pas (sept valeurs entre 2,40 et 3,60 en dixièmes)
et 4,00 est le pot entier. Choix produit du 2 septembre 2026 : le rake bouge avec la ligne,
pas la moyenne. La graine de roue (32 bits, hasard cryptographique,
`serveur/src/instance.js`) est tirée au classement final, voyage dans `fin-partie`, et le
client comme le backend en DÉRIVENT la ligne avec `tirerIssue` — le même lowbias32 dans les
trois implémentations. Personne ne déclare une issue.

**Dix montants DISTINCTS pour le vainqueur, dans les trois modes**, et pour les rangs 2 à 3
en arène, 2 en squad. Deux cases au même montant sur une roue se lisent comme un tirage
truqué ; `PrizeWheelTests.cs` et `diag/economie.mjs` le vérifient. Les rangs d'argent
(5-8) varient moins — ils tiennent entre ×1,0 et ×1,3, le plancher de la mise rendue est
dur.

**Une roue PAR JOUEUR, selon son PALIER.** `roueDe(mode, rang, mise)` rend la COLONNE du
rang : dix cases, une par ligne, de tailles proportionnelles aux poids. Diamant pour le 1er,
or pour le podium, argent pour la bande remboursée, bronze pour ceux qui ont perdu leur mise
(`grade(mode, rang)` : arène ◆ 1 · ★ 2-4 · ● 5-8 · ○ 9-16 ; squad ◆ 1 · ★ 2 · ○ 3-4 ; duel
◆ 1 · ○ 2). Un bronze gagne de l'XP sur neuf cases et sa mise sur une (4 à 14 % en arène,
une demi-mise au mieux en duel : le pot ne fait que 1,8 mise après rake). Deux joueurs du
même palier n'ont pas la même roue. Deux cases peuvent porter le même montant : elles
restent deux cases, ce sont deux lignes.

**LA TAILLE D'UNE CASE EST SA PROBABILITÉ, et ça ne se négocie pas.** JACKPOT (2 %) est un
éclat, STANDARD (22 %) un large quartier. Sa POSITION est libre : `ordreDesCases()` alterne
les lignes modestes et hautes pour que le gros lot passe souvent sous le curseur.
Redistribuer les positions est une décision de lisibilité ; **redimensionner une case
serait un mensonge sur les cotes** — la seule chose que `roue.js` n'a pas le droit de faire.

**Deux chemins de calcul, et ils ne servent pas à la même chose.** `table(mise, mode,
issue)` paie les trois modes ouverts au public : dix lignes posées à la main, une tirée.
`tableEffectif(mise, joueurs)` paie les **salons réduits** — une arène partie à treize —
dont la forme est calculée par moitiés, **sans roue** : le tableau est écrit pour seize
rangs, et le tordre pour treize déplacerait les 66 tables que les trois implémentations
comparent. Le résultat s'y affiche directement.

**Le joueur ne voit pas son gain avant de lancer.** Le bandeau dit le rang ; le montant
n'apparaît qu'à l'arrêt de la roue (`poserLeGain`). L'XP d'un bronze est créditée là aussi,
pas avant. Demande explicite du directeur produit.

**Deux vocabulaires, délibérément distincts.** Les PALIERS portent des gemmes (diamant, or,
argent, bronze) ; les ISSUES portent des noms de forme (FLAT, SOFT, SHARE, BALANCE,
STANDARD, PODIUM, SHARP, CROWN, ROYAL, JACKPOT). Leur donner les mêmes noms sur le même
écran serait illisible. Le ticket du lobby importe encore `VARIANTES` : c'est le MÊME objet
qu'`ISSUES`, gardé sous son ancien nom pour une autre main.

**Aucun multiplicateur devant le joueur.** Il mise des USDC, il gagne des USDC. `×5` lui
demandait de calculer de tête ce que la colonne d'à côté lui donnait déjà. `facteur()`
existe toujours dans `economie.js` et `diag/economie.mjs` le vérifie — c'est l'outil avec
lequel NOUS raisonnons, pas son unité de compte. **Ne pas le supprimer comme code mort :
il est vivant du côté où l'on conçoit, absent du côté où l'on joue.**

**Le ticket dit UNE chose sur l'argent : ce que le vainqueur gagne, en fourchette.**
« 1ST PLACE WINS 2.60–4.00 USDC · 2 players · winner takes all ». Plus de pot, plus de
rake, plus de barème rang par rang ni de gemmes dans le ticket — demande du directeur
produit (4 septembre 2026) : « simple, efficace ». Les deux bornes sont lues sur la roue
du vainqueur (`roueDe`), et la borne basse descend au gain d'une table partie au minimum
quand le mode peut partir réduit ; `diag/bascule.mjs` le lit dans `#pot-val` / `#pot-sub`,
dont les identifiants ont survécu au pot. Le portefeuille et la porte ont été redessinés
le même jour dans la grammaire du ticket (cadre biseauté, or pour l'argent, cyan pour
l'action, rose pour le seul geste qui engage) ; leurs identifiants n'ont pas bougé,
`diag/web3-lobby.mjs` et `diag/web3-duel.mjs` les lisent.

**La roue est un MOMENT, pas un décor.** Elle n'existe qu'entre le dernier classement et le
choix du joueur. `cacherEcranDeFin()` est appelé par `startRace()`, `enterLobby()` et
`quitterEcranDeFin()` : sans ces trois-là, la roue d'une partie restait en bas de l'écran
pendant la suivante, et on la voyait « tout le temps ».

**Pas de roue quand rien n'est en jeu.** Une partie gratuite ne paie aucun rang, un salon
réduit n'a pas de tableau : on montre le résultat directement. La roue est la cérémonie
d'un tirage ; sans tirage, pas de cérémonie.

**Les espérances ne sont plus ×1,8 exactement.** La moitié des joueurs se partage 90 % du
pot en moyenne, mais une part en est rendue aux bronzes : en arène le 1er vaut ×4,67 en
espérance (×5,0 avant), le 2e ×2,13, la bande 5-8 ×1,01 à ×1,07, chaque bronze ×0,04 à
×0,14 ; en duel le vainqueur ×1,70, de 2,60 à 4,00 à 2 USDC. Ce sont des DONNÉES
(`ISSUES`), verrouillées par les tests ; les changer est une décision produit, pas un
correctif. Le rake reste 10 % en moyenne, lui, exactement.

**La roue s'arrête en trois temps, et passe sur la case d'à côté.** `roue.js:tourner`
décrit une VITESSE : un lancer qui ralentit, une reptation à vitesse constante sur toute
la case voisine (celle qui passe sous le curseur juste avant la case tirée, crans audibles),
puis l'arrêt au centre en une demi-seconde. Demande du directeur produit, sur le modèle de
Winamax : « on croit qu'elle va s'arrêter sur la grosse case, et c'est celle d'à côté ». La
destination est fixée AVANT par la ligne tirée ; la mise en scène ne touche que le chemin.

**La fin de partie ne se ferme pas toute seule.** Le joueur lance la roue quand il veut et
choisit entre LOBBY et REJOUER. Le retour automatique après 3,2 s (solo) et 4 s (en ligne)
a été retiré : il vient de gagner ou de perdre de l'argent réel, et lui reprendre l'écran
était une décision qu'on prenait à sa place. Les harnais font donc les deux gestes —
`passerLaRoue()` dans `diag/partie.mjs`, la section 9 de `diag/duel.mjs`.

**BabyTrump n'est plus donné : il est EN BOUTIQUE, et il se gagne en publiant un post sur
X.** Décision produit du 2 septembre 2026 — le premier objet cosmétique du jeu ne s'achète
pas, il s'obtient en parlant du jeu. La boutique n'a **qu'une ligne**, et c'est voulu : une
grille de cases « SOON » promettrait un catalogue qui n'existe pas. `boutique.js` tient la
règle et l'état, `lobbyui.js` le dessin, `cosmetics.js` refuse d'équiper ce qui n'est pas
possédé — le garde est dans le catalogue et pas seulement dans l'écran, parce qu'une
garantie qui ne tient qu'à l'interface tient à un clic ajouté. Le défaut du catalogue est
le premier personnage **portable**, jamais `MODELS[0]` : BabyTrump est en tête de la
vitrine, cadenas compris, et un défaut posé dessus l'aurait affiché EQUIPPED sous son
propre verrou.

**Le post part SANS LIEN, tant qu'aucun DNS ne pointe sur le jeu.** `LIEN` et `COMPTE_X`
sont vides dans `boutique.js`, et `lienDePost()` ajoutera `url=` et `via=` d'elle-même le
jour où ils seront renseignés. Une URL bidon en attendant enverrait les premiers curieux
sur une page morte — et c'est le seul clic qu'ils feront.

**Le déblocage est DÉCLARATIF, et il l'est parce que l'enjeu est un cosmétique.** Rien ne
prouve que le post existe : le joueur ouvre X, revient, et affirme l'avoir publié (huit
secondes de friction minimum, pour que l'onglet ait eu le temps de s'afficher). Une vraie
vérification demande l'API X — OAuth, portée `tweet.read` — donc un compte applicatif et un
domaine de redirection, et elle devra vivre dans `backend/` : un client qui se déclare
propriétaire n'est jamais une preuve. **Rien de ce chemin ne touche au grand livre, à la
mise ni au gain**, et c'est la seule raison pour laquelle il est tenable. Le jour où un
objet de boutique vaudra de l'argent, la porte se ferme AVANT.

**Meshy pour le décor, procédural pour tout ce qui porte un collider.** Une hitbox qui ne
correspond pas au visuel est disqualifiante dans un jeu à mises.

**Les secrets ne sortent jamais.** `.env` est ignoré par git. Ne jamais afficher une valeur
— seulement des noms de variables et un statut renseigné/vide. Les wallets de trésorerie
sont NOTÉS avec leurs secrets dans `backend/wallets/<réseau>.json`, ignoré lui aussi ;
c'est la note demandée par le directeur produit, pas une copie de travail.

---

## L'argent est sur la chaîne (2 septembre 2026)

**Le navigateur ne parle plus de partie au backend.** `caisse.js` engageait la mise et
déclarait un rang à `POST /partie/regler` ; ces routes n'existent plus. C'est le SERVEUR DE
JEU qui fait engager les mises avant le départ et régler le classement à la fin, par des
messages **signés Ed25519** (`serveur/src/argent.js` → `backend /interne/…`). Le backend ne
croit que cette signature, qui couvre le mode, la mise, l'effectif, la graine de roue et le
classement, plus un horodatage. Le client apprend son gain par le message `reglement` et
relit son solde. `caisse.engager` / `caisse.regler` survivent pour le BANC seulement.

**Un wallet par joueur, un wallet par partie, et rien ne se mélange.** Les USDC d'un joueur
sont sur SON wallet dérivé (`adresses.js`, HKDF de `GRAINE_DEPOTS`) — son adresse de dépôt
EST son compte de jeu, on ne balaie plus vers la caisse. Sa mise part vers le wallet du POT
de la partie (dérivé aussi, `tresorerie.pot`), le règlement vide le pot vers les gagnants
et le wallet FRAIS, puis ferme le compte du pot (rente rendue). La caisse ne détient plus
les USDC des joueurs : elle paie les frais de toutes les transactions. Chaque partie est
donc lisible sur un explorateur, et `verifierChaine()` compare livre et chaîne compte par
compte, en tenant compte de ce qui est en transit.

**Le livre d'abord, la chaîne ensuite, et le journal entre les deux.** `chain_tx` porte une
ligne par opération, clée `(objet, ref)`, `prevu → signe → confirme | echoue` ; la signature
y est écrite AVANT la diffusion. `ChaineEchouee` (rien n'est parti : on défait au livre) et
`ChaineIncertaine` (peut-être parti : on ne défait RIEN, `rattraperChaine` relit la chaîne)
ne sont pas la même erreur, et les confondre rembourse une mise qui est bel et bien partie.
`executer()` saute les opérations déjà confirmées d'un lot — sans cela, une annulation
rejouée renvoyait deux fois la même mise.

**Si UNE mise ne part pas, la partie est ANNULÉE et tout le monde est remboursé.** Pas de
partie à quinze payants et un fantôme, pas de barème tordu : `engagerPartie` rend les mises
parties, le serveur renvoie les innocents en file (`PARTIE_ANNULEE`) et dit sa raison au
fautif (`SOLDE_INSUFFISANT`, `MISE_REFUSEE`).

**Plus de TOP UP.** Le portefeuille local de 25 USDC n'existe que sur un BANC, et c'est le
SERVEUR qui le dit (`bienvenue.argent === false && identite === 'facultative'`) — jamais un
bouton, jamais une URL. Sans compte, le solde vaut ZÉRO et PLAY dit « Sign in to play for
USDC ». `PRODUCTION` exige l'identité (`politique.identite: 'requise'`) et refuse de
démarrer sans `BACKEND_URL` ; une politique de banc écrite à la main dans un harnais ne dit
rien de l'identité et reste un banc.

**Le jeton BG (« Baby Guy ») : 1 000 000 000, Token-2022, frappe révoquée.** Les frais
(10 % du pot en moyenne, sur le wallet FRAIS, sur la chaîne) achètent des BG et les brûlent
dans UNE transaction atomique (`brulage.js`), dès 1 USDC. Sur devnet il n'existe aucun
marché pour un jeton neuf : le service tient sa propre réserve (wallet POOL, BG + USDC) et
applique le produit constant — le prix se lit sur la chaîne, dans les soldes du pool. Sur
mainnet, `echanger()` devient un routage Jupiter et rien d'autre ne bouge. **Le prix se dit
en BG pour 1 USDC** (`bgParUsdc`) : en USDC par BG il vaut zéro au micro près.

**Les amounts de BG sont des micros aussi** (six décimales) : 10^15 unités au plus, sous
`MAX_SAFE_INTEGER`. Les produits intermédiaires du prix passent par `BigInt`.

**`config.js` lit l'environnement à l'import, et les imports sont hissés.** Poser
`process.env.X` en tête d'un script ne sert à rien si un import statique charge `config.js`
avant : `test/env.mjs` est le PREMIER import de `aide.mjs`, et `outils/cycle.mjs` importe
tout en dynamique, dans l'ordre. La graine de test `Buffer.alloc(32, 1)` est une clé
publique CONNUE (quelqu'un l'a financée sur devnet) : ne jamais la prendre pour une preuve.

**Le faucet devnet est limité par jour et par IP**, et l'airdrop RPC répond « Internal
error » ou 429 sans distinguer les deux. `outils/cycle.mjs --local` prouve le cycle complet
sur `solana-test-validator` (installé dans `~/.local/share/solana`) ; sur devnet, SOL
(faucet.solana.com) et USDC (faucet.circle.com) sont deux gestes humains dans un navigateur.

**Deux processus déjà lancés sur 8080 et 8787 ne sont pas forcément les tiens.** Regarder
`lsof -i :8787` et l'heure de lancement avant de tuer ; un serveur d'une autre session ou
du directeur produit s'y trouve peut-être. Prendre un autre port pour vérifier (`PORT=8788`,
`BACKEND_URL=http://127.0.0.1:8788`).

**LA PORTE (`porte.js`) : la connexion est plein page, AVANT le lobby.** Décision produit du
4 septembre 2026 : un joueur sans compte ne peut rien faire, donc on le lui dit d'entrée,
avec l'image du jeu, au lieu de le laisser découvrir un lobby à zéro. Elle s'ouvre quand le
SERVEUR dit qu'il y a de l'argent derrière lui (`bienvenue.argent`) et qu'aucune session
n'existe ; jamais sur un banc — sinon quarante harnais qui ne savent pas se connecter
seraient bloqués devant. L'ancien panneau de compte reste pour ACCOUNT / SIGN OUT. La
création de compte demande un nom de joueur, stocké dans les métadonnées Supabase et
repris par le lobby.

**Ne jamais attendre `supabase.auth.getSession()` pendant un `onAuthStateChange`.**
supabase-js tient un verrou en prévenant ses auditeurs, et l'appel ne répond jamais : la
porte restait ouverte après une connexion réussie, nom et solde affichés derrière. La
porte tient l'état de session à partir du PAYLOAD de l'auditeur, et ne relit `getSession()`
qu'une fois, hors auditeur. Un harnais Playwright attend `#porte` CACHÉE avec
`waitForFunction` : `waitForSelector('#porte.hidden')` attend qu'un élément caché
devienne visible, c'est-à-dire jamais.

**`session.js` ne relaie que les types de message qu'il LISTE.** `engagement` et
`reglement` arrivaient du serveur et personne ne les écoutait : le bouton ne disait jamais
« STAKING… » et le solde restait figé après une partie payée, alors que le backend avait
payé. Un nouveau type de message du serveur passe par cette liste, ou il n'existe pas.

**Le lobby se connecte AVANT que le joueur se connecte à son compte.** `bonjour` part sans
jeton, le serveur tient le joueur pour un invité et refuse les files payantes
(`NON_AUTHENTIFIE`). `matchmaking.js` se représente au serveur à chaque changement de
session (`surSession`), hors file et hors partie. Un harnais attend `file.compte`, pas
seulement `lien` ouvert.

**Deux pages Playwright du même contexte partagent le localStorage**, donc la session
Supabase : la seconde connexion écrase la première, et le serveur voit deux fois le même
compte. Un contexte par joueur (`browser.newContext()`), comme dans `diag/web3-duel.mjs`.

**Le serveur de jeu charge le `.env`, et `PORT=8787` y est celui du backend.** Il ignore
un `PORT` venu du fichier (`SERVEUR_PORT`, ou `PORT` posé dans l'environnement réel).

**Sur devnet, personne ne vend d'USDC contre du SOL.** L'USDC devnet n'a qu'une source, le
faucet Circle (une demande par adresse et par heure). Les wallets dérivés sont à nous : on
répartit l'USDC d'un seul faucet entre eux par un virement signé, la caisse payant les
frais. Les comptes d'essai vivants sont `tumble.probe.9f3a1c@gmail.com` et
`tumble.probe.b7e2d4@gmail.com` (mot de passe dans l'historique de session, pas ici).

**`readFileSync` après `writeHead` tue le processus** (`ERR_HTTP_HEADERS_SENT`, non
rattrapable par le `catch` qui tente de répondre autre chose). Lire d'abord, écrire ensuite.

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

**Un effectif posé à la racine d'une politique gagne sur la carte des modes.**
`PRODUCTION` ne porte plus de `cible`/`minimum` à la racine, seulement une carte
`modes: { duel, squad, arena }` — délibérément. Tant qu'il y avait les deux,
`{ ...POLITIQUES.PRODUCTION, cible: 4 }`, la forme qu'emploient les harnais, voyait son
intention écrasée en silence par la carte : le harnais demandait des salons de quatre et
en obtenait de seize, sans un mot. `formatDe()` tranche en une règle, et une politique qui
n'ouvre pas le mode demandé refuse au lieu d'inventer.

**`innerHTML = ''` sur un conteneur efface aussi ce qu'on n'y a pas mis.** La roue montait
dans `#roue-scene` et le vidait à chaque partie — emportant le curseur et son propre point
de montage. Le SVG se retrouvait alors en élément STATIQUE sous une jante POSITIONNÉE : on
voyait un cercle vide, jante comprise, et rien n'était en erreur. `creerRoue` prend
désormais DEUX éléments — la scène (classes, gestes) et le disque (le seul qu'on vide).

**Annuler `jeu.enligne` rend la main aux règles HORS LIGNE.** `brancher.js` le fait à la fin
d'une partie pour cesser d'envoyer des entrées — et à l'image suivante `main.js` ne se sait
plus en ligne, voit que le vainqueur est encore posé au-delà de la ligne d'arrivée, et
relançait `finishRace()` : le verdict « VICTORY! · +X USDC » était écrasé par un
« QUALIFIED! », puis le retour au lobby détruisait la roue 3,2 s plus tard. L'argent était
versé, le joueur ne le voyait jamais. C'est `jeu._fin` qui retient ces règles ; **les deux
lignes sont couplées**, et le trou ne se voyait que sur les cartes qu'on peut terminer —
d'où le faux motif « certaines cartes comptent, d'autres non ».

**Une carte de course ne produit un vrai vainqueur que si quelqu'un FRANCHIT la ligne.**
Sinon le chrono la tranche et le mieux placé est couronné — c'est un arbitrage assumé
(`politique.js`), pas un défaut, mais il ne doit pas devenir l'ordinaire. `node
tools/test-harness/franchissable.mjs` le mesure : à ce jour **`doors` et `dalles` ne sont
jamais franchies** (16 % et 53 % avec quatre bots forts en 400 s), et `rondin` demande
286 s pour « ≈ 55 s » annoncées. C'est un RAPPORT, pas un verdict : un bot n'est pas un
humain, et un seuil posé là mesurerait la force de nos bots.

**`places >= qualifies` arrête une manche, ce n'est PAS un plafond.** En survie, l'horloge
`t` est celle de la manche : au tick où elle tombe, tous les survivants étaient qualifiés
d'un coup — quatre vainqueurs pour une place en finale. En course, deux arrivées au même
tick faisaient pareil. On collecte donc, puis on tranche : à l'**altitude** en survie (sur
une tour qui s'effondre, le plus haut a consommé le moins), au **z** en course (le plus
engagé au-delà de la ligne est passé le premier). Jamais l'ordre du tableau.

**Un axe est un état, un bouton est un événement.** Le client envoie 60 entrées par seconde,
le serveur en consomme 30 : ne garder que la dernière reçue jette une image sur deux. Une
direction y survit — elle est maintenue longtemps ; un saut non — `jump` n'est vrai qu'une
seule image. Le serveur **accumule les boutons** (OU sur toutes les images inédites) et
**remplace les axes**, puis efface les boutons une fois joués. Mesuré avant correctif : 16
sauts demandés, 10 joués. Le joueur voyait son personnage sauter — la prédiction locale —
sans franchir l'obstacle. `serveur/src/instance.js`.

**Ce qui consomme une entrée ne doit pas muter l'état du serveur.** `avancerTick` remet
`jump` à faux entre ses deux sous-pas, ce qui est juste ; il faut donc lui passer une
**copie** par tick, sinon il efface l'accumulateur et donc l'appui suivant du joueur.

**Un plongeon et une culbute sont des ROTATIONS, pas des déplacements.** Le joueur local
passe en ragdoll et prend la rotation de sa capsule (`character.js`, branche `ragdoll`) ; le
squelette n'écarte que les membres, ce qui ne se voit pas à dix mètres. L'instantané ne
portait que la position : l'adversaire voyait donc un personnage glisser tout droit. Le
quaternion est désormais sur le fil, quatre octets par joueur, et `figurants.js` l'applique
sur un **pivot placé au milieu du corps** — faire tourner le groupe, posé aux pieds,
coucherait le personnage en balayant le sol.

**Ce qu'un joueur CHOISIT doit voyager ; ce qui se déduit de sa place ne vaut rien.**
L'apparence d'un adversaire venait de `MODELS[index % MODELS.length]` — son numéro de
siège — alors que chacun s'affiche avec le personnage qu'il a réellement choisi. Le même
joueur apparaissait donc en Trump sur une machine et en Musk sur l'autre. Le personnage
part maintenant avec `rejoindre` et le serveur le **relaie sans le comprendre**, borné à
`/^[a-z0-9-]{1,40}$/` — il vient d'un client et finit chez tous les autres. Le client
revérifie qu'il existe dans son catalogue, sinon un identifiant inconnu rendrait un joueur
invisible.

**Deux valeurs identiques ne peuvent pas être en désaccord.** Ce défaut-là a survécu à
tous les tests parce que les deux navigateurs du banc portaient le même personnage par
défaut. Un banc qui n'exerce qu'une seule valeur prouve zéro : `duel.mjs` impose désormais
un personnage différent par machine.

**Le client doit DEUX gardes pour ne rien conclure : `enligne` ET `_fin`.** `brancher.js`
annule `jeu.enligne` avant d'ouvrir l'écran de fin ; à l'image suivante, `main.js` retombe
dans ses règles hors ligne. Le trou avait été bouché sur la branche de la LIGNE D'ARRIVÉE
— il frappait le vainqueur d'une course — mais pas sur celle du SEUIL DE MORT, qui frappe
le vainqueur d'une SURVIE : sur Les Hexagones il finit lui aussi sous le seuil. Le serveur
le sacrait premier, puis `perdreManche()` écrasait « MATCH WON » par
« ELIMINATED · 2nd of 16 ». `tools/feel-lab/diag/hex-finale.mjs` le verrouille.

**Pour savoir QUEL chemin a produit un écran, lire un champ qui les DISTINGUE.** La voie en
ligne écrit « 1st of 2 » — l'effectif réel du serveur ; la voie hors ligne écrit « of 16 »,
sa table par défaut. Trois sondes successives ont menti avant celle-là : l'une lisait un
élément supprimé, l'autre jugeait la visibilité sur la mauvaise propriété, la troisième
prenait du texte résiduel du DOM pour un verdict. Un titre décrit ; une signature tranche.

**Une SURVIE ne se gagne pas comme une course, et la fin de manche doit le savoir.** La
condition d'arrêt disait `places >= qualifies` — on gagne en franchissant quelque chose. En
survie on gagne parce que les autres sont tombés, et ce compteur reste à zéro : le duel
continuait après la chute du premier, le survivant jouait seul jusqu'à tomber, et les deux
finissaient éliminés. La manche s'arrête aussi quand **ceux qui restent tiennent dans les
places à pourvoir**, et ils sont alors marqués `qualifie` — pas `elimine` puis repêchés,
sinon le vainqueur reçoit « ELIMINATED » avant de gagner. `serveur/src/manche.js`.

**`largeur` est la largeur de JEU, pas celle du départ.** Les deux divergent sur trois
cartes sur cinq — l'Hexagone annonce 46,8 m pour un départ qui tenait sur une tuile de
3,1 m. Chaque scène déclare donc `depart` : soit une aire (`largeur`, `profondeur`), soit
une liste d'emplacements. `placement.js` **refuse de deviner** et jette si le champ manque :
une carte muette casse un verdict, pas une partie.

**Un verdict qui mesure un joueur en pleine course mesure la CARTE, pas le netcode.** Le
verdict du plongeon est tombé à 2 % — le personnage sprintait, percutait une porte,
retouchait le sol et se relevait avant la fin de la mesure. La même chose à l'arrêt donne
74 %. Poser le geste dans des conditions contrôlées, sinon le chiffre raconte autre chose
que ce qu'on croit.

**Un chiffre trop rond, identique sur deux machines, n'est pas une mesure.** La barre
affichait « 1983 ms » de latence sur les deux écrans, à la milliseconde près : c'était
`(120 − 1) / 60 × 1000`, soit l'historique d'entrées à son plafond parce que plus rien
n'était accusé. `session.detacher()` ne le vidait pas, donc la manche finie survivait au
lobby. Une fonction de mesure doit pouvoir répondre **null** ; l'affichage montre `— ms`.

**Une étiquette écrite en dur dans `index.html` ne se voit jamais dans le code JS.** Le
nom du joueur, `pname`, valait « Baby #2005 » pour tout le monde et sur toutes les
machines — trouvé sur une capture d'écran, pas par un test. Chercher un identifiant
uniquement dans `src/` ne prouve rien : il faut aussi chercher dans le HTML. Un texte de
maquette y est désormais remplacé par `—`, pour qu'une panne se voie au lieu de se cacher
derrière une valeur plausible.

**Une partie à UN joueur se clôt avant sa première image** — une partie s'arrête dès qu'il
ne reste qu'un survivant, et c'est vrai d'emblée. Ce n'est pas un défaut, mais un harnais
qui part d'un joueur unique mesure zéro et accuse le jeu. Mesurer à **deux**. Ça m'a fait
conclure à une perte de 100 % des sauts là où elle était de 38 %.

**Entre `jeu.enligne = null` et `jeu._fin = …`, la boucle n'a AUCUNE garde.** Tout ce qui
JETTE dans le gestionnaire `fin-partie` de `brancher.js` entre ces deux lignes laisse
`main.js` retomber dans ses règles hors ligne à l'image suivante : le vainqueur, posé
au-delà de la ligne, voit « QUALIFIED! » puis le lobby (`mancheSuivante()` sans `partie`
rentre au lobby) ; le perdant, au milieu du parcours, continue de jouer seul. C'est mot
pour mot « renvoyé au lobby sans rien » d'un côté et « encore en partie » de l'autre —
deux symptômes, une exception. Chaque étape avant l'écran est donc isolée (`surement`),
et l'écran monte toujours. Le déclencheur vécu : **`npm start` sans `POLITIQUE=` donne
`DUEL_TEST`, dont le `cible: 2` vaut pour TOUS les modes**, et le ticket par défaut est
une ARÈNE à 2 USDC — le client réglait « une arène partie à deux », `tableEffectif`
refuse sous trois joueurs. Le serveur refuse désormais la mise à l'inscription
(`MISE_IMPAYABLE`, `politique.js:misePayable`) et relève le minimum de départ à trois
dès qu'un pot existe. `diag/franchir-rondin.mjs` rejoue les trois cas — et lui seul fait
franchir la ligne CÔTÉ SERVEUR ; `duel.mjs` § 10 tranche au chrono, ce qui n'emprunte
pas le chemin `sorti · qualifie`.

**Le verrou de sortie doit retenir le QUALIFIÉ aussi.** `manche.js:finir` fige le corps
d'un joueur qui franchit exactement comme celui d'un éliminé ; `session.js` ne retenait
que l'élimination, et le vainqueur poussait un corps sans gravité que la correction
rappelait à chaque image. `estSorti` couvre les deux ; `estElimine` reste pour le
spectateur.

**Un pont ne se traverse en courant que s'il est une RAMPE.** Les planches du pont de
cordes (`props.js:pontDeCordes`) étaient posées à plat, chacune à sa hauteur : un escalier
de marches de 15 à 17 cm près des appuis. En montée, à 7,6 m/s, l'arête d'une marche
dépassait le seuil de culbute — le joueur tombait sur un pont, sans obstacle, en marchant.
Signalé par le directeur produit, reproduit SANS NAVIGATEUR : un personnage que
`avancerTick` fait courir tout droit (`serveur/src/monde.js` + `tick.js`, vingt lignes),
en notant chaque changement d'état — c'est la sonde la plus rapide du dépôt pour une
question de terrain. Chaque planche suit désormais la TANGENTE du tablier, visuel et
collider du même angle (`rx` sur le collider, composé dans `poserColliders`). Et le seuil
de jonction, 8 cm au-dessus de la crête, surplombait un tablier déjà affaissé de 17 cm :
le pont garde un APPUI PLAT sous chaque seuil (`appui`). Le premier pont partait aussi de
sept mètres à l'intérieur de l'îlot de départ ; le parcours commence à son bord.

**Les Dalles : poser le pied tremble, s'ENGAGER rompt, se RECEVOIR rompt — et le saut a
une réception (4 septembre 2026).** « Il suffit de courir tout droit et de sauter pour
passer sans chercher le chemin » : une dalle se traverse en 0,32 s, le sursis en durait
0,36 ; et un saut tamponné repart à l'image même de l'atterrissage, avant que la scène ait
vu quoi que ce soit — aucun réglage de dalle ne pouvait y répondre. Trois règles : la
dalle retient le point d'ENTRÉE et rompt sans sursis dès qu'un centre de corps s'en
éloigne de 75 cm (`ENGAGEMENT`) ; elle rompt sous un ATTERRISSAGE (`impact` ≥ 4 m/s,
porté par la position via `character.js:sonde`, que `tick.js` et `main.js` passent à la
place de `position`) ; et `TUNING.jumpLanding` impose un quart de seconde au sol après un
vrai atterrissage avant de resauter — tampon gelé, coyote éteint, récupération de fatigue
suspendue. Le pas de sonde reste possible (une pression de trois à six images fait 20 à
70 cm). **Le premier essai — un carré central — a laissé passer un coureur** : le banc
court à x = −0,90, décalé du centre des dalles, et une ligne droite ne passe pas par le
carré. Mesurer depuis le point d'entrée ne dépend d'aucune trajectoire. Le harnais
`diag/dalles.mjs` pose son marcheur sur le BORD et à 10 cm du sol pour mesurer le sursis
seul ; posé au centre de 30 cm de haut, il déclenchait les deux autres règles.

**L'Hexagone est à R = 1,95 m et 17 m entre étages** (1,80 et 14 avant), demande du
directeur produit qui trouvait la tour serrée. Un trou d'un hexagone fait 6,75 m : hors du
saut, dans le plongeon même épuisé (7,29 m). À 2,00 m la marge tombait à 36 cm et
`diag/hexagone.mjs` refusait — il remesure les deux portées à chaque exécution.

---

## Vérifier

```bash
dotnet test                                   # 120 — modes, dix issues, roue par rang (PATH=$HOME/.dotnet)
cd backend            && npm test             # 154 — grand livre, RLS, retraits, tirage, et la CHAÎNE (factice) : mises, annulation, reprise, brûlage
cd backend            && npm run cycle:local  # le cycle COMPLET sur un validateur local : dépôt, mise, gain, brûlage, retrait (SOL + Token-2022 réels)
cd tools/test-harness && npm test             # 309 — serveur, files, graine de roue, réseau, entrées, tampon, GIGUE, mises, DALLES
cd tools/test-harness && node dalles.mjs      #   7 — les trois règles des Dalles et les deux exploits fermés, sans navigateur
cd tools/test-harness && node marche.mjs rondin 7 # un RAPPORT : un personnage court tout droit sans sauter, où tombe-t-il ?
cd tools/test-harness && node gigue.mjs       #   8 — le netcode à 240 ms d'aller-retour et une coupure de 300 ms toutes les 2 s
cd tools/feel-lab     && node diag/economie.mjs #  87 — les dix lignes, les roues, l'espérance, sans navigateur
cd tools/feel-lab     && node diag/duel.mjs   #  53 — DEUX navigateurs, un duel payant
cd tools/feel-lab     && node diag/boutique.mjs #  45 — la boutique, le post, la possession, sans navigateur
cd tools/feel-lab     && node diag/boutique-ecran.mjs # 25 — le deblocage CLIQUE, la fenetre vers X interceptee
cd tools/feel-lab     && node diag/bascule.mjs #  DEUX navigateurs : présence, suggestion, SWITCH
cd tools/feel-lab     && node diag/partie.mjs #  le BANC solo (hors produit), trois manches
cd tools/feel-lab     && node diag/franchir-rondin.mjs # 37 — un VRAI franchissement vu par le serveur, deux navigateurs
cd tools/feel-lab     && node diag/web3-lobby.mjs http://127.0.0.1:8080 [email mdp]  # 17 — le lobby CONNECTÉ : zéro sans compte, WALLET, dépôt, retrait refusé en clair ; serveurs lancés d'avance
cd tools/feel-lab     && node diag/web3-duel.mjs http://127.0.0.1:8080 emailA mdpA emailB mdpB  # 8 — un duel PAYANT réel : mises, règlement, pot fermé sur devnet, soldes rafraîchis
cd tools/test-harness && node franchissable.mjs # un RAPPORT, pas un test : les 5 cartes
```

Rien ne demande Docker ni base de données. Seuls les deux harnais `web3-*` visent des
serveurs lancés d'avance (`cd backend && npm start`, `cd serveur && npm start`) et des
comptes Supabase confirmés avec de l'USDC devnet.

**Les bancs navigateur (`diag/duel.mjs`, `franchir-rondin.mjs`, `hex-finale.mjs`…) jouent
le jeu COMPILÉ** : le serveur de jeu sert `tools/feel-lab/dist`. Une modification du
client n'y est pas tant qu'on n'a pas refait `npm run build` — j'ai relancé deux fois un
duel qui échouait sur une version que je venais de corriger. Et sous Playwright en rendu
logiciel, un client tourne à ~9 pas de physique par seconde : c'est un client LENT, qui
affame le serveur en permanence. Ce que ces bancs mesurent sur le netcode est donc un cas
extrême, pas le jeu à 60 images par seconde ; `tools/test-harness/gigue.mjs` mesure le
réseau proprement.

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

**Il n'y a plus de partie hors ligne.** PLAY et Entrée entrent dans une file du serveur ;
sans serveur, le bouton reste gris et le ticket dit pourquoi. `Game.startEpisode()` — la
partie solo — survit UNIQUEMENT pour les bancs qui mesurent une carte sans serveur
(`diag/partie.mjs`, les mesures de traversée), appelée par `__probeGame()`, et aucun
bouton ni aucune touche n'y mène. Le portefeuille local de 25 USDC reste le repli de la
CAISSE quand il n'y a pas de backend ; ce n'est pas un mode de jeu.

**Le lobby EST le matchmaking**, et il vit dans `tools/feel-lab/src/matchmaking.js` — pas
dans `lobbyui.js`, qui ne connaît pas le réseau et ne fait que dessiner. Il se connecte au
chargement (la page vient du serveur de jeu, `/etat` le prouve ; sinon `?serveur=` ou
l'adresse mémorisée ; sinon on NE DEVINE PAS, un essai à l'aveugle journalise une erreur
chez tous les harnais sans serveur). Le serveur diffuse la **présence** des neuf files à
tous les connectés (`files`) et, passé `suggererApres`, **suggère** une autre file au
joueur dont le salon ne part pas (`suggestion`) — seulement si sa partie y démarre ou y
devient proposable, jamais pour une mise plus haute, et sans que deux joueurs se croisent
(`matchmaking.js:suggestions`, la seule fonction du serveur à lire deux fois). `basculer`
change de file en un message. Cliquer un autre mode ou une autre table PENDANT l'attente
est la même bascule. `tools/test-harness/files.mjs` le verrouille sous horloge factice,
`diag/bascule.mjs` dans deux navigateurs.

**Quitter une partie, c'est en être éliminé.** Décision produit du 2 septembre 2026. Un
joueur qui ferme l'onglet, quitte par le menu ou perd sa connexion est éliminé de la
manche en cours (`manche.js:abandonner`), classé derrière tous les éliminés et jamais
repêché ; en 1v1, l'autre gagne aussitôt par la règle « ceux qui restent tiennent dans
les places ». Avant, son personnage passait en pilotage automatique et l'adversaire d'un
duel jouait seul contre un pantin jusqu'au chrono. `tools/test-harness/abandon.mjs`.

**Seize places de départ FIXES, une par siège — `placement.js` ne se resserre plus sur
l'effectif.** Le siège 0 est au centre du premier rang, le 1 à sa droite, le 2 à sa
gauche : un duel occupe le milieu, seize remplissent la grille, et le siège 3 est au même
endroit qu'on soit deux ou seize. La grille qui suivait l'effectif mettait deux joueurs
épaule contre épaule, ce que le directeur produit a lu comme « ils spawnent au même
endroit ». **Rien n'est dessiné au sol** : les plots d'un temps (`departvisuel.js`) ont été
retirés le 4 septembre 2026 — le directeur produit voulait les places invisibles.

**Un adversaire naît à l'ORIGINE DU MONDE et n'en bouge qu'une fois animé.** `figurants.js`
crée chaque avatar à (0, 0, 0) et ne le déplace qu'à `update()`, que `main.js` n'appelait
qu'après le décompte : pendant trois secondes l'autre joueur se tenait en T-pose au milieu
du pont de La Course, douze mètres devant le départ. Mesuré à la sonde, pas deviné.
`session.attacher({ placeDe })` le pose sur SA place (le même `placer` que le serveur) dès
la construction de l'arène, et `enligne.avancer(dt)` tourne aussi pendant le décompte.

**La fin de partie est une COUPURE, pas un texte par-dessus la course.** `Game.mode`
passe à `podium` : arène libérée, HUD masqué (`body.podium`), le VAINQUEUR — avec son
personnage, chez le perdant aussi — sur le plateau du lobby, face caméra (`PODIUM_POS`),
et sa danse greffée sur son mixeur (`lobby.js:montrerVainqueur`, la même greffe que
`cine/plan-danse.mjs`). Le panneau de fin et la roue se poussent à droite. Le plateau
rend son avatar au joueur à `enterLobby` et à `startRace`.

**La règle de départ est celle du produit, et `POLITIQUE` par défaut est `PRODUCTION`.**
Décision du 2 septembre 2026 : le 1v1 part à deux, le squad à quatre — pleins, jamais
réduits — ; l'arène part à seize tout de suite, ou dès TREIZE quand trente-cinq secondes
passent sans nouvelle arrivée (une arrivée remet le calme à zéro). **L'accord de tous a été
retiré** : il faisait attendre treize personnes qu'une quatorzième clique. Ce qui rend le
départ réduit défendable, c'est la DIVULGATION — le ticket annonce le pot en fourchette
(13 à 16 mises) avant le clic. `salon.js:departReduit()` publie le décompte, le client
l'affiche. `npm start` sans rien doit donner LE JEU : sous `DUEL_TEST` puis `DEV` par
défaut, une arène partait à deux, et c'est exactement ce que le directeur produit a vu
en jouant. `POLITIQUE=DEV` (`npm run dev`) reste le réglage à deux machines : mêmes
formes, minimums à deux, calme de huit secondes.

Le serveur **importe les vrais modules du jeu**, pas une réécriture : une simulation
« serveur » séparée divergerait au premier réglage, et ce jour-là la prédiction du client
cesserait de coller sans que rien ne le signale.

En ligne, **le client ne décide de rien** : ni la carte ni la graine (le serveur les
impose), ni la chute, ni la qualification, **ni le barème** — le mode et la variante de
roue viennent du salon. Il **prédit** son déplacement, et c'est tout.

`main.js` a **six points d'accroche netcode** (`imposee`, `enligne`, `attacher`,
`envoyer`, `noterPas`, `avancer`), **deux de lobby** (`jouer`, `surAbandon`, posés par
`matchmaking.js`) et **deux d'argent** (`engagerEnLigne`, `reglerPartie`) — la mise part
au lancement de la manche 1, le gain est versé au classement rendu par le serveur. Tout le
netcode vit dans `tools/feel-lab/src/enligne/`. Ce fichier est édité par plusieurs mains :
ne pas y installer de logique réseau.

**UNE ENTRÉE PAR PAS DE PHYSIQUE, et le serveur les joue TOUTES, dans l'ordre, une par
sous-pas (4 septembre 2026).** Le serveur rejouait la dernière entrée reçue à chaque tick
sans attendre les suivantes, en accusant toujours le même numéro : sa position « à
l'entrée N » portait l'aller-retour COMPLET — 34 cm à 45 ms en local, ce qu'on tolérait
sans le comprendre ; 2 m et plus depuis les Canaries, soit le seuil de recalage sec,
vingt fois par seconde. Le directeur produit a filmé « 153 resyncs », le personnage
téléporté d'un bout à l'autre de la carte et la caméra qui suit. Le client numérote
désormais une entrée par `world.step()` — pas par image rendue, un écran à 120 Hz en
envoyait deux par pas — et note sa position après chacun (`noterPas`) ; le serveur les
range dans un **tampon par joueur** (`serveur/src/tampon.js`) et chaque sous-pas en tire
une. Après l'entrée N, les deux côtés ont joué les mêmes pas : l'écart ne porte plus la
latence. `tools/test-harness/gigue.mjs` le prouve à 240 ms d'aller-retour avec une
coupure de 300 ms toutes les deux secondes : médiane 2 à 4 cm, zéro recalage — la
MÊME barre que sans latence.

**Le tampon extrapole en famine, et SAUTE ensuite ce qu'il a extrapolé.** Quand la file
est vide (paquet en route, coupure TCP), il rejoue les derniers axes — jamais un bouton —
et garde l'accusé en place : le client, lui, ne compare rien tant que l'accusé n'a pas
bougé. Chaque pas extrapolé est une DETTE ; à la reprise, le tampon saute autant
d'images en attente (boutons reportés sur la première gardée), sinon le serveur aurait
joué la coupure deux fois et le joueur serait propulsé de 2 m. La réserve d'avance (la
« cible », 2 à 12 images, adaptative) ne se reconstitue que quand le joueur est
IMMOBILE — au décompte, à l'arrêt — parce que c'est là que ça ne coûte rien ; un joueur
qui court ne paie jamais d'attente. Trente-trois millisecondes de latence ajoutée sur un
réseau propre, jamais de téléportation sur un mauvais.

**Une correction s'applique au CORPS d'un coup, au VISUEL en douceur, et à l'HISTORIQUE
tout de suite.** Déplacer le corps petit à petit produisait deux choses : des expulsions
du solveur (un corps déplacé en contact profond), et des positions notées « ni avant ni
après » qui faisaient mesurer à chaque accusé un écart né de la correction précédente —
entre un et trois mètres, sans jamais converger. Désormais `reconciliation.js` pose le
corps sur l'écart, `decalageVisuel` (sur le personnage) porte la différence avec ce qu'on
affiche et fond en 150 à 500 ms, la caméra suit `positionVisuelle`, et `lien.decaler`
répercute l'écart sur toutes les positions notées après l'accusé. Sans ce dernier point,
la même correction se réappliquait à chaque instantané tant que des entrées étaient en
vol : à 500 ms, dix fois, et le personnage partait en spirale à plusieurs centaines de
mètres. Mesuré au banc avant chaque correctif, pas deviné.

**Pas de correction pendant le décompte, et la réapparition se PRÉDIT.** Le serveur
simule dès qu'il annonce la manche, le client un aller simple plus tard : pendant ce
temps le personnage tombe de sa place (2,4 m) au sol (0,8 m), et comparer nos premiers
pas aux siens appliquait 1,6 m vers le bas à un corps déjà posé — sous le sol, chute
sans fin. Tant que `tick` vaut zéro, personne ne bouge une fois posé : rien à corriger.
Et en course, tomber sous `killY` repose sur le dernier point de passage des DEUX côtés
(même `checkpointFor`, même `respawn`) ; ne pas le prédire laissait le client tomber tout
l'aller-retour puis le reposait sous la plate-forme, d'où il retombait — c'était le
« bug de caméra quand je tombe dans le vide ». En survie, tomber est une élimination :
elle reste au serveur.

**Le décor du client tourne EN AVANCE de la latence mesurée, et la caméra SAUTE avec le
personnage.** Deuxième vidéo du 4 septembre, sur Le Rondin : « ça me téléporte partout ».
Tout y est piloté par l'horloge — troncs, barils à 8 m/s — et `tempsMonde` tenait
l'heure de l'instantané, soit un aller simple de retard, alors que le serveur joue
l'entrée un aller-retour plus le tampon plus tard : à 400 ms, un baril est à 3 m de là
où le serveur le tient, il vous culbute là où vous l'aviez esquivé, écart de 3 m,
recalage, quatre fois par seconde. `tempsMonde` ajoute désormais `latence` (les entrées
en vol, tampon compris) : les contacts se prédisent là où le serveur les arbitrera. Et
une réapparition ou un recalage sec posent `snapCamera` : lissée, la caméra mettait
plusieurs secondes à rejoindre le point de passage en traversant la carte — c'est ce
voyage qu'on voyait, pas le personnage.

**Un message arrivé pendant la vérification de `bonjour` est mis en attente, pas
jeté.** La vérification du jeton est un aller-retour HTTP ; sur un réseau qui relâche
par rafales, `rejoindre` peut arriver dans la même milliseconde que `bonjour`, et il se
perdait : PLAY ne faisait rien. `serveur.js` les garde (32 au plus) et les rejoue dans
l'ordre une fois le joueur connu.

**`Game.mode` est l'état de la boucle** (`lobby` / `racing` / `finished` / `podium`), publié par
`__probeGame()` et attendu par les deux harnais navigateur. Le format de partie s'appelle
`Game.format`. Les confondre a suffi à figer `diag/duel.mjs` cinq minutes sur une attente
qui n'arrivait jamais : le serveur jouait, la page répondait « duel ».

Le protocole vit dans le jeu et le serveur l'importe de là — comme `moteur.js` (Three,
Rapier) et `economie.js`. Une copie de chaque côté divergerait, et un décodeur qui lit un
octet de trop rend des positions plausibles mais fausses.

---

## En ligne

**Le jeu est déployé sur Fly.io** (`deploy/`), depuis le 4 septembre 2026 : `tumble-bg-jeu`
(public, WebSockets, une machine jamais éteinte) et `tumble-bg-backend` (privé, joint par
`http://tumble-bg-backend.internal:8787`). Les secrets partent du `.env` par
`deploy/fly/deployer.sh`, sans s'afficher. Le jeu est compilé DANS l'image avec les deux
variables Supabase publiques ; `npm ci --include=dev` y est obligatoire,
`NODE_ENV=production` ferait sauter Vite.

**Deux domaines, deux hébergeurs, un seul nom de marque (4 septembre 2026).** Le jeu est
sur **`https://play.babyguy.dev`** (Fly, `tumble-bg-jeu` ; `tumble-bg-jeu.fly.dev` répond
toujours, même machine, mais ce n'est plus l'adresse qu'on publie). La page d'accueil est
sur **`https://babyguy.dev`** (Vercel, projet `babyguy`, dépôt
[Whiskerweb/babysite](https://github.com/Whiskerweb/babysite), statique, `www` en 308 vers
l'apex). Le DNS de `babyguy.dev` est chez Vercel, donc les enregistrements du jeu se
posent en `vercel dns add`. **Les deux dépôts restent séparés** : le site se met en ligne
en trente secondes, le jeu demande dix minutes de build, et les mêler ferait payer l'un
pour l'autre à chaque commit.

**Un CNAME Fly pointe sur l'hostname PROPRE À L'APP, pas sur `<app>.fly.dev`.** `CNAME
play → tumble-bg-jeu.fly.dev` ne rend que l'IPv4 PARTAGÉE : le trafic arrive, mais le
certificat reste `Not verified` indéfiniment et rien ne dit pourquoi. La bonne cible est
`<id>.tumble-bg-jeu.fly.dev`, que `fly certs setup <domaine>` donne, et qui porte l'A et
l'AAAA dédiés. Un certificat créé AVANT que le DNS soit juste ne se rattrape pas non
plus : `fly certs delete` puis `create` une fois les enregistrements en place.

**`ORIGINE_AUTORISEE` est le domaine PUBLIÉ, pas le nom Fly.** C'est l'origine que porte
le navigateur d'un joueur venu du site. Le script la dérive de `DOMAINE` (`DOMAINE_JEU`
pour la changer), et ce n'est qu'une seule chaîne : elle ne peut pas autoriser les deux
noms à la fois.

**Le site dit `devnet` parce que le backend déployé est sur devnet.** `NETWORK` dans
`src/data/site.ts` du dépôt du site et `SOLANA_RESEAU` dans `deploy/fly/backend.toml`
**bougent ensemble**. Les six boutons or de la page envoient miser ; tant que l'USDC sort
d'un robinet public et ne vaut rien, la page l'écrit — pastille de la section Play, FAQ,
pied de page. Le jour où l'on passe en mainnet, changer l'un sans l'autre fait mentir la
page dans un sens ou dans l'autre.

**Le tableau des gains du SITE ne dit plus ce que le jeu paie.** `payouts` promet 25,00
fixes au premier d'une arène à 5 USDC ; le jeu tire le gain du vainqueur sur une roue et
paie de 12,50 à 39,50 (espérance 23,37). La colonne `×5` / `×2,5` est un multiplicateur,
que le jeu lui-même s'interdit de montrer à un joueur. C'est signalé dans le README du
site et **pas corrigé** : les dix lignes sont des données produit, et les vrais intervalles
sortent de `node diag/economie.mjs`.

**UN SEUL backend à la fois sur les wallets de trésorerie.** Le backend de Fly et un
backend local lancé « pour voir » signent avec les mêmes clés sur la même base : c'est
le double paiement dont on ne se relève pas. Quand Fly tourne, on n'a pas de backend
local — ou on lui donne d'autres wallets et une autre base.

**Le build du jeu dépasse dix minutes** (three, rapier, playwright sans navigateurs, puis
les dépendances Solana) : `fly deploy` en arrière-plan, jamais en avant-plan avec un
délai court.

---

## Avant le mainnet

Liste complète en bas de `backend/README.md`. En résumé : serveur autoritatif et
`MatchResult` **signé** (faits le 2 septembre 2026 — le backend ne croit plus le
navigateur), journal de replay, géo-restriction, gestion de clé sérieuse (KMS pour cinq
clés désormais), un vrai marché BG/USDC et Jupiter à la place du pool maison, un RPC payé,
validation juridique.

La signature couvre **le mode, la mise, l'effectif, la graine de roue et le classement**,
plus un horodatage : ce sont eux qui disent quelle ligne du tableau paie. Un résultat signé
qui ne couvrirait pas la graine laisserait un intermédiaire en essayer jusqu'à tomber sur
JACKPOT.

La validation juridique n'est pas une question d'ingénierie et aucun code de ce dépôt ne la
tranche.
