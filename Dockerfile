FROM node:20
WORKDIR /app
COPY package*.json ./
RUN npm install
RUN npx prisma --version || true
COPY . .
EXPOSE 8787
CMD ["npm","run","start"]
