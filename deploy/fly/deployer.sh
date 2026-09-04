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

BACKEND=tumble-bg-backend
JEU=tumble-bg-jeu
ORG="${FLY_ORG:-personal}"

creer() { fly apps list 2>/dev/null | grep -q "^$1\b" || fly apps create "$1" --org "$ORG"; }
creer "$BACKEND"
creer "$JEU"

echo "== secrets du backend"
fly secrets set -a "$BACKEND" --stage \
  SUPABASE_URL="$SUPABASE_URL" SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" DATABASE_URL="$DATABASE_URL" \
  SOLANA_RPC="$SOLANA_RPC" USDC_MINT="$USDC_MINT" BG_MINT="$BG_MINT" \
  CAISSE_CLE="$CAISSE_CLE" GRAINE_DEPOTS="$GRAINE_DEPOTS" FRAIS_CLE="$FRAIS_CLE" POOL_CLE="$POOL_CLE" \
  SERVEUR_PUBLIQUE="$SERVEUR_PUBLIQUE" ORIGINE_AUTORISEE="https://$JEU.fly.dev" >/dev/null
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
echo "Le jeu : https://$JEU.fly.dev    ·    suivi : https://$JEU.fly.dev/api/suivi"
