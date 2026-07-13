package model

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strings"

	"gorm.io/gorm"
)

type Cluster struct {
	Model
	Name          string       `json:"name" gorm:"type:varchar(100);not null"`
	ClusterID     string       `json:"clusterId" gorm:"type:varchar(255);uniqueIndex"`
	Description   string       `json:"description" gorm:"type:text"`
	Config        SecretString `json:"config" gorm:"type:text"`
	PrometheusURL string       `json:"prometheus_url,omitempty" gorm:"type:varchar(255)"`
	Category      string       `json:"category" gorm:"type:varchar(100)"`
	Tags          string       `json:"tags" gorm:"type:varchar(500);default:''"`
	InCluster     bool         `json:"in_cluster" gorm:"type:boolean;default:false"`
	IsDefault     bool         `json:"is_default" gorm:"type:boolean;default:false"`
	Enable        bool         `json:"enable" gorm:"type:boolean;default:true"`
	MetaHash      string       `json:"-" gorm:"type:varchar(64)"`
	PoolID        string       `json:"poolId" gorm:"type:varchar(100)"`
	Pool          *Pool        `json:"pool" gorm:"foreignKey:PoolID;references:PoolID"`
}

func AddCluster(cluster *Cluster) error {
	return DB.Create(cluster).Error
}

func GetClusterByName(name string) (*Cluster, error) {
	var cluster Cluster
	if err := DB.Where("name = ?", name).First(&cluster).Error; err != nil {
		return nil, err
	}
	return &cluster, nil
}

func GetClusterByID(id uint) (*Cluster, error) {
	var cluster Cluster
	if err := DB.First(&cluster, id).Error; err != nil {
		return nil, err
	}
	return &cluster, nil
}

func GetClusterByIDWithPool(id uint) (*Cluster, error) {
	var cluster Cluster
	if err := DB.Preload("Pool").First(&cluster, id).Error; err != nil {
		return nil, err
	}
	return &cluster, nil
}

func UpdateCluster(cluster *Cluster, updates map[string]interface{}) error {
	return DB.Model(cluster).Updates(updates).Error
}

func DeleteCluster(cluster *Cluster) error {
	return DB.Delete(cluster).Error
}

func ClearDefaultCluster() error {
	return DB.Model(&Cluster{}).Where("is_default = ?", true).Update("is_default", false).Error
}

func DisableCluster(cluster *Cluster) error {
	return DB.Model(cluster).Update("enable", false).Error
}

func EnableCluster(cluster *Cluster) error {
	return DB.Model(cluster).Update("enable", true).Error
}

func GetClusterByClusterID(clusterID string) (*Cluster, error) {
	var cluster Cluster
	if err := DB.Where("cluster_id = ?", clusterID).First(&cluster).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &cluster, nil
}

func ListClustersByPoolID(poolID string) ([]*Cluster, error) {
	var clusters []*Cluster
	if err := DB.Where("pool_id = ? AND meta_hash != ''", poolID).Find(&clusters).Error; err != nil {
		return nil, err
	}
	return clusters, nil
}

func ListClusters() ([]*Cluster, error) {
	var clusters []*Cluster
	if err := DB.Preload("Pool").Find(&clusters).Error; err != nil {
		return nil, err
	}
	return clusters, nil
}

func CountClusters() (count int64, err error) {
	return count, DB.Model(&Cluster{}).Count(&count).Error
}

// GetTags returns the tags as a string array
func (c *Cluster) GetTags() []string {
	if c.Tags == "" {
		return []string{}
	}
	var tags []string
	if err := json.Unmarshal([]byte(c.Tags), &tags); err != nil {
		return []string{}
	}
	return tags
}

// SetTags sets the tags from a string array
func (c *Cluster) SetTags(tags []string) error {
	tags = NormalizeTags(tags)
	if len(tags) == 0 {
		c.Tags = ""
		return nil
	}
	data, err := json.Marshal(tags)
	if err != nil {
		return err
	}
	c.Tags = string(data)
	return nil
}

// NormalizeTags normalizes tags by trimming whitespace and removing duplicates
func (c *Cluster) ComputeMetaHash() string {
	type meta struct {
		Name          string
		ClusterID     string
		Config        string
		PrometheusURL string
		Category      string
	}
	data, _ := json.Marshal(meta{
		Name:          c.Name,
		ClusterID:     c.ClusterID,
		Config:        string(c.Config),
		PrometheusURL: c.PrometheusURL,
		Category:      c.Category,
	})
	return fmt.Sprintf("%x", sha256.Sum256(data))
}

func NormalizeTags(tags []string) []string {
	normalized := make([]string, 0, len(tags))
	seen := make(map[string]bool)

	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		if tag == "" || seen[tag] {
			continue
		}
		normalized = append(normalized, tag)
		seen[tag] = true
	}
	return normalized
}
