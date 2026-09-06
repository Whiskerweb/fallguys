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
| `backend/` | **L'argent.** Supabase, grand livre, USDC sur Robinhood Chain (un wallet par joueur, un par partie), le jeton BG et son brûlage, la page `/suivi`. |
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

**LA BOUTIQUE A QUATRE ARTICLES, ET TROIS COÛTENT DES USDC (5 septembre 2026).** On
commence avec **Pepe** (`char-grenouille`, en tête du catalogue, gratuit). BabyTrump se
gagne toujours en publiant un post sur X (décision du 2 septembre). BabyMusk (Elon,
15 USDC), BabyNetan (Netanyahou, 12) et CyberLeek (ex-Captain Leeky, 10) **s'achètent**,
et **« tous les revenus liés serviront à buy and burn le token »** : le prix va du wallet
de jeu du joueur au wallet FRAIS — le même que le rake — et le brûlage l'y trouve. La
boutique l'écrit sous chaque prix et renvoie au suivi en direct,
`https://play.babyguy.dev/api/suivi` (`LIEN_SUIVI`). `boutique.js` tient la règle et
l'état, `lobbyui.js` le dessin (une grille de cartes, un bouton par état), `cosmetics.js`
refuse d'équiper ce qui n'est pas possédé — le garde est dans le catalogue et pas
seulement dans l'écran. Le défaut du catalogue est le premier personnage **portable**.

**Un achat est un chemin d'ARGENT, donc il vit au backend et nulle part ailleurs.** Le
navigateur dit un ARTICLE, jamais un prix : `POST /boutique/acheter` fait payer au prix de
`backend/src/boutique.js` (la source ; le prix du navigateur est une copie que
`diag/boutique.mjs` compare mot pour mot), livre d'abord (genre `achat`, joueur → rake),
chaîne ensuite (virement wallet du joueur → FRAIS, objet `achat`), et rend la POSSESSION
(`/moi` → `possessions`). **Une tentative, une clé** : un achat refusé par la chaîne est
remboursé, et le retenter avec la même ref retrouvait le mouvement déjà posé sans
débiter, la chaîne payant quand même — `test/boutique.mjs` l'a attrapé ; la ref porte
l'identifiant de la tentative (`purchases.ref`). Le premier clic ARME le bouton
(« CONFIRM 15 USDC »), le second paie : de l'argent réel part sur un clic, un seul clic
est un clic de trop.

**Un skin payant ne se porte que si le BACKEND le dit — sauf sur un banc.** Tant que le
serveur de jeu n'a pas dit qu'il y a de l'argent derrière lui (`bienvenue.argent`), la
mémoire locale vaut aussi pour les skins payants : c'est ce qui laisse les harnais
s'habiller (`dossierDeBanc`, `duel.mjs` porte BabyMusk sur machine-2). Dès que le serveur
dit oui, seules les `possessions` du backend comptent, et `cosmetics.js` fait retomber ce
qu'on porte si ce n'est plus permis. Et le SERVEUR DE JEU ne relaie un skin payant qu'à
qui l'a payé : à `rejoindre`, avec un pont, il demande `/interne/possessions` — une
mémoire locale bricolée ne fait pas porter BabyMusk aux yeux des autres.

**BABYVLAD EST LE CADEAU DE BIENVENUE, et il ne se vend pas (directeur produit, 5 septembre
2026).** Le modèle s'appelle `char-tinytrader` (Vlad Tenev, le patron de Robinhood). À la
première arrivée dans le lobby — la porte vient de se fermer sur une session, avec de
l'argent derrière le serveur —, une boîte plein écran attend un clic (`cadeau.js`) ;
l'ouvrir reçoit le skin (`boutique.js:recevoirCadeau`, article `condition: 'cadeau'`,
prix `GIFT`) et l'ÉQUIPE. Puis, SANS CLIC, le guide de dépôt s'ouvre — pour TOUT LE
MONDE, anciens inscrits compris (demande du 5 septembre 2026) : ce qui distingue « déjà
vu » n'est pas la date d'inscription mais la boîte ouverte dans ce navigateur ; avec un
solde, le guide le dit et se ferme en un clic. Deux déclencheurs : la porte qui se ferme,
et le backend qui reconnaît la session (`main.js:apresCompte`), parce qu'une session
déjà ouverte au chargement ne ferme aucune porte. Une autre session l'avait mis en vente à 10 USDC quelques minutes avant cette
décision : **ne pas le remettre en boutique payante**, c'est un choix produit. Déclaratif
et local comme le post (un cosmétique, aucun centime) ; `?cadeau` force la boîte sur un
banc, et `diag/cadeau-ecran.mjs` joue l'arrivée entière. La boîte FLOTTE : Playwright
la clique avec `force: true`.

**LE GUIDE DE DÉPÔT (`depot.js`, « ADD FUNDS ») : USDC, USDG ou ETH, en trois étapes,
et le change se fait DANS LE WALLET DU JOUEUR.** Le grand livre reste en USDC et le
wallet de jeu doit en détenir pour que la mise parte : USDG et ETH passent par un
routeur de DEX (interface Uniswap V2) appelé depuis le navigateur avec l'ADRESSE DE
DÉPÔT comme destination du swap (`compte.js:deposerParSwap`, `swapETHForExactTokens` /
`swapTokensForExactTokens` : le joueur choisit la SORTIE en USDC, on calcule l'entrée par
`getAmountsIn`, 1 % de marge rendue par le routeur). Le guetteur voit arriver des USDC
ordinaires ; le backend n'a rien de nouveau à tenir. Les adresses (`USDG_ADRESSE`,
`SWAP_ROUTEUR_ADRESSE`, `SWAP_WETH_ADRESSE`) partent par `/moi` → `chaine.usdg`,
`chaine.swap` ; VIDES sur le testnet, où ces deux chemins sont grisés avec la raison et
où le robinet est en tête. Les soldes du wallet sont lus sur le RPC public et le jeton
le mieux garni est pré-choisi ; 10 USDC par défaut. Après la signature, le guide
interroge `releverDepots` toutes les quatre secondes jusqu'au crédit, puis PLAY. Le
panneau WALLET garde le chemin expert et ouvre le guide par ADD FUNDS ; la note sous
PLAY l'ouvre aussi quand le solde manque.

**Le post porte le lien PUBLIÉ du jeu, `https://play.babyguy.dev`, et rien d'autre.**
`LIEN` est renseigné dans `boutique.js` depuis que le domaine pointe sur le jeu
(4 septembre 2026) ; il est resté vide avant, parce qu'une URL bidon aurait envoyé les
premiers curieux sur une page morte — et c'est le seul clic qu'ils feront. `COMPTE_X`
reste vide tant qu'aucun compte X du jeu n'existe ; `lienDePost()` ajoutera `via=`
d'elle-même le jour où il sera renseigné. `diag/boutique.mjs` et `boutique-ecran.mjs`
tiennent les deux.

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

**UNE SEULE PORTE D'ARRIVÉE, la même sur les quatre courses, les pieds au sol
(`src/arrivee.js`, directeur produit, 6 septembre 2026 : « plus de truc qui vole on ne
sait comment, propre, comme Fall Guys »).** Deux piliers rayés aux couleurs de la carte,
une enseigne « FINISH » suspendue à deux poutres, un damier au sol. Trois règles : RIEN
NE FLOTTE (chaque pièce est accrochée à la suivante jusqu'au sol — plus de guirlande
tendue en l'air, c'est elle qui « volait » sur trois cartes) ; le damier est centré sur
`finishZ`, LA cote que `main.js` compare (sur Les Dalles l'ancienne arche était deux
mètres derrière la ligne) ; et les piliers sont DANS l'emprise de la piste — sur La
Course elle vole à dix-neuf mètres au-dessus du relief, un pilier « à côté » n'a rien
sous lui. L'appelant donne l'ENTRAXE et répond de ce qu'il y a dessous ;
`diag/arrivees.mjs` sonde le sol sous chaque pied au rayon. L'enseigne est une texture
PEINTE (`finish-sign.jpg`, OpenRouter, choisie à l'œil parmi quatre), avec un repli au
canevas ; les piliers prennent `candyStripes`, et PAS `hazardStripes` : celle-ci rend la
texture peinte orange dès que le fichier existe, quelles que soient les couleurs
demandées. Les modèles Meshy `finish-arch` et `jungle-finish-gate` ne sont plus dans le
manifeste — les fichiers restent sur le disque.

**Les secrets ne sortent jamais.** `.env` est ignoré par git. Ne jamais afficher une valeur
— seulement des noms de variables et un statut renseigné/vide. Les wallets de trésorerie
sont NOTÉS avec leurs secrets dans `backend/wallets/<réseau>.json`, ignoré lui aussi ;
c'est la note demandée par le directeur produit, pas une copie de travail.

---

## L'argent est sur la chaîne — ROBINHOOD CHAIN (5 septembre 2026)

**Le jeu a QUITTÉ SOLANA pour ROBINHOOD CHAIN, et c'est une décision du directeur produit
(5 septembre 2026) : « supprime tout le solana et passe en mode robinhood, testnet pour
commencer ».** Robinhood Chain est un Layer 2 d'Ethereum (Arbitrum Orbit) : gaz en ETH,
contrats EVM, explorateur Blockscout. Testnet chainId 46630
(`https://rpc.testnet.chain.robinhood.com`, `https://explorer.testnet.chain.robinhood.com`,
faucet `https://faucet.testnet.chain.robinhood.com`), mainnet chainId 4663. Les
paramètres vivent dans `backend/src/robinhood/reseaux.js` et partent vers le navigateur
par `GET /moi` : une seule source, sinon le jeu et le wallet du joueur finissent sur deux
chaînes. **Aucune trace de Solana ne doit revenir** : pas de base58 d'adresse, pas de
Phantom, pas de « devnet » — le testnet s'appelle testnet.

**Le navigateur ne parle pas de partie au backend.** C'est le SERVEUR DE JEU qui fait
engager les mises avant le départ et régler le classement à la fin, par des messages
**signés Ed25519** (`serveur/src/argent.js` → `backend /interne/…`). Le backend ne croit
que cette signature, qui couvre le mode, la mise, l'effectif, la graine de roue et le
classement, plus un horodatage. Le client apprend son gain par le message `reglement` et
relit son solde. `caisse.engager` / `caisse.regler` survivent pour le BANC seulement.

**Un wallet par joueur, un wallet par partie, et rien ne se mélange.** Les USDC d'un joueur
sont sur SON wallet dérivé (`adresses.js`, HKDF de `GRAINE_DEPOTS` → clé secp256k1, sel
`tumble/robinhood/depot/v1`) — son adresse de dépôt EST son compte de jeu. Sa mise part
vers le wallet du POT de la partie (dérivé aussi, `tresorerie.pot`), le règlement vide le
pot vers les gagnants et le wallet FRAIS. Chaque partie est lisible sur l'explorateur, et
`verifierChaine()` compare livre et chaîne compte par compte, en tenant compte de ce qui
est en transit.

**UN WALLET DÉRIVÉ N'A JAMAIS D'ETH, ET N'EN AURA JAMAIS.** Sur une chaîne EVM
l'expéditeur paie le gaz ; ici il **signe une autorisation EIP-3009**
(`transferWithAuthorization`, hors chaîne, gratuit) et la CAISSE la soumet et paie. Le
`nonce` de l'autorisation est le hache de la clé du journal `(objet, ref)` : rejouer la
même opération est refusé PAR LE CONTRAT. Le domaine EIP-712 du jeton se LIT sur le
contrat (`name`, `version`) avant de signer — le nôtre répond « 1 », l'USDC de Circle
« 2 » ; signer avec un domaine deviné donne une autorisation refusée sans raison lisible.
USDC de Circle implémente EIP-3009 sur toutes les chaînes EVM : le jour du mainnet, le
même code signe contre le vrai jeton. Si le stable retenu ne l'implémente pas, c'est un
point de la liste d'avant-mainnet, pas une surprise du jour J.

**UN LOT, UNE TRANSACTION, TOUT OU RIEN.** Le contrat `Lot` (`backend/contrats/src/Lot.sol`,
propriétaire : la caisse) enchaîne les appels et annule tout si l'un échoue, en disant
LEQUEL (`AppelRate(index, raison)`). Les seize mises d'une arène partent dans UNE
transaction ; si une seule ne passe pas, aucune n'est partie et il n'y a rien à rendre
sur la chaîne — le joueur fautif est refusé, les autres renvoyés en file. Un règlement à
seize joueurs tient dans une transaction (`OPERATIONS_PAR_TRANSACTION = 20`), le
rachat-brûlage aussi. Sur Solana, chaque mise était une transaction ; ce n'est plus vrai,
et `diag/web3-duel.mjs` vérifie que les deux mises portent le MÊME hache.

**Trois contrats Solidity, compilés par Foundry, versionnés en artefacts.**
`backend/contrats/src/{Jetons,Lot}.sol`, `forge build`, puis `outils/contrats-compiler.mjs`
recopie ABI et bytecode dans `src/robinhood/artefacts.js` — le backend n'a pas besoin de
Foundry pour tourner. `USDCTest` (six décimales, EIP-3009, frappable par son propriétaire
= le Lot, donc la caisse) n'existe que sur testnet et anvil ; `BabyGuy` (BG, un milliard
frappé au constructeur vers le POOL, **aucune fonction de frappe**, `burnWithAuthorization`
pour brûler depuis le pool sans ETH) et `Lot` se déploient tels quels sur mainnet.
`npm run contrats` déploie ce qui manque et écrit `LOT_ADRESSE`, `USDC_ADRESSE`,
`BG_ADRESSE` dans le .env. Modifier un contrat sans recompiler laisse un artefact qui ne
correspond plus à la source : `npm run contrats:compiler`.

**Le livre d'abord, la chaîne ensuite, et le journal entre les deux.** `chain_tx` porte une
ligne par opération, clée `(objet, ref)`, `prevu → signe → confirme | echoue` ; le hache,
le nonce de la caisse et la transaction brute y sont écrits AVANT la diffusion.
`ChaineEchouee` (simulation ratée, refus à l'envoi, ou minée et revert : rien n'a bougé, on
défait au livre) et `ChaineIncertaine` (réseau coupé : peut-être minée, on ne défait RIEN,
`rattraperChaine` relit la chaîne) ne sont pas la même erreur, et les confondre rembourse
une mise qui est bel et bien partie. **La reprise tranche par le reçu, puis par le
NONCE** : sans reçu, si le compteur de la caisse a dépassé le nonce de la transaction,
elle ne sera jamais minée (`echoue`) ; sinon on la rediffuse, et passé dix minutes on la
REMPLACE par une transaction vide au même nonce, plus chère, pour pouvoir dire « échoué »
sans mentir. `executer()` saute les opérations déjà confirmées d'un lot.

**`cacheTimeout: -1` sur tout `JsonRpcProvider`.** ethers met en cache 250 ms les réponses
identiques, dont le nonce de la caisse : deux transactions signées à la suite recevaient
le MÊME nonce et la seconde tombait en « nonce too low ». Vu sur anvil, au premier cycle.
Et `executer()` tient un verrou : une transaction de la caisse à la fois.

**Le guetteur lit les événements `Transfer` du contrat USDC depuis un curseur**
(`chain_curseur`, en repartant trente blocs avant), et la vérification manuelle d'un joueur
relit une fenêtre de vingt mille blocs pour sa seule adresse. Un dépôt est clé par
`hache#index` (deux transferts vers la même adresse dans une transaction sont deux dépôts).
Nos propres envois vers un joueur (gains, mises rendues) sont dans `chain_tx` avec son
`user_id` et ne sont pas des dépôts ; une FRAPPE du robinet est journalisée SANS
`user_id`, précisément pour que le guetteur la crédite.

**LE ROBINET (`POST /robinet`) : des USDC d'essai, testnet seulement.** Personne ne vend
d'USDC de test sur Robinhood Chain ; l'USDC du testnet est le NÔTRE, et le backend en
frappe 20 sur le wallet de jeu du joueur, une fois par heure (`ROBINET_MICROS`,
`ROBINET_DELAI_MINUTES`). Le lobby montre GET TEST USDC quand `/moi` dit `chaine.robinet`.
Sur mainnet, la route répond 404 par construction : le vrai USDC n'a pas de fonction de
frappe. C'est ce qui remplace le faucet Circle de l'époque Solana — un geste humain de
moins.

**Un seul geste humain reste : l'ETH de la caisse.** Le faucet du testnet est derrière une
vérification anti-robot de Vercel : navigateur, pas script. La caisse paie le gaz de
TOUTES les transactions (quelques centièmes de centime chacune sur un Orbit) ; `npm start`
et `npm run contrats` affichent son adresse et préviennent sous 0,002 ETH.

**Si UNE mise ne part pas, la partie est ANNULÉE et tout le monde est remboursé.** Un refus
au LIVRE (solde insuffisant) annule AVANT de toucher la chaîne : inutile de faire partir
des mises pour les rendre. Un refus de la CHAÎNE annule le lot entier ; le serveur renvoie
les innocents en file (`PARTIE_ANNULEE`) et dit sa raison au fautif (`SOLDE_INSUFFISANT`,
`MISE_REFUSEE`).

**Plus de TOP UP.** Le portefeuille local de 25 USDC n'existe que sur un BANC, et c'est le
SERVEUR qui le dit (`bienvenue.argent === false && identite === 'facultative'`) — jamais un
bouton, jamais une URL. Sans compte, le solde vaut ZÉRO et PLAY dit « Sign in to play for
USDC ». `PRODUCTION` exige l'identité (`politique.identite: 'requise'`) et refuse de
démarrer sans `BACKEND_URL` ; une politique de banc écrite à la main dans un harnais ne dit
rien de l'identité et reste un banc.

**Le jeton BG (« Baby Guy ») : 1 000 000 000, ERC-20, sans fonction de frappe.** Les frais
(10 % du pot en moyenne, sur le wallet FRAIS, sur la chaîne) achètent des BG et les brûlent
dans UNE transaction atomique (`brulage.js` : virement USDC frais → pool, puis
`burnWithAuthorization` signé par le pool), dès 1 USDC. Sur le testnet il n'existe aucun
marché pour un jeton neuf : le service tient sa propre réserve (wallet POOL, BG + USDC) et
applique le produit constant — le prix se lit sur la chaîne, dans les soldes du pool. Sur
mainnet, le rachat devient un appel au routeur d'un DEX de Robinhood Chain et rien d'autre
ne bouge. **Le prix se dit en BG pour 1 USDC** (`bgParUsdc`) : en USDC par BG il vaut zéro
au micro près.

**Les amounts de BG sont des micros aussi** (six décimales) : 10^15 unités au plus, sous
`MAX_SAFE_INTEGER`. Les produits intermédiaires du prix passent par `BigInt`.

**`config.js` lit l'environnement à l'import, et les imports sont hissés.** Poser
`process.env.X` en tête d'un script ne sert à rien si un import statique charge `config.js`
avant : `test/env.mjs` est le PREMIER import de `aide.mjs`, et `outils/cycle.mjs` importe
tout en dynamique, dans l'ordre. Les clés de test (`Buffer.alloc(32, n)`) sont des clés
CONNUES : ne jamais les prendre pour une preuve, et `cycle --local` pose SES clés de banc,
jamais celles du .env, sur anvil.

**`npm run cycle:local` lance anvil lui-même** (Foundry, `~/.foundry/bin`), déploie les
trois contrats, frappe l'USDC, et joue dépôt → mises → règlement → brûlage → retrait avec
le grand livre sur PGlite. Sept transactions, zéro écart. C'est LA preuve que ce que
`chaine.js` construit passe sur une EVM ; `npm test` prouve les chemins du domaine sur la
chaîne factice.

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

**On entre aussi PAR WALLET — « Sign in with Ethereum » — et c'est un COMPTE, pas une
liaison.** Fournisseur Web3 (Ethereum) de Supabase ; `compte.js:connecterAvecWallet` fait
signer au wallet injecté (`window.ethereum` : MetaMask, Rabby, Robinhood Wallet…) un
message EIP-4361 qui nomme le domaine, l'URI, la chaîne et l'instant, et Supabase rend une
session comme pour un e-mail. La chaîne sur laquelle le wallet se trouve n'a pas
d'importance pour SIGNER : on ne demande pas au joueur de changer de réseau pour entrer.
Le même bouton inscrit et connecte. Ce compte n'a pas d'e-mail — le nom vient du
formulaire (onglet CREATE) ou de l'adresse raccourcie. La phrase `statement` ne doit pas
contenir de retour à la ligne (le format l'interdit). **Se connecter par wallet ne lie PAS
ce wallet aux retraits** : qui je suis et où va l'argent restent deux preuves, la seconde
passe par `lierWallet` (`personal_sign`, vérifié par `ethers.verifyMessage` au backend).
L'icône du bouton est un pictogramme de portefeuille SANS marque (`icons/wallet.svg`) :
le bouton vaut pour tout wallet EVM. Aucun harnais ne signe avec un vrai wallet (il n'y en
a pas en headless) ; ce qui se vérifie sans wallet, c'est le bouton, et le message clair
quand le navigateur n'en a pas. Il faut `https://play.babyguy.dev` dans Authentication →
URL Configuration de Supabase, sinon « URI which is not allowed ».

**PLUSIEURS WALLETS INSTALLÉS : ON NE PREND PLUS `window.ethereum`, ON FAIT CHOISIR
(EIP-6963, 5 septembre 2026).** Deux extensions (MetaMask et Phantom, Rabby et
Coinbase…) posent chacune `window.ethereum` et se le renvoient : « je me trompe de
wallet, je refais » finissait en « Maximum call stack size exceeded » (directeur
produit). Chaque wallet S'ANNONCE (`eip6963:announceProvider`) avec son propre
`provider` ; `compte.js` garde la liste, la porte montre un bouton par wallet quand il y
en a plus d'un (`#porte-wallets`), et `walletNavigateur()` rend le CHOISI — mémorisé
par `rdns` dans `tumble-wallet` — pour la signature, le dépôt et le swap. Un seul
wallet, ou un wallet muet : `window.ethereum` reste le repli. `diag/wallets.mjs` le
verrouille sans navigateur, avec un `window.ethereum` piégé qui explose si on l'appelle.

**DEPOSIT FROM WALLET : le parcours court demandé par le directeur produit.** Le joueur
tape un montant, le lobby met son wallet sur Robinhood Chain (`wallet_switchEthereumChain`,
et `wallet_addEthereumChain` avec les paramètres venus de `/moi` s'il ne la connaît pas),
puis lui fait signer un `transfer` ERC-20 vers son adresse de dépôt
(`compte.js:deposerDepuisWallet`). Le joueur paie CE gaz-là (des centimes) ; le guetteur
crédite dès qu'il voit la transaction, CHECK DEPOSITS l'accélère. Pas d'adresse à
recopier. Le wallet de jeu reste : pas de signature par partie, ce qui était la condition
du directeur produit (« si c'est le cas on fait pas »).

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

**Changer de chaîne, c'est repartir de zéro sur les données d'essai.** Les soldes du grand
livre étaient adossés à des wallets Solana qui n'existent pas ici ; `sql/004_robinhood.sql`
amène le SCHÉMA (colonnes `nonce`, `tx_brute`, `bloc`, `dernier_robinet_le`,
`chain_curseur`) mais n'efface rien — une migration jouée à chaque démarrage ne doit rien
détruire. C'est `npm run purger -- --oui` qui efface, une fois, à la main, et JAMAIS sur
mainnet. `joueurDe` re-dérive `adresse_depot` à la première requête d'un profil né sur
l'ancienne chaîne. L'ancienne note `backend/wallets/devnet.json` reste sur le disque,
hors dépôt, avec ses secrets sans valeur.

**Les comptes d'essai vivants** sont `tumble.probe.9f3a1c@gmail.com` et
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

**Une réapparition pose la caméra sur la NOUVELLE position, et le vide ne la bouge
pas.** « Quand on tombe dans le vide, la caméra est mise en haut » (directeur produit,
4 septembre 2026). Tracé au banc : la caméra se posait sur la position clonée AVANT la
réapparition — 5 m au-dessus de `killY` —, l'altitude lissée `ySlow` s'y initialisait, et
l'image suivante lisait une « montée » de 13 m : caméra à 20 m au-dessus du joueur,
plusieurs secondes à redescendre. `pos.copy(position)` après `respawn`, et `snapCamera`
repart d'un `ySlow` neuf. Et pendant la chute, `updateCamera` ne bouge plus dès que le
personnage est en l'air 3,5 m sous son dernier sol (course seulement : en survie, tomber
d'un étage est le jeu). Un saut culmine à 2,15 m, aucune marche ne descend de 3,5 m.

**La roue rangée sous l'écran est aussi INVISIBLE.** Son curseur est posé au-dessus du
disque : à 100 % de translation, sa tête dépassait en bas du lobby — « ce truc en bas
de l'écran ». `visibility` bascule après la descente, sans délai à la montée.

**L'Hexagone est à R = 1,95 m et 17 m entre étages** (1,80 et 14 avant), demande du
directeur produit qui trouvait la tour serrée. Un trou d'un hexagone fait 6,75 m : hors du
saut, dans le plongeon même épuisé (7,29 m). À 2,00 m la marge tombait à 36 cm et
`diag/hexagone.mjs` refusait — il remesure les deux portées à chaque exécution.

---

## Vérifier

```bash
dotnet test                                   # 120 — modes, dix issues, roue par rang (PATH=$HOME/.dotnet)
cd backend            && npm test             # 190 — grand livre, RLS, retraits, tirage, la CHAÎNE (factice) : mises en lot, annulation, reprise, brûlage, robinet, et la BOUTIQUE
cd backend            && npm run cycle:local  # le cycle COMPLET sur anvil (lancé par le script) : contrats, dépôt, mise, gain, brûlage, retrait — EIP-3009 réel
cd tools/test-harness && npm test             # 309 — serveur, files, graine de roue, réseau, entrées, tampon, GIGUE, mises, DALLES
cd tools/test-harness && node dalles.mjs      #   7 — les trois règles des Dalles et les deux exploits fermés, sans navigateur
cd tools/test-harness && node marche.mjs rondin 7 # un RAPPORT : un personnage court tout droit sans sauter, où tombe-t-il ?
cd tools/test-harness && node gigue.mjs       #   8 — le netcode à 240 ms d'aller-retour et une coupure de 300 ms toutes les 2 s
cd tools/feel-lab     && node diag/economie.mjs #  87 — les dix lignes, les roues, l'espérance, sans navigateur
cd tools/feel-lab     && node diag/duel.mjs   #  53 — DEUX navigateurs, un duel payant
cd tools/feel-lab     && node diag/boutique.mjs #  la boutique : quatre articles, prix = backend, possession, le post, sans navigateur
cd tools/feel-lab     && node diag/boutique-ecran.mjs # le deblocage CLIQUE, l'achat ARME puis refuse sans compte, la fenetre vers X interceptee
cd tools/feel-lab     && node diag/wallets.mjs        # 11 — deux extensions wallet installees : le jeu parle a la CHOISIE, jamais a window.ethereum
cd tools/feel-lab     && node diag/cadeau-ecran.mjs   # 41 — l'ARRIVÉE : la boîte, BabyVlad équipé, le guide de dépôt sans clic (mainnet et testnet, wallet et RPC factices)
cd tools/feel-lab     && node diag/arrivees.mjs       # 33 — les LIGNES D'ARRIVÉE des quatre courses : une porte, sur finishZ, les deux pieds au sol (rayon), aucune guirlande libre, enseigne peinte
cd tools/feel-lab     && node diag/bascule.mjs #  DEUX navigateurs : présence, suggestion, SWITCH
cd tools/feel-lab     && node diag/partie.mjs #  le BANC solo (hors produit), trois manches
cd tools/feel-lab     && node diag/franchir-rondin.mjs # 37 — un VRAI franchissement vu par le serveur, deux navigateurs
cd tools/feel-lab     && node diag/web3-lobby.mjs http://127.0.0.1:8080 [email mdp]  # 19 — le lobby CONNECTÉ : zéro sans compte, WALLET, adresse 0x, robinet, dépôt direct, retrait refusé en clair ; serveurs lancés d'avance
cd tools/feel-lab     && node diag/web3-duel.mjs http://127.0.0.1:8080 emailA mdpA emailB mdpB  # 8 — un duel PAYANT réel : les deux mises dans UNE transaction, règlement, soldes rafraîchis
cd tools/test-harness && node franchissable.mjs # un RAPPORT, pas un test : les 5 cartes
```

Rien ne demande Docker ni base de données (anvil vient de Foundry, déjà installé). Seuls les deux harnais `web3-*` visent des
serveurs lancés d'avance (`cd backend && npm start`, `cd serveur && npm start`) et des
comptes Supabase confirmés avec de l'USDC de test (le robinet du lobby en donne).

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

**Le site (dépôt `babysite`, séparé) parle encore de Solana devnet.** `NETWORK` dans
`src/data/site.ts` du dépôt du site et `ROBINHOOD_RESEAU` dans `deploy/fly/backend.toml`
doivent **bouger ensemble** — et au 5 septembre 2026 le site n'a PAS été mis à jour : il
dit « Solana devnet » là où le jeu est sur Robinhood Chain testnet (pastille de la section
Play, FAQ, pied de page). Ce dépôt-ci n'a aucune trace de Solana ; le site, si, tant que
personne ne l'édite.

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
les dépendances du jeu) : `fly deploy` en arrière-plan, jamais en avant-plan avec un
délai court.

---

## Avant le mainnet

Liste complète en bas de `backend/README.md`. En résumé : serveur autoritatif et
`MatchResult` **signé** (faits le 2 septembre 2026 — le backend ne croit plus le
navigateur), journal de replay, géo-restriction, gestion de clé sérieuse (KMS pour cinq
clés désormais), un stable mainnet qui implémente EIP-3009, un vrai marché BG/USDC sur
un DEX de Robinhood Chain à la place du pool maison, un RPC payé, validation juridique.

La signature couvre **le mode, la mise, l'effectif, la graine de roue et le classement**,
plus un horodatage : ce sont eux qui disent quelle ligne du tableau paie. Un résultat signé
qui ne couvrirait pas la graine laisserait un intermédiaire en essayer jusqu'à tomber sur
JACKPOT.

La validation juridique n'est pas une question d'ingénierie et aucun code de ce dépôt ne la
tranche.
