ARG DOCKER_LIBRARY=public.ecr.aws/docker/library

FROM ${DOCKER_LIBRARY}/golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
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
