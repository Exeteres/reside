FROM golang:1.25-alpine AS builder

WORKDIR /src/apps/temporal

COPY apps/temporal/go.mod apps/temporal/go.sum ./
RUN go mod download

COPY apps/temporal/ ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH:-amd64} go build -o /tmp/temporal-server ./main.go

FROM temporalio/server:1.29.2

USER root
COPY --from=builder /tmp/temporal-server /usr/local/bin/temporal-server
USER temporal
