# Le serveur de jeu — il sert la page compilee ET la partie, et relaie /api au backend.
#
# Contexte de build : la RACINE du depot. Le serveur importe les vrais modules du jeu
# (tools/feel-lab/src : physique, economie, protocole) et la signature du backend
# (backend/src/signature.js) : les trois dossiers et leurs dependances sont donc dans
# l'image. Le jeu est compile ICI, avec les deux variables publiques Supabase.
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
# Playwright est une dependance de developpement du jeu ; on ne veut surtout pas ses
# navigateurs dans l'image.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# 1. Le jeu : dependances (Vite compris, il faut construire), puis la compilation.
COPY tools/feel-lab/package.json tools/feel-lab/package-lock.json ./tools/feel-lab/
RUN cd tools/feel-lab && npm ci
COPY tools/feel-lab/index.html tools/feel-lab/viewer.html ./tools/feel-lab/
COPY tools/feel-lab/src ./tools/feel-lab/src
COPY tools/feel-lab/public ./tools/feel-lab/public
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY VITE_API_URL=
RUN cd tools/feel-lab && npm run build

# 2. La signature partagee avec le backend, et ses dependances (bs58).
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev
COPY backend/src/signature.js ./backend/src/signature.js

# 3. Le serveur.
COPY serveur/package.json serveur/package-lock.json ./serveur/
RUN cd serveur && npm ci --omit=dev
COPY serveur/src ./serveur/src

WORKDIR /app/serveur
EXPOSE 8080
CMD ["node", "src/index.js"]
