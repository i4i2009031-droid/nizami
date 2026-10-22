FROM node:24-alpine
WORKDIR /app
# Preserve relative imports used by the API and shared accounting modules.
COPY server/*.mjs ./server/
COPY apps/client/js/ ./apps/client/js/
ENV NODE_ENV=production QATFAH_PORT=5059 QATFAH_DATA_DIR=/data
RUN npm install --no-audit --no-fund @whiskeysockets/baileys qrcode && npm pkg set type=module && mkdir -p /data && chown node:node /data
USER node
EXPOSE 5059
CMD ["node","server/index.mjs"]
