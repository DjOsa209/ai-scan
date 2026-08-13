ARG DOCKER_LIBRARY=public.ecr.aws/docker/library
ARG GOPROXY=https://goproxy.cn,direct
ARG GOSUMDB=sum.golang.google.cn

FROM ${DOCKER_LIBRARY}/golang:1.26-alpine AS build
ARG GOPROXY
ARG GOSUMDB

WORKDIR /src
COPY go.mod go.sum ./
RUN go env -w GOPROXY="${GOPROXY}" && go env -w GOSUMDB="${GOSUMDB}"
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/ai-scan-engine ./cmd/engine

FROM ${DOCKER_LIBRARY}/alpine:3.23

RUN apk add --no-cache ca-certificates git openssh-client
RUN addgroup -S engine && adduser -S -G engine engine
WORKDIR /var/lib/ai-scan-engine
COPY --from=build /out/ai-scan-engine /usr/local/bin/ai-scan-engine
RUN chown -R engine:engine /var/lib/ai-scan-engine
USER engine

ENTRYPOINT ["ai-scan-engine"]
