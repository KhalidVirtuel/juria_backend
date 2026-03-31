FROM node:20

WORKDIR /app

# Copier les fichiers package
COPY package*.json ./

# Installer les dépendances
RUN npm install

# ✅ GÉNÉRATION DE PRISMA CLIENT (CRITIQUE)
COPY prisma ./prisma/
RUN npx prisma generate

# Copier le reste du code
COPY . .

EXPOSE 8787

# ✅ Exécuter les migrations puis démarrer le serveur
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]