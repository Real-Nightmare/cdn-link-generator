# Build stage
FROM golang:1.21-alpine AS builder

WORKDIR /app
COPY go.mod ./
COPY *.go ./

RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o cdn-link-gen .

# Runtime stage
FROM alpine:latest

RUN apk add --no-cache ca-certificates git

COPY --from=builder /app/cdn-link-gen /usr/local/bin/cdn-link-gen

# Run as non-root
RUN adduser -D appuser
USER appuser
WORKDIR /workspace

ENTRYPOINT ["cdn-link-gen"]
CMD ["--help"]
