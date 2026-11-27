# Stage 1: Build AegisPulse Mission Control v4.0 (React 19 + TypeScript + Vite)
FROM node:22-alpine AS builder
WORKDIR /app

COPY web/mission-control/package.json web/mission-control/package-lock.json ./
RUN npm ci

COPY web/mission-control/ ./
RUN npm run build

# Stage 2: Hardened Nginx Static & Reverse-Proxy Runtime
FROM nginx:1.27-alpine AS runtime
RUN rm -f /etc/nginx/conf.d/default.conf

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/nginx-health || exit 1

CMD ["nginx", "-g", "daemon off;"]
