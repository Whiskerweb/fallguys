# Le backend — UNE SEULE INSTANCE (voir README.md : deux signataires paient deux fois).
# Contexte de build : le dossier backend/. Rien du jeu n'est necessaire ici.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY sql ./sql
COPY certs ./certs
COPY public ./public
EXPOSE 8787
CMD ["node", "src/index.js"]
