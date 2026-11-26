FROM node:24-alpine
WORKDIR /app
COPY server.mjs ./
RUN mkdir /data && chown node:node /data
USER node
ENV PUMASI_DB=/data/pumasi.db PORT=8787
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "--no-warnings", "server.mjs"]
