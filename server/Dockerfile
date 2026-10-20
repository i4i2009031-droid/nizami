FROM node:22-alpine
WORKDIR /app
COPY server/index.mjs ./index.mjs
COPY server/whatsapp.mjs ./whatsapp.mjs
COPY server/google-drive.mjs ./google-drive.mjs
ENV NODE_ENV=production QATFAH_PORT=5059 QATFAH_DATA_DIR=/data
RUN npm install --no-audit --no-fund @whiskeysockets/baileys qrcode && mkdir -p /data && chown node:node /data
USER node
EXPOSE 5059
CMD ["node","index.mjs"]
