# Le backend — comptes, grand livre, USDC sur Solana, et le jeton BG

> **Ce service est en devnet. Il ne doit pas toucher de mainnet.**
> La liste des conditions à remplir avant d'y penser est en bas de page, et elle n'est pas
> facultative.

Le jeu ne connaît aucun solde et ne déclenche aucun paiement. Le serveur de jeu produit un
résultat de partie **signé** ; ce service le convertit en mouvements comptables **et en
transactions Solana**, et lui seul parle à la chaîne.

---

## Ce qu'il fait

| | |
|---|---|
| **Comptes** | Supabase Auth, **e-mail et mot de passe** ; plus un wallet Solana **lié par signature** |
| **Wallet de jeu** | **une adresse Solana par joueur, dérivée** — ses USDC y restent, ses mises en partent, ses gains y reviennent |
| **Dépôts** | un guetteur voit l'arrivée et crédite. On ne balaie plus : le wallet du joueur EST son compte |
| **Parties** | le serveur de jeu fait **engager** les mises (wallet → pot de la partie) avant le départ, et **régler** à la fin (pot → gagnants + frais), le tout signé |
| **Retraits** | depuis le wallet de jeu, vers le wallet lié **uniquement** ; minimum 25 USDC, 24 h avant le premier |
| **Frais** | 10 % du pot en moyenne, sur le wallet FRAIS, sur la chaîne |
| **Brûlage** | dès que les frais atteignent 1 USDC, ils **achètent des BG et les brûlent**, en une transaction atomique |
| **Suivi** | `/suivi` : parties, volume, frais, BG brûlés, offre restante, transactions — en direct |

---

## Démarrer

```bash
cd backend && npm install
npm run tresorerie          # une fois : génère FRAIS, POOL, la clé du serveur de jeu ; les note dans wallets/
npm run jeton               # une fois, avec ~0,01 SOL sur la caisse : crée BG, 1 000 000 000, frappe révoquée
APPLIQUER_SCHEMA=1 npm start # la première fois seulement
npm start                   # lit le .env de la racine tout seul
```

```bash
npm test          # 154 verdicts, aucun réseau : grand livre, RLS, retraits, tirage, chaîne factice
npm run cycle:local   # le cycle COMPLET sur un validateur local : dépôt, mise, gain, brûlage, retrait
npm run cycle         # le même sur devnet — la caisse doit avoir du SOL, les joueurs d'essai des USDC
```

**Sur devnet, deux gestes humains que rien n'automatise :** du SOL pour la caisse
(https://faucet.solana.com, l'adresse est affichée au démarrage) et de l'USDC devnet pour
un wallet de joueur (https://faucet.circle.com, « Solana Devnet »). L'airdrop RPC est
limité par jour et par adresse IP ; le jour où il refuse, c'est le navigateur.

**Deux réglages dans le dashboard Supabase**, et le second n'est pas optionnel :

1. **Connection string.** Passez par le *pooler* (Settings → Database → Connection pooling)
   avec l'utilisateur `postgres.<ref>`. **Encodez le mot de passe** : un `@` ou un `#` non
   encodé change l'hôte que l'URL désigne.
2. **Confirm email.** Décochez-le (Authentication → Providers → Email) : sinon un compte
   créé n'a pas de session avant que le lien reçu soit cliqué, et le SMTP gratuit est
   limité à quelques envois par heure.

**TLS.** `src/pool.js` **vérifie** le certificat du pooler contre la CA de Supabase,
épinglée dans `certs/`. Pas de `rejectUnauthorized: false` sur une connexion qui transporte
des ordres de paiement.

Les tests tournent sur **PGlite** — Postgres compilé en WebAssembly, dans le processus
Node — et sur une **chaîne factice** (`src/solana/factice.js`) qui offre la même interface
que la vraie, journal compris. C'est ce qui permet de *vérifier* qu'une mise refusée par la
chaîne est rendue au livre, sans SOL et sans réseau.

---

## L'argent sur la chaîne

Depuis le 2 septembre 2026, **chaque partie se voit sur Solana** :

```
wallet du joueur ──mise──► wallet du POT de la partie ──gain──► wallets des gagnants
     ▲                                                    └─rake─► wallet FRAIS ──rachat──► POOL
     └── dépôt (le joueur envoie)         retrait ──► wallet lié                      BG ──► brûlés
```

- **Un wallet par joueur**, dérivé de `GRAINE_DEPOTS` et de son identifiant (HKDF). C'est
  son adresse de dépôt ET son compte de jeu. Aucune clé privée n'est stockée : elles se
  recalculent. Perdre la graine, c'est perdre l'accès à tout l'argent des joueurs.
- **Un wallet par partie** (le pot), dérivé lui aussi. Les mises y entrent au départ ; le
  règlement le vide vers les gagnants et les frais, puis **ferme son compte de jetons** : la
  rente revient à la caisse, et le pot ne coûte que les frais de transaction.
- **La caisse ne détient plus les USDC des joueurs.** Elle paie les frais et la rente de
  toutes les transactions (un wallet de joueur n'a pas de SOL et n'en aura jamais : Solana
  permet qu'un autre compte paie), et elle a créé le jeton.
- **Le livre d'abord, la chaîne ensuite.** Le grand livre est une transaction Postgres,
  atomique et verrouillée ; la chaîne est lente et peut couper. Le livre donne l'état de
  référence, la chaîne le rejoint, et `verifierChaine()` compare les deux, compte par
  compte, en tenant compte de ce qui est en transit. Le résultat est sur `/suivi`.

**Le journal (`chain_tx`).** Chaque opération sur la chaîne a une ligne, clée par
`(objet, ref)`, qui passe par `prevu → signe → confirme` ou `echoue`. La signature y est
écrite AVANT la diffusion : c'est la règle apprise sur les retraits, et elle vaut désormais
pour tout. Après un arrêt brutal, `rattraperChaine()` relit ces lignes et tranche **en
interrogeant la chaîne**, jamais en re-signant à l'aveugle.

**Deux échecs qui ne sont pas le même.** `ChaineEchouee` : la chaîne a refusé, ou le
blockhash a expiré sans que la transaction soit vue — rien n'est parti, l'appelant peut
défaire ce qu'il avait écrit au livre. `ChaineIncertaine` : le réseau a coupé pendant la
diffusion — elle est *peut-être* passée, on ne défait RIEN, la reprise le saura. Confondre
les deux, c'est rembourser une mise qui est bel et bien partie.

**Si UNE mise ne part pas, la partie est annulée.** Toutes les autres reviennent, au livre
et sur la chaîne, et le serveur de jeu renvoie tout le monde au lobby avec la raison.
Personne ne joue pour rien, personne ne joue contre un fantôme.

---

## Le jeton BG et le brûlage

**Baby Guy (BG)** : Token-2022, métadonnées sur le mint, six décimales comme USDC (tous
nos montants restent des entiers sûrs), **1 000 000 000** frappés au wallet POOL, **autorité
de frappe révoquée dans la même transaction**. L'offre ne peut que baisser.

**Le brûlage** (`src/solana/brulage.js`) : dès que le wallet FRAIS détient au moins
`BRULAGE_SEUIL_MICROS` USDC, une transaction **atomique** fait trois choses — les USDC vont
au pool, les BG en sortent vers les frais, et sont brûlés. Il n'existe aucun état où des BG
achetés ne sont pas encore brûlés. Chaque rachat est consigné dans `burns` avec sa
signature et l'offre restante.

**Le prix, sur devnet, est le nôtre.** Aucun marché n'existe pour un jeton neuf sur
devnet ; le service tient donc **sa propre réserve de liquidité** (le wallet POOL, BG +
USDC) et applique la règle des marchés automatisés, le produit constant `x · y = k` :
pour `u` USDC, il sort `y · u / (x + u)` BG. Le prix monte à chaque rachat, et il se lit
**sur la chaîne** — ce sont les soldes du pool qui le fixent, pas une constante. Sur mainnet,
`echanger()` devient un routage Jupiter vers une vraie paire BG/USDC, et rien d'autre ne
bouge : seuil, journal, `burns`, page de suivi lisent la même chose. Le pool devra être
**alimenté en USDC** (envoyer au wallet POOL ; le livre le note en `dotation`).

---

## Le grand livre

Écriture **en partie double**. Chaque mouvement pose au moins deux lignes de signe opposé
dont la somme vaut zéro. L'invariant tient en une requête :

```sql
select sum(amount_micros) from public.ledger_entries;   -- doit valoir 0
```

Comptes : `user:<uuid>` · `pot:<match>` · `treasury:rake` (= le wallet FRAIS) ·
`treasury:pool` (les USDC que le brûlage a déposés au pool) · `treasury:hot` · `chain:in` ·
`chain:out`.

Tout est en **micro-unités entières** (1 USDC = 1 000 000), en `bigint`. Jamais de
flottant — même type et même échelle que `Money.Micros` dans `src/Fallguys.Rules`.

**L'équilibre est tenu par la base, pas par le code appelant** : une contrainte différée
le vérifie au commit.

---

## Ce qui protège la caisse

**Le navigateur ne parle plus de partie.** `POST /partie/engager` et `POST /partie/regler`
n'existent plus. Le serveur de jeu — qui a simulé la partie et sait qui a fini où — envoie
au backend des messages **signés Ed25519** (`/interne/…`) : engager les mises d'un salon,
régler un classement, annuler. La signature couvre **le mode, la mise, l'effectif, la
graine de roue et le classement**, plus un horodatage (cinq minutes de validité). C'était
le trou n° 1 de la liste d'avant-mainnet ; il est fermé.

**RLS est la barrière côté base.** Le navigateur reçoit la clé `anon`, publique. Les tables
du grand livre ont RLS activé **et aucune politique** ; le joueur lit son solde par
`public.mon_solde()`, sans paramètre. `burns` est public en lecture — c'est la promesse du
jeton ; `chain_tx` ne montre à un joueur que ses propres lignes.

**Le retrait ne prend pas de destination.** Elle est toujours le wallet lié. Relier un
wallet remet le délai de 24 h à zéro.

**L'idempotence est une contrainte de base.** Un dépôt est clé par sa signature, une mise
par `(partie, joueur)`, un règlement par la partie, chaque opération sur la chaîne par
`(objet, ref)`. Rejouer ne paie pas deux fois : la base le garantit, pas la prudence du code.

**Une seule instance.** Deux processus qui signent depuis les mêmes wallets produisent deux
transactions concurrentes sur le même solde. Ne pas mettre ce service derrière un
autoscaler.

---

## Les routes

| | |
|---|---|
| `GET /moi` · `POST /wallet/lier` · `POST /depots/relever` · `POST /retrait` · `GET /retraits` · `GET /historique` | le joueur, par jeton Supabase |
| `POST /interne/ping` · `/interne/soldes` · `/interne/partie/engager` · `/interne/partie/regler` · `/interne/partie/annuler` | le serveur de jeu, par signature |
| `GET /bareme` · `GET /stats` · `GET /stats/flux` (SSE) · `GET /suivi` · `GET /verification` · `GET /sante` | public |

Le serveur de jeu relaie `/api/…` vers ce service : le navigateur ne connaît qu'une adresse.

---

## Hébergement

| Étage | Où |
|---|---|
| Client (`tools/feel-lab`, `vite build`) | servi par le serveur de jeu |
| Base + Auth | Supabase managé |
| Ce service | Fly.io, **un seul conteneur** |
| RPC Solana | Helius ou QuickNode — le RPC public limite et perd des transactions |

---

## Le verrou avant le mainnet

1. ~~Serveur de jeu autoritatif, résultats signés.~~ **Fait le 2 septembre 2026** : le
   navigateur ne déclare plus rien ; `window.__probeGame()` ne peut plus se payer.
2. **Journal de replay archivé** (spec § 6.4). Sans lui, aucun litige n'est arbitrable.
3. **Géo-restriction effective**, France exclue (spec § 5).
4. **Gestion de clé sérieuse** pour `CAISSE_CLE`, `GRAINE_DEPOTS`, `FRAIS_CLE`, `POOL_CLE`,
   `SERVEUR_CLE` — KMS ou signataire matériel. Pas des variables d'environnement, ni
   `wallets/devnet.json`.
5. **Un vrai marché pour BG** : une paire BG/USDC sur Raydium ou Orca, et `echanger()` sur
   Jupiter. Tant que le pool est le nôtre, le prix est le nôtre.
6. **Un RPC payé**, avec abonnements WebSocket pour le guetteur (le tour est O(joueurs)).
7. **Validation juridique — et elle a changé de nature le 2 septembre 2026.** Depuis que
   la roue tire le montant APRÈS la partie (décision du directeur produit), le produit
   combine un classement au skill et un tirage au sort du gain une fois la mise engagée :
   c'est le motif exact d'une requalification en jeu d'argent. Ce point doit être tranché
   par un conseil AVANT tout dollar réel. Aucun code de ce dossier ne le tranche.
