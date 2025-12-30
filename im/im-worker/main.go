package main

import (
	"log"
	"os"
	"time"
)

func main() {
	log.Printf("im-worker starting, db=%s redis=%s", os.Getenv("IM_DB_DSN"), os.Getenv("IM_REDIS_URL"))
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		log.Printf("im-worker heartbeat")
	}
}
