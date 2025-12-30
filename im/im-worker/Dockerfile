FROM golang:1.22-alpine AS build
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN go build -o /out/im-worker ./...

FROM alpine:3.20
WORKDIR /app
COPY --from=build /out/im-worker /app/im-worker
ENTRYPOINT ["/app/im-worker"]
