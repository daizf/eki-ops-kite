package model

import (
	"strings"
)

type Pool struct {
	Model
	ImageRegistry string `json:"imageRegistry" gorm:"type:varchar(255)"`
	PoolID        string `json:"poolId" gorm:"type:varchar(100);uniqueIndex;not null"`
	PoolName      string `json:"poolName" gorm:"type:varchar(100);not null"`
	Description   string `json:"description" gorm:"type:text"`
	Proxy         string `json:"proxy" gorm:"type:varchar(255)"`
	EskBaseURL    string `json:"eskBaseURL" gorm:"type:varchar(255)"`
	KcsBaseURL    string `json:"kcsBaseURL" gorm:"type:varchar(255)"`
	Enable        bool   `json:"enable" gorm:"type:boolean;default:true"`
}

// ResolveImage returns the full image reference for the given cluster,
// prefixing the pool's ImageRegistry if it is set and the image doesn't
// already contain a registry.
func ResolveImage(poolID, image string) string {
	if poolID == "" {
		return image
	}
	var pool Pool
	if err := DB.Where("pool_id = ?", poolID).Select("image_registry").First(&pool).Error; err != nil {
		return image
	}
	return ApplyImageRegistry(pool.ImageRegistry, image)
}

// ApplyImageRegistry prefixes the given image with the registry if the
// image doesn't already contain a registry host.
func ApplyImageRegistry(registry, image string) string {
	registry = strings.TrimRight(registry, "/")
	if registry == "" {
		return image
	}
	// Image already contains a registry prefix (e.g. "ghcr.io/..." or "registry.example.com/...")
	if strings.Contains(image, "/") && !strings.HasPrefix(image, "library/") {
		firstSlash := strings.Index(image, "/")
		possibleRegistry := image[:firstSlash]
		if strings.Contains(possibleRegistry, ".") || strings.Contains(possibleRegistry, ":") {
			return image // already has a registry
		}
	}
	return registry + "/" + image
}

func AddPool(pool *Pool) error {
	return DB.Create(pool).Error
}

func GetPoolByID(id uint) (*Pool, error) {
	var pool Pool
	if err := DB.First(&pool, id).Error; err != nil {
		return nil, err
	}
	return &pool, nil
}

func GetPoolByPoolID(poolId string) (*Pool, error) {
	var pool Pool
	if err := DB.Where("pool_id = ?", poolId).First(&pool).Error; err != nil {
		return nil, err
	}
	return &pool, nil
}

func UpdatePool(pool *Pool, updates map[string]interface{}) error {
	return DB.Model(pool).Updates(updates).Error
}

func DeletePool(pool *Pool) error {
	return DB.Delete(pool).Error
}

func ListPools() ([]*Pool, error) {
	var pools []*Pool
	if err := DB.Find(&pools).Error; err != nil {
		return nil, err
	}
	return pools, nil
}

func CountPools() (count int64, err error) {
	return count, DB.Model(&Pool{}).Count(&count).Error
}

func EnablePool(pool *Pool) error {
	return DB.Model(pool).Update("enable", true).Error
}

func DisablePool(pool *Pool) error {
	return DB.Model(pool).Update("enable", false).Error
}
