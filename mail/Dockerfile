FROM node:24-alpine
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs ./
USER node
# A fresh self-signed certificate on every start; good enough for opportunistic STARTTLS
CMD mkdir -p /tmp/tls && openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=${MAIL_HOSTNAME:-localhost}" \
      -keyout /tmp/tls/key.pem -out /tmp/tls/cert.pem 2>/dev/null && exec node server.mjs
