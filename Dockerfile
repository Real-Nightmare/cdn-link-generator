FROM golang:1.21-alpine AS builder

WORKDIR /app
COPY . .

RUN go mod download && \
    CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o cdn-link-gen .

FROM alpine:latest

RUN apk add --no-cache ca-certificates git

WORKDIR /workspace

COPY --from=builder /app/cdn-link-gen /usr/local/bin/

ENTRYPOINT ["cdn-link-gen"]
CMD ["--help"]
