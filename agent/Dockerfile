FROM node:24-slim
ENV NODE_ENV=production DISABLE_UPDATES=1 DISABLE_AUTOUPDATER=1 DISABLE_TELEMETRY=1
# A font for sharp, which turns our floor plan SVGs into images for Claude
RUN apt-get update && apt-get install -y --no-install-recommends fontconfig fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
RUN npm install -g @anthropic-ai/claude-code@2.1.304 && npm cache clean --force
RUN useradd -m agent && mkdir -p /work && chown agent /work
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY worker.mjs zones.mjs ./
USER agent
CMD ["node", "worker.mjs"]
