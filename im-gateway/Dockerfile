FROM golang:1.22-alpine AS build
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN go build -o /out/im-gateway ./...

FROM alpine:3.20
WORKDIR /app
COPY --from=build /out/im-gateway /app/im-gateway
EXPOSE 8081
ENTRYPOINT ["/app/im-gateway"]
