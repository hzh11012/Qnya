# ---- Stage 1: Install deps ----
FROM node:24-alpine AS deps

RUN corepack enable && corepack prepare pnpm@10.23.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

# ---- Stage 2: Build ----
FROM node:24-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10.23.0 --activate

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY drizzle ./drizzle
COPY drizzle.config.ts package.json tsconfig.json ./

RUN pnpm exec tsc --noEmit false \
    # tsc 不会复制非 TS 资源文件，MCP 技能说明在运行时被 readFileSync 读取
    && cp src/routes/api/mcp/skills.md dist/routes/api/mcp/skills.md

# ---- Stage 3: Production deps only ----
FROM node:24-alpine AS prod-deps

RUN corepack enable && corepack prepare pnpm@10.23.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts --prod

# ---- Stage 4: Runtime ----
FROM node:24-alpine AS runner

# 前台用户端仓库
ARG FRONTEND_REPO=hzh11012/Qnya-Frontend
ARG FRONTEND_VERSION

# 后台管理面板仓库
ARG ADMIN_REPO=hzh11012/Qnya-Backend
ARG ADMIN_VERSION

RUN apk add --no-cache nginx supervisor curl unzip \
    && mkdir -p /data/resources /data/downloads /run/nginx \
    \
    && FRONTEND_URL="${FRONTEND_VERSION:+https://github.com/${FRONTEND_REPO}/releases/download/${FRONTEND_VERSION}/dist.zip}" \
    && FRONTEND_URL="${FRONTEND_URL:-https://github.com/${FRONTEND_REPO}/releases/latest/download/dist.zip}" \
    && curl -fsSL --retry 3 "$FRONTEND_URL" -o /tmp/frontend.zip \
    && unzip -q /tmp/frontend.zip -d /tmp/frontend \
    # mv 目标目录已存在时会移成子目录，必须先删掉占位空目录
    && rm -rf /usr/share/nginx/frontend \
    && mv /tmp/frontend/dist /usr/share/nginx/frontend \
    && rm -rf /tmp/frontend.zip /tmp/frontend \
    \
    && ADMIN_URL="${ADMIN_VERSION:+https://github.com/${ADMIN_REPO}/releases/download/${ADMIN_VERSION}/dist.zip}" \
    && ADMIN_URL="${ADMIN_URL:-https://github.com/${ADMIN_REPO}/releases/latest/download/dist.zip}" \
    && curl -fsSL --retry 3 "$ADMIN_URL" -o /tmp/admin.zip \
    && unzip -q /tmp/admin.zip -d /tmp/admin \
    && rm -rf /usr/share/nginx/admin \
    && mv /tmp/admin/dist /usr/share/nginx/admin \
    && rm -rf /tmp/admin.zip /tmp/admin

WORKDIR /app

ENV NODE_ENV=production

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle
COPY package.json drizzle.config.ts ./
COPY docker-entrypoint.sh ./
COPY nginx.conf /etc/nginx/nginx.conf
COPY supervisord.conf /etc/supervisord.conf

RUN chmod +x docker-entrypoint.sh

EXPOSE 5000 5001

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget -qO- http://localhost:5000/api/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
