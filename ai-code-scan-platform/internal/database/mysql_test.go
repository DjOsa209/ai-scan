package database

import (
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
)

func TestUTCDSNForcesConsistentTimeZone(t *testing.T) {
	dsn, err := utcDSN("user:password@tcp(localhost:3306)/database?loc=Asia%2FShanghai&time_zone=%27%2B08%3A00%27")
	if err != nil {
		t.Fatalf("utcDSN returned an error: %v", err)
	}

	config, err := mysql.ParseDSN(dsn)
	if err != nil {
		t.Fatalf("parse normalized DSN: %v", err)
	}
	if !config.ParseTime {
		t.Fatal("ParseTime must be enabled")
	}
	if config.Loc != time.UTC {
		t.Fatalf("location = %v, want UTC", config.Loc)
	}
	if got := config.Params["time_zone"]; got != "'+00:00'" {
		t.Fatalf("time_zone = %q, want %q", got, "'+00:00'")
	}
}
