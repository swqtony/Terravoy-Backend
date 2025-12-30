package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
)

func main() {
	addr := getEnv("IM_API_ADDR", ":8090")

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"ok":true}`)
	})

	server := &http.Server{
		Addr:    addr,
		Handler: mux,
	}
	log.Printf("im-api listening on %s", addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("im-api failed: %v", err)
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
