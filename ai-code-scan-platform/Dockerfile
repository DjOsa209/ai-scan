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
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

FROM ${DOCKER_LIBRARY}/alpine:3.22
RUN apk add --no-cache ca-certificates git
COPY --from=build /out/api /api
EXPOSE 8080
USER 65532:65532
ENTRYPOINT ["/api"]
