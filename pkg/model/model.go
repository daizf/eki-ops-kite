package model

import (
	"log"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/zxh326/kite/pkg/common"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"k8s.io/klog/v2"
)

var (
	DB *gorm.DB

	once sync.Once
)

type Model struct {
	ID        uint      `json:"id" gorm:"primarykey"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// maskDSNPassword masks the password in a DSN string for safe logging.
func maskDSNPassword(dsn string) string {
	// URL format: scheme://user:password@host/db?params
	u, err := url.Parse(dsn)
	if err == nil && u.User != nil {
		if _, hasPassword := u.User.Password(); hasPassword {
			u.User = url.UserPassword(u.User.Username(), "*****")
		}
		return u.String()
	}
	// MySQL Go driver format: user:password@tcp(host:port)/db?params
	if atIdx := strings.Index(dsn, "@"); atIdx != -1 {
		if colonIdx := strings.Index(dsn[:atIdx], ":"); colonIdx != -1 {
			return dsn[:colonIdx+1] + "*****" + dsn[atIdx:]
		}
	}
	return dsn
}

func InitDB() {
	dsn := common.DBDSN
	level := logger.Silent
	if klog.V(10).Enabled() {
		level = logger.Info
	}
	newLogger := logger.New(
		log.New(os.Stdout, "\r\n", log.LstdFlags), // io writer
		logger.Config{
			SlowThreshold: time.Second,
			LogLevel:      level,
			Colorful:      false,
		},
	)

	var err error
	once.Do(func() {
		cfg := &gorm.Config{
			Logger: newLogger,
		}
		klog.Infof("Connecting to database: type=%s, dsn=%s", common.DBType, maskDSNPassword(dsn))
		if common.DBType == "sqlite" {
			DB, err = gorm.Open(sqlite.Open(dsn), cfg)
			if err != nil {
				panic("failed to connect database: " + err.Error())
			}
		}

		if common.DBType == "mysql" {
			mysqlDSN := strings.TrimPrefix(dsn, "mysql://")
			if !strings.Contains(mysqlDSN, "parseTime=") {
				separator := "?"
				if strings.Contains(mysqlDSN, "?") {
					separator = "&"
				}
				mysqlDSN = mysqlDSN + separator + "parseTime=true"
			}
			DB, err = gorm.Open(mysql.Open(mysqlDSN), cfg)
			if err != nil {
				panic("failed to connect database: " + err.Error())
			}
		}

		if common.DBType == "postgres" {
			DB, err = gorm.Open(postgres.Open(dsn), cfg)
			if err != nil {
				panic("failed to connect database: " + err.Error())
			}
		}
	})

	if DB == nil {
		panic("database connection is nil, check your DB_TYPE and DB_DSN settings")
	}

	// For SQLite we must enable foreign key enforcement explicitly.
	// SQLite has foreign key constraints defined in the schema but they are
	// not enforced unless PRAGMA foreign_keys = ON is set on the connection.
	if common.DBType == "sqlite" {
		if err := DB.Exec("PRAGMA foreign_keys = ON").Error; err != nil {
			panic("failed to enable sqlite foreign keys: " + err.Error())
		}
	}
	models := []interface{}{
		User{},
		Pool{},
		PasskeyCredential{},
		Cluster{},
		GeneralSetting{},
		LDAPSetting{},
		OAuthProvider{},
		Role{},
		RoleAssignment{},
		ResourceHistory{},
		ResourceTemplate{},
		PendingSession{},
		SyncLock{},
		HelmRepository{},
		ScheduledTask{},
	}
	for _, model := range models {
		err = DB.AutoMigrate(model)
		if err != nil {
			panic("failed to migrate database: " + err.Error())
		}
	}
	sqldb, err := DB.DB()
	if err == nil {
		sqldb.SetMaxOpenConns(common.DBMaxOpenConns)
		sqldb.SetMaxIdleConns(common.DBMaxIdleConns)
		sqldb.SetConnMaxLifetime(common.DBMaxIdleTime)
	}
}
