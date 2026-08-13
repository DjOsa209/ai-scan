ARG DOCKER_LIBRARY=public.ecr.aws/docker/library

FROM ${DOCKER_LIBRARY}/node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM ${DOCKER_LIBRARY}/nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80