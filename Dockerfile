FROM node:20-alpine

LABEL org.opencontainers.image.source="https://github.com/mendoc/pontis-hooks"

RUN apk add --no-cache docker-cli docker-cli-compose

WORKDIR /srv

COPY server.js .

EXPOSE 9000

CMD ["node", "server.js"]
