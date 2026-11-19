# Runs Mystery Stock Market anywhere that takes a container: Fly.io, Railway,
# Google Cloud Run, a school server. Supply DATABASE_URL, AUTH_SECRET and,
# on the first run, OWNER_EMAIL and OWNER_PASSWORD.

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
# Explicitly include devDependencies: the build needs typescript and tailwind,
# and some platforms set NODE_ENV=production, which would skip them.
RUN npm ci --include=dev
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# The listening port comes from the platform; 3000 is only the fallback.
ENV PORT=3000

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./
COPY --from=build /app/next.config.mjs ./
COPY --from=build /app/db ./db
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json ./

EXPOSE 3000

# Migrations are idempotent, so applying them on start keeps the schema in
# step with the image without a separate deployment step.
CMD ["sh", "-c", "npm run db:migrate && npm start"]
