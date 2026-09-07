#!/usr/bin/env bash
# Deploie le backend puis le serveur de jeu sur Fly.io, avec les secrets du .env.
#
#   fly auth login                 # une fois, dans un navigateur
#   bash deploy/fly/deployer.sh    # cree les apps si besoin, pose les secrets, deploie
#
# Les secrets partent DIRECTEMENT du .env vers Fly (`fly secrets set`), sans jamais
# s'afficher. Les deux variables Supabase publiques (anon) sont compilees dans le jeu.
set -euo pipefail
cd "$(dirname "$0")/../.."
[ -f .env ] || { echo ".env absent a la racine"; exit 1; }
set -a; source .env; set +a

# MAINNET : on ne deploie pas de l'argent reel par reflexe. Le passage suit le README du
# backend (« Passer en mainnet ») et se confirme ici, a la main.
if [ "${ROBINHOOD_RESEAU:-testnet}" = "mainnet" ] && [ "${JE_CONFIRME_MAINNET:-}" != "oui" ]; then
  echo "ROBINHOOD_RESEAU=mainnet dans le .env : relancer avec JE_CONFIRME_MAINNET=oui apres avoir suivi backend/README.md « Passer en mainnet »."; exit 1
fi

BACKEND=tumble-bg-backend
JEU=tumble-bg-jeu
ORG="${FLY_ORG:-personal}"

# L'adresse PUBLIEE du jeu — celle que la page d'accueil (babyguy.dev) met sur ses six
# boutons, et celle que le navigateur porte donc en Origin. `<app>.fly.dev` repond
# toujours, mais plus personne ne le tape : le mettre ici rendrait ORIGINE_AUTORISEE
# faux pour tout joueur venu du site.
DOMAINE="${DOMAINE_JEU:-play.babyguy.dev}"

# On demande a Fly si l'app existe (`fly status`), plutot que de lire la liste : `fly apps list`
# indente ses lignes et s'interrompt sur un avertissement de jeton, et une app existante
# passait pour absente — « Name has already been taken », puis `set -e` arretait tout.
creer() { fly status -a "$1" >/dev/null 2>&1 || fly apps create "$1" --org "$ORG"; }
creer "$BACKEND"
creer "$JEU"

echo "== secrets du backend"
fly secrets set -a "$BACKEND" --stage \
  SUPABASE_URL="$SUPABASE_URL" SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" DATABASE_URL="$DATABASE_URL" \
  ROBINHOOD_RESEAU="${ROBINHOOD_RESEAU:-testnet}" ROBINHOOD_RPC="${ROBINHOOD_RPC:-}" STABLE_SYMBOLE="${STABLE_SYMBOLE:-}" \
  LOT_ADRESSE="$LOT_ADRESSE" USDG_ADRESSE="$USDG_ADRESSE" BG_ADRESSE="$BG_ADRESSE" \
  CAISSE_CLE="$CAISSE_CLE" GRAINE_DEPOTS="$GRAINE_DEPOTS" FRAIS_CLE="$FRAIS_CLE" POOL_CLE="$POOL_CLE" \
  SERVEUR_PUBLIQUE="$SERVEUR_PUBLIQUE" ORIGINE_AUTORISEE="https://$DOMAINE" >/dev/null
echo "== secrets du serveur de jeu"
fly secrets set -a "$JEU" --stage \
  BACKEND_URL="http://$BACKEND.internal:8787" SERVEUR_CLE="$SERVEUR_CLE" \
  SUPABASE_URL="$SUPABASE_URL" SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" >/dev/null

echo "== deploiement du backend"
APPLIQUER_SCHEMA="${APPLIQUER_SCHEMA:-0}"
# Le contexte de build est le dossier courant : backend/ pour le backend, la racine pour
# le jeu (qui a besoin de tools/feel-lab et de backend/src/signature.js).
( cd backend && fly deploy -c ../deploy/fly/backend.toml --dockerfile Dockerfile -a "$BACKEND" \
    --remote-only --ha=false --env APPLIQUER_SCHEMA="$APPLIQUER_SCHEMA" )
echo "== deploiement du serveur de jeu"
fly deploy -c deploy/fly/jeu.toml --dockerfile deploy/jeu.Dockerfile -a "$JEU" --remote-only --ha=false \
  --build-arg VITE_SUPABASE_URL="$SUPABASE_URL" --build-arg VITE_SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY"

echo
echo "Le jeu : https://$DOMAINE    ·    suivi : https://$DOMAINE/api/suivi"
echo "         (https://$JEU.fly.dev repond aussi — meme machine, autre nom)"
echo
echo "Le certificat du domaine est pose UNE fois, hors de ce script :"
echo "  fly certs create $DOMAINE -a $JEU"
echo "et le DNS pointe sur l'hostname PROPRE A L'APP, pas sur $JEU.fly.dev :"
echo "  CNAME $DOMAINE -> <id>.$JEU.fly.dev     (fly certs setup $DOMAINE le donne)"
echo "Un CNAME vers $JEU.fly.dev ne rend que l'IPv4 partagee, et le certificat"
echo "reste \"Not verified\" sans que rien ne dise pourquoi." 
