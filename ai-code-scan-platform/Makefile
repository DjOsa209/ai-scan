.PHONY: test run up down logs

test:
	go test ./...

run:
	go run ./cmd/api

up:
	docker compose up --build -d

down:
	docker compose down

logs:
	docker compose logs -f api
