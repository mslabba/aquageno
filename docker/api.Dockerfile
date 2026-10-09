FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat python3 make g++
COPY backend/package.json backend/package-lock.json ./
COPY backend/prisma ./prisma
RUN npm ci
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build
COPY docker/api-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENV NODE_ENV=production
EXPOSE 4000
CMD ["/entrypoint.sh"]
