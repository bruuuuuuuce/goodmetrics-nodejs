FROM node:24-alpine AS build

WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install --registry https://registry.npmjs.org/
COPY server.ts ./
RUN npm run build

FROM node:24-alpine

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --registry https://registry.npmjs.org/
COPY --from=build /app/server.js ./

EXPOSE 4317 8080
CMD ["node", "server.js"]
