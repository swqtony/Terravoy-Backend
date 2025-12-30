FROM golang:1.22-alpine AS build
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN go build -o /out/im-api ./...

FROM alpine:3.20
WORKDIR /app
COPY --from=build /out/im-api /app/im-api
EXPOSE 8090
ENTRYPOINT ["/app/im-api"]
