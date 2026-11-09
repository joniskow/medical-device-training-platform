FROM node:24-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY services/openmontage/server.mjs ./server.mjs
USER node
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node","server.mjs"]
