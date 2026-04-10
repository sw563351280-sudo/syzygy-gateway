FROM ghcr.io/puppeteer/puppeteer:latest

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

USER root
COPY package.json ./
RUN npm install
COPY . .
USER pptruser

EXPOSE 8080
CMD ["npm", "start"]
