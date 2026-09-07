# Le backend — comptes, grand livre, USDG sur Robinhood Chain, et le jeton BG

> **Ce service est sur le testnet de Robinhood Chain.** Le code est prêt pour le mainnet
> (section « Passer en mainnet » ci-dessous) ; le basculement est un geste à part, confirmé
> à la main, et la liste du bas de page dit ce qui reste ouvert ce jour-là.

Le jeu ne connaît aucun solde et ne déclenche aucun paiement. Le serveur de jeu produit un
résultat de partie **signé** ; ce service le convertit en mouvements comptables **et en
transactions sur Robinhood Chain**, et lui seul parle à la chaîne.

Robinhood Chain est un Layer 2 d'Ethereum (Arbitrum Orbit) : le gaz se paie en ETH, les
contrats sont des contrats EVM ordinaires, l'explorateur est un Blockscout. Testnet :
chainId **46630**, `https://rpc.testnet.chain.robinhood.com`,
`https://explorer.testnet.chain.robinhood.com`. Mainnet : chainId **4663**. Les paramètres
vivent dans `src/robinhood/reseaux.js`, et partent tels quels vers le navigateur.

---

## Ce qu'il fait

| | |
|---|---|
| **Comptes** | Supabase Auth, **e-mail et mot de passe**, ou **Sign in with Ethereum** (MetaMask, Rabby, Robinhood Wallet…) ; plus un wallet **lié par signature** pour les retraits |
| **Wallet de jeu** | **une adresse Robinhood Chain par joueur, dérivée** — ses USDG y restent, ses mises en partent, ses gains y reviennent |
| **Dépôts** | un guetteur lit les événements `Transfer` du contrat USDG et crédite. On ne balaie pas : le wallet du joueur EST son compte. Depuis le lobby, DEPOSIT FROM WALLET fait signer le transfert dans le wallet du joueur |
| **Robinet** | testnet seulement : `POST /robinet` frappe des USDG d'essai sur le wallet de jeu (un par heure et par joueur) |
| **Parties** | le serveur de jeu fait **engager** les mises (wallets → pot de la partie, **une transaction, tout ou rien**) avant le départ, et **régler** à la fin (pot → gagnants + frais, une transaction), le tout signé |
| **Boutique** | trois skins entre 10 et 15 USDG (`src/boutique.js` fait foi) ; le prix va du wallet de jeu au wallet FRAIS, donc au brûlage. La possession vient d'ici (`/moi`) |
| **Retraits** | depuis le wallet de jeu, vers le wallet lié **uniquement** ; minimum 25 USDG, 24 h avant le premier |
| **Frais** | 10 % du pot en moyenne, sur le wallet FRAIS, sur la chaîne |
| **Brûlage** | dès que les frais atteignent 1 USDG, ils **achètent des BG et les brûlent**, dans une transaction atomique |
| **Suivi** | `/suivi` : parties, volume, frais, BG brûlés, offre restante, transactions — en direct |

---

## Démarrer

```bash
cd backend && npm install
npm run tresorerie          # une fois : génère CAISSE, FRAIS, POOL, la clé du serveur de jeu ; les note dans wallets/
#                             puis de l'ETH sur la caisse : https://faucet.testnet.chain.robinhood.com (geste humain)
npm run contrats            # une fois : déploie Lot, l'USDG d'essai et BG (1 000 000 000, sans frappe) ; écrit les adresses dans le .env
APPLIQUER_SCHEMA=1 npm start # la première fois seulement
npm start                   # lit le .env de la racine tout seul
```

```bash
npm test              # 190 verdicts, aucun réseau : grand livre, RLS, retraits, tirage, chaîne factice, boutique
npm run cycle:local   # le cycle COMPLET sur anvil (Foundry), lancé par le script : dépôt, mise, gain, brûlage, retrait
npm run cycle         # le même sur le testnet — la caisse doit avoir de l'ETH ; l'USDG, on le frappe
npm run contrats:compiler   # recompile les contrats (forge build) et recopie ABI + bytecode dans src/robinhood/artefacts.js
npm run purger -- --oui     # efface les données d'argent d'un réseau d'ESSAI (jamais mainnet) — une fois, à la main
```

**Sur le testnet, un seul geste humain que rien n'automatise :** de l'ETH pour la caisse
(https://faucet.testnet.chain.robinhood.com, l'adresse est affichée au démarrage et par
`npm run contrats`). Le faucet est derrière une vérification anti-robot de Vercel : c'est
un navigateur, pas un script. L'USDG, lui, est le nôtre sur le testnet — pas de tiers.

**Deux réglages dans le dashboard Supabase**, et le second n'est pas optionnel :

1. **Connection string.** Passez par le *pooler* (Settings → Database → Connection pooling)
   avec l'utilisateur `postgres.<ref>`. **Encodez le mot de passe** : un `@` ou un `#` non
   encodé change l'hôte que l'URL désigne.
2. **Confirm email.** Décochez-le (Authentication → Providers → Email) : sinon un compte
   créé n'a pas de session avant que le lien reçu soit cliqué, et le SMTP gratuit est
   limité à quelques envois par heure.

Et pour la connexion par wallet : le fournisseur **Web3 (Ethereum)** activé, et l'adresse
publiée du jeu (`https://play.babyguy.dev`) dans Authentication → URL Configuration —
sinon Supabase refuse le message signé (« URI which is not allowed »).

**TLS.** `src/pool.js` **vérifie** le certificat du pooler contre la CA de Supabase,
épinglée dans `certs/`. Pas de `rejectUnauthorized: false` sur une connexion qui transporte
des ordres de paiement.

Les tests tournent sur **PGlite** — Postgres compilé en WebAssembly, dans le processus
Node — et sur une **chaîne factice** (`src/robinhood/factice.js`) qui offre la même
interface que la vraie, journal compris. C'est ce qui permet de *vérifier* qu'une mise
refusée par la chaîne est rendue au livre, sans ETH et sans réseau.

---

## L'argent sur la chaîne

**Chaque partie se voit sur Robinhood Chain** :

```
wallets des joueurs ──mises (1 tx)──► wallet du POT de la partie ──gains (1 tx)──► wallets des gagnants
     ▲                                                          └─rake─► wallet FRAIS ──rachat──► POOL
     └── dépôt (le joueur envoie, ou le robinet frappe)   retrait ──► wallet lié          BG ──► brûlés
```

- **Un wallet par joueur**, dérivé de `GRAINE_DEPOTS` et de son identifiant (HKDF →
  secp256k1). C'est son adresse de dépôt ET son compte de jeu. Aucune clé privée n'est
  stockée : elles se recalculent. Perdre la graine, c'est perdre l'accès à tout l'argent
  des joueurs.
- **Un wallet par partie** (le pot), dérivé lui aussi. Les mises y entrent au départ ; le
  règlement le vide vers les gagnants et les frais.
- **Un wallet dérivé n'a jamais d'ETH, et n'en aura jamais.** Sur une chaîne EVM,
  l'expéditeur paie le gaz ; ici il **signe une autorisation** (EIP-3009,
  `transferWithAuthorization`), et la CAISSE la soumet et paie. Le `nonce` de
  l'autorisation est le hache de la clé du journal `(objet, ref)` : rejouer la même
  opération est refusé **par le contrat**. USDG de Circle implémente cette interface sur
  toutes les chaînes EVM : le jour du mainnet, le même code signe contre le vrai jeton.
- **Un lot, une transaction, tout ou rien.** Le contrat `Lot` (`contrats/src/Lot.sol`)
  enchaîne les appels et annule tout si l'un échoue, en disant lequel. Les seize mises
  d'une arène partent dans une transaction ; si une seule ne passe pas, **aucune n'est
  partie** et il n'y a rien à rendre sur la chaîne. Un règlement à seize joueurs tient
  aussi dans une transaction.
- **La caisse ne détient pas les USDG des joueurs.** Elle paie le gaz de toutes les
  transactions, et elle possède les contrats.
- **Le livre d'abord, la chaîne ensuite.** Le grand livre est une transaction Postgres,
  atomique et verrouillée ; la chaîne est lente et peut couper. Le livre donne l'état de
  référence, la chaîne le rejoint, et `verifierChaine()` compare les deux, compte par
  compte, en tenant compte de ce qui est en transit. Le résultat est sur `/suivi`.

**Le journal (`chain_tx`).** Chaque opération sur la chaîne a une ligne, clée par
`(objet, ref)`, qui passe par `prevu → signe → confirme` ou `echoue`. Le hache de la
transaction, le nonce de la caisse et la transaction brute y sont écrits AVANT la
diffusion. Après un arrêt brutal, `rattraperChaine()` relit ces lignes et tranche **en
interrogeant la chaîne** : un reçu dit tout ; sans reçu, le nonce de la caisse dit si la
transaction peut encore être minée (on la rediffuse) ou ne le sera jamais (une autre a
consommé son nonce : `echoue`) ; et passé dix minutes sans reçu, elle est **remplacée**
par une transaction vide au même nonce, plus chère, pour la rendre impossible avant de
dire « échoué ». Jamais de re-signature à l'aveugle.

**Deux échecs qui ne sont pas le même.** `ChaineEchouee` : la simulation a échoué, le
RPC a refusé à l'envoi, ou la transaction a été minée et a revert — rien n'a bougé,
l'appelant peut défaire ce qu'il avait écrit au livre. `ChaineIncertaine` : le réseau a
coupé pendant la diffusion ou l'attente — elle est *peut-être* minée, on ne défait RIEN,
la reprise le saura. Confondre les deux, c'est rembourser une mise qui est bel et bien
partie.

**Si UNE mise ne part pas, la partie est annulée.** Le lot désigne l'appel fautif : ce
joueur-là est refusé, les autres sont renvoyés en file par le serveur de jeu. Personne ne
joue pour rien, personne ne joue contre un fantôme.

**Le guetteur** lit les événements `Transfer` du contrat USDG depuis un curseur
(`chain_curseur`), en repartant un peu avant à chaque tour. Les envois que nous faisons
nous-mêmes vers un joueur (gains, mises rendues) sont dans `chain_tx` et ne sont pas des
dépôts ; une frappe du robinet, journalisée sans joueur, en est un.

---

## Les contrats

Trois contrats Solidity dans `contrats/src`, compilés par Foundry (`forge build`), ABI et
bytecode recopiés dans `src/robinhood/artefacts.js` (versionné : le backend n'a pas
besoin de Foundry pour tourner) :

| | |
|---|---|
| `Lot` | l'exécuteur atomique. Propriétaire : la caisse. Ne détient rien, ne signe rien |
| `USDGTest` | l'USDG d'essai, six décimales, EIP-3009, frappable par son propriétaire (le Lot, donc la caisse). **Testnet et anvil seulement** |
| `BabyGuy` | BG, six décimales, EIP-3009, **un milliard frappé au constructeur vers le POOL, aucune fonction de frappe**, `burnWithAuthorization` pour brûler depuis le pool sans ETH |

`Lot` et `BabyGuy` se déploient tels quels sur mainnet ; `USDGTest` n'y est jamais déployé
(`USDG_ADRESSE` désigne alors le vrai jeton). Le domaine EIP-712 d'un jeton se **lit sur
le contrat** (`name`, `version`) avant de signer : le nôtre répond « 1 », l'USDG de Circle
« 2 », et signer avec un domaine deviné donnerait une autorisation refusée sans raison
lisible.

---

## Le jeton BG et le brûlage

**Baby Guy (BG)** : six décimales comme USDG (tous nos montants restent des entiers
sûrs), **1 000 000 000** frappés au wallet POOL à la création, **sans fonction de frappe**.
L'offre ne peut que baisser.

**Le brûlage** (`src/robinhood/brulage.js`) : dès que le wallet FRAIS détient au moins
`BRULAGE_SEUIL_MICROS` USDG, une transaction **atomique** fait deux choses — les USDG vont
au pool, et les BG achetés sont brûlés depuis le pool. Il n'existe aucun état où des BG
achetés ne sont pas encore brûlés. Chaque rachat est consigné dans `burns` avec son hache
et l'offre restante.

**Le prix, sur le testnet, est le nôtre.** Aucun marché n'existe pour un jeton neuf ; le
service tient donc **sa propre réserve de liquidité** (le wallet POOL, BG + USDG) et
applique la règle des marchés automatisés, le produit constant `x · y = k` : pour `u`
USDG, il sort `y · u / (x + u)` BG. Le prix monte à chaque rachat, et il se lit **sur la
chaîne** — ce sont les soldes du pool qui le fixent, pas une constante. Sur mainnet, le
rachat devient un appel au routeur d'un DEX de Robinhood Chain vers une vraie paire
BG/USDG, et rien d'autre ne bouge : seuil, journal, `burns`, page de suivi lisent la même
chose. Le pool devra être **alimenté en USDG** (envoyer au wallet POOL ; le livre le note
en `dotation`).

---

## Le grand livre

Écriture **en partie double**. Chaque mouvement pose au moins deux lignes de signe opposé
dont la somme vaut zéro. L'invariant tient en une requête :

```sql
select sum(amount_micros) from public.ledger_entries;   -- doit valoir 0
```

Comptes : `user:<uuid>` · `pot:<match>` · `treasury:rake` (= le wallet FRAIS) ·
`treasury:pool` (les USDG que le brûlage a déposés au pool) · `treasury:hot` · `chain:in` ·
`chain:out`.

Tout est en **micro-unités entières** (1 USDG = 1 000 000), en `bigint`. Jamais de
flottant — même type et même échelle que `Money.Micros` dans `src/Fallguys.Rules`.

**L'équilibre est tenu par la base, pas par le code appelant** : une contrainte différée
le vérifie au commit.

---

## Ce qui protège la caisse

**Le navigateur ne parle pas de partie.** Le serveur de jeu — qui a simulé la partie et
sait qui a fini où — envoie au backend des messages **signés Ed25519** (`/interne/…`) :
engager les mises d'un salon, régler un classement, annuler. La signature couvre **le
mode, la mise, l'effectif, la graine de roue et le classement**, plus un horodatage (cinq
minutes de validité).

**RLS est la barrière côté base.** Le navigateur reçoit la clé `anon`, publique. Les tables
du grand livre ont RLS activé **et aucune politique** ; le joueur lit son solde par
`public.mon_solde()`, sans paramètre. `burns` est public en lecture — c'est la promesse du
jeton ; `chain_tx` ne montre à un joueur que ses propres lignes.

**Le retrait ne prend pas de destination.** Elle est toujours le wallet lié — une adresse
0x prouvée par `personal_sign`, vérifiée par le backend. Relier un wallet remet le délai
de 24 h à zéro.

**L'idempotence est une contrainte de base, et une contrainte du contrat.** Un dépôt est
clé par `hache#index`, une mise par `(partie, joueur)`, un règlement par la partie, chaque
opération sur la chaîne par `(objet, ref)` — et le contrat refuse un nonce d'autorisation
déjà vu. Rejouer ne paie pas deux fois : la base et la chaîne le garantissent, pas la
prudence du code.

**Une seule instance.** Deux processus qui signent depuis la même caisse se disputent le
même nonce et peuvent envoyer deux fois le même paiement. Ne pas mettre ce service
derrière un autoscaler.

---

## Les routes

| | |
|---|---|
| `GET /moi` · `POST /wallet/lier` · `POST /depots/relever` · `POST /robinet` (testnet) · `POST /boutique/acheter` · `POST /retrait` · `GET /retraits` · `GET /historique` | le joueur, par jeton Supabase |
| `POST /interne/ping` · `/interne/soldes` · `/interne/possessions` · `/interne/partie/engager` · `/interne/partie/regler` · `/interne/partie/annuler` | le serveur de jeu, par signature |
| `GET /bareme` · `GET /boutique` · `GET /stats` · `GET /stats/flux` (SSE) · `GET /suivi` · `GET /verification` · `GET /sante` | public |

Le serveur de jeu relaie `/api/…` vers ce service : le navigateur ne connaît qu'une adresse.
`GET /moi` rend la CHAÎNE (nom, chainId, RPC, explorateur, contrat USDG) : c'est avec elle
que le lobby ajoute le réseau au wallet du joueur et construit le transfert de dépôt.

---

## Hébergement

| Étage | Où |
|---|---|
| Client (`tools/feel-lab`, `vite build`) | servi par le serveur de jeu |
| Base + Auth | Supabase managé |
| Ce service | Fly.io, **un seul conteneur** |
| RPC Robinhood Chain | le RPC public pour l'instant ; Alchemy (`robinhood-testnet.g.alchemy.com`) le jour où il limite |

---

## Passer en mainnet

Robinhood Chain mainnet : chainId **4663**, RPC public `https://rpc.mainnet.chain.robinhood.com`,
explorateur `https://robinhoodchain.blockscout.com`. **Le dollar y est l'USDG** de Paxos
(« Global Dollar », `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, six décimales) — il n'y a
pas d'USDG natif : l'USDG envoyé par le pont Robinhood arrive en USDG. Vérifié sur son
contrat le 7 septembre 2026 : il implémente EIP-3009 (`transferWithAuthorization`, le même
typehash que le nôtre, `authorizationState`), sans `version()` — son domaine EIP-712 est
`{ name: "Global Dollar", version: "1" }`, et `chaine.js` le retrouve en recalculant
`DOMAIN_SEPARATOR`. Le jeu s'écrit « USDG » ; sur mainnet il se renomme « USDG » partout
(`STABLE_SYMBOLE`, servi par `/moi`, `/etat` et `/stats`, appliqué par `devise.js`).

**Fait le 7 septembre 2026** : le jeu est sur mainnet. Lot `0xA1724C07577ec9a36aa05d7e05372AD194C617CD`,
dollar USDG, pas de BG (le jeton se crée sur PONS ; `BG_ADRESSE` et le routeur du marché
viendront après, et le brûlage avec). Les étapes, pour mémoire et pour la prochaine fois :

Dans l'ordre, et rien ne se saute :

1. **Une trésorerie NEUVE.** `node outils/tresorerie.mjs --reseau mainnet --nouvelles` écrit
   `wallets/mainnet.json` sans toucher au `.env`. Les clés du testnet ne servent jamais sur
   mainnet. (Fait le 7 septembre 2026 ; les adresses sont dans le fichier.)
2. **De l'ETH sur la caisse mainnet** — un geste humain : bridger depuis Ethereum ou
   Arbitrum (`portal.arbitrum.io`, Across). Quelques millièmes suffisent : le gaz d'un
   Orbit se compte en centièmes de centime, les trois déploiements coûtent moins de 0,001 ETH.
3. **Des USDG sur le pool** (adresse `pool` de `wallets/mainnet.json`) : c'est la
   liquidité contre laquelle les frais achètent le BG à brûler. Sans elle, le brûlage
   attend et le dit. Le prix de départ du BG, c'est ce montant divisé par un milliard.
4. **Le `.env`** : `ROBINHOOD_RESEAU=mainnet`, `USDG_ADRESSE=` l'USDG ci-dessus,
   `CAISSE_CLE`, `FRAIS_CLE`, `POOL_CLE` recopiées depuis `wallets/mainnet.json`,
   `LOT_ADRESSE=` et `BG_ADRESSE=` VIDES, `ORIGINE_AUTORISEE=https://play.babyguy.dev`.
5. **Les contrats** : `npm run contrats` déploie Lot et BabyGuy (un milliard au pool, sans
   frappe) et écrit leurs adresses. L'USDG d'essai n'est jamais déployé sur mainnet.
6. **La preuve** : `npm run cycle` joue un duel réel à 2 USDG entre deux joueurs d'essai —
   il faut leur avoir envoyé quelques USDG (les adresses s'affichent). Sept transactions,
   zéro écart, ou on n'y va pas.
7. **La base** : `npm run purger -- --oui` AVANT de basculer le `.env` (l'outil refuse sur
   mainnet) : on ne migre pas de l'argent d'essai. Les comptes restent.
8. **Fly** : `JE_CONFIRME_MAINNET=oui APPLIQUER_SCHEMA=1 bash deploy/fly/deployer.sh`. Le
   backend refuse de démarrer sur mainnet avec une clé de test, une origine `*` ou un RPC
   inconnu, et prévient si le pool est vide. Le robinet répond 404 par construction.
9. **Le site** (`babysite`, dépôt séparé) : `NETWORK` et les mentions « test » bougent le
   même jour.

Ce que le passage ne règle PAS, et qui reste à trancher AVANT : la liste ci-dessous.

## Le verrou avant le mainnet

1. ~~Serveur de jeu autoritatif, résultats signés.~~ **Fait le 2 septembre 2026** : le
   navigateur ne déclare plus rien ; `window.__probeGame()` ne peut plus se payer.
2. **Journal de replay archivé** (spec § 6.4). Sans lui, aucun litige n'est arbitrable.
3. **Géo-restriction effective**, France exclue (spec § 5).
4. **Gestion de clé sérieuse** pour `CAISSE_CLE`, `GRAINE_DEPOTS`, `FRAIS_CLE`, `POOL_CLE`,
   `SERVEUR_CLE` — KMS ou signataire matériel. Pas des variables d'environnement, ni
   `wallets/testnet.json`.
5. ~~**Le jeton dans lequel on mise, sur mainnet.**~~ **Réglé le 7 septembre 2026** : l'USDG
   de Paxos implémente EIP-3009, vérifié sur le contrat ; `chaine.js` retrouve son domaine
   EIP-712 sans `version()`.
6. **Un vrai marché pour BG** : une paire BG/USDG sur un DEX de Robinhood Chain, et le
   rachat par son routeur. Tant que le pool est le nôtre, le prix est le nôtre.
7. **Un RPC payé**, avec abonnements WebSocket pour le guetteur.
8. **Validation juridique — et elle a changé de nature le 2 septembre 2026.** Depuis que
   la roue tire le montant APRÈS la partie (décision du directeur produit), le produit
   combine un classement au skill et un tirage au sort du gain une fois la mise engagée :
   c'est le motif exact d'une requalification en jeu d'argent. Ce point doit être tranché
   par un conseil AVANT tout dollar réel. Aucun code de ce dossier ne le tranche.
