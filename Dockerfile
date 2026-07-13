FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm install

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules /app/node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "run", "start"]

