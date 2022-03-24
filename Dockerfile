FROM node:16-alpine AS cabana

ENV CABANA_REF="9037f828a5b5669b163c37d75b31e54956c2a6b9"

RUN apk update && \
    apk add --no-cache git

RUN git clone https://github.com/RetroPilot/cabana.git

WORKDIR /cabana

RUN git checkout $CABANA_REF

RUN yarn install && \
    yarn netlify-sass && \
    yarn build

FROM node:16-alpine AS server

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

COPY --from=cabana /cabana/build cabana

EXPOSE 8080
CMD ["npm", "run", "server"]
