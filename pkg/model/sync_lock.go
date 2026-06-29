package model

import (
	"time"

	"gorm.io/gorm/clause"
)

const SyncLockTTL = 10 * time.Minute

type SyncLock struct {
	Model
	LockKey   string     `gorm:"type:varchar(100);uniqueIndex;not null"`
	Holder    string     `gorm:"type:varchar(255)"`
	LockedAt  *time.Time `gorm:"type:timestamp"`
	ExpiresAt *time.Time `gorm:"type:timestamp"`
}

// TryAcquireSyncLock attempts to acquire a distributed lock for the given key.
// It uses an upsert pattern: try to update an existing expired/unheld row first,
// then insert if no row exists. Returns true if the lock was acquired.
func TryAcquireSyncLock(lockKey, holder string, ttl time.Duration) (bool, error) {
	now := time.Now()
	expiresAt := now.Add(ttl)

	// Try to update an existing row that is either unheld, held by us, or expired.
	result := DB.Model(&SyncLock{}).
		Where("lock_key = ? AND (holder = '' OR holder = ? OR expires_at < ?)", lockKey, holder, now).
		Updates(map[string]interface{}{
			"holder":     holder,
			"locked_at":  now,
			"expires_at": expiresAt,
		})
	if result.Error != nil {
		return false, result.Error
	}

	if result.RowsAffected > 0 {
		return true, nil
	}

	// No row was updated — either the lock is held by another instance,
	// or the row doesn't exist yet. Try to insert.
	lock := SyncLock{
		LockKey:   lockKey,
		Holder:    holder,
		LockedAt:  &now,
		ExpiresAt: &expiresAt,
	}
	result = DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "lock_key"}},
		DoNothing: true,
	}).Create(&lock)
	if result.Error != nil {
		return false, result.Error
	}

	if result.RowsAffected == 0 {
		return false, nil
	}

	return true, nil
}

// ReleaseSyncLock releases a distributed lock held by the given holder.
func ReleaseSyncLock(lockKey, holder string) error {
	return DB.Model(&SyncLock{}).
		Where("lock_key = ? AND holder = ?", lockKey, holder).
		Updates(map[string]interface{}{
			"holder":     "",
			"locked_at":  nil,
			"expires_at": nil,
		}).Error
}
