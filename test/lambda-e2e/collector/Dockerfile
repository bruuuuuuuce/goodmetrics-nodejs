FROM node:24-alpine

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --registry https://registry.npmjs.org/
COPY server.js ./

EXPOSE 4317 8080
CMD ["node", "server.js"]
