package pool

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/model"
	"gorm.io/gorm"
)

type BatchPoolImportRequest struct {
	Pools []BatchPoolImportItem `json:"pools"`
}

type BatchPoolImportItem struct {
	PoolID        string `json:"poolId"`
	PoolName      string `json:"poolName"`
	Description   string `json:"description"`
	Proxy         string `json:"proxy"`
	ImageRegistry string `json:"imageRegistry"`
	EskBaseURL    string `json:"eskBaseURL"`
	KcsBaseURL    string `json:"kcsBaseURL"`
	Enable        bool   `json:"enable"`
}

type BatchPoolImportResult struct {
	Imported []string `json:"imported"`
	Skipped   []string `json:"skipped"`
	Rejected  []string `json:"rejected"`
}

func BatchImportPools(c *gin.Context) {
	var req BatchPoolImportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result := BatchPoolImportResult{
		Imported: []string{},
		Skipped:  []string{},
		Rejected: []string{},
	}

	existingPools, err := model.ListPools()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	existingPoolIDs := make(map[string]bool)
	for _, pool := range existingPools {
		existingPoolIDs[pool.PoolID] = true
	}

	for i, item := range req.Pools {
		if item.PoolID == "" || item.PoolName == "" {
			if item.PoolID == "" && item.PoolName == "" {
				result.Rejected = append(result.Rejected, fmt.Sprintf("Row %d: missing poolId and poolName", i+2))
			} else if item.PoolID == "" {
				result.Rejected = append(result.Rejected, fmt.Sprintf("Row %d: missing poolId", i+2))
			} else {
				result.Rejected = append(result.Rejected, fmt.Sprintf("Row %d: missing poolName", i+2))
			}
			continue
		}

		if existingPoolIDs[item.PoolID] {
			result.Skipped = append(result.Skipped, item.PoolID)
			continue
		}

		pool := &model.Pool{
			PoolID:        item.PoolID,
			PoolName:      item.PoolName,
			Description:   item.Description,
			Proxy:         item.Proxy,
			ImageRegistry: item.ImageRegistry,
			EskBaseURL:    item.EskBaseURL,
			KcsBaseURL:    item.KcsBaseURL,
			Enable:        item.Enable,
		}

		if err := model.AddPool(pool); err != nil {
			result.Rejected = append(result.Rejected, fmt.Sprintf("%s (%s)", item.PoolID, err.Error()))
			continue
		}

		result.Imported = append(result.Imported, item.PoolID)
		existingPoolIDs[item.PoolID] = true
	}

	c.JSON(http.StatusOK, result)
}

func GetPoolList(c *gin.Context) {
	pools, err := model.ListPools()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	result := make([]gin.H, 0, len(pools))
	for _, pool := range pools {
		result = append(result, gin.H{
			"id":             pool.ID,
			"poolId":         pool.PoolID,
			"poolName":       pool.PoolName,
			"description":    pool.Description,
			"proxy":          pool.Proxy,
			"imageRegistry":  pool.ImageRegistry,
			"eskBaseURL":     pool.EskBaseURL,
			"kcsBaseURL":     pool.KcsBaseURL,
			"enable":         pool.Enable,
		})
	}

	c.JSON(http.StatusOK, result)
}

func CreatePool(c *gin.Context) {
	var req struct {
		PoolID        string `json:"poolId" binding:"required"`
		PoolName      string `json:"poolName" binding:"required"`
		Description   string `json:"description"`
		Proxy         string `json:"proxy"`
		ImageRegistry string `json:"imageRegistry"`
		EskBaseURL    string `json:"eskBaseURL"`
		KcsBaseURL    string `json:"kcsBaseURL"`
		Enable        bool   `json:"enable"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if _, err := model.GetPoolByPoolID(req.PoolID); err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "pool already exists"})
		return
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	pool := &model.Pool{
		PoolID:        req.PoolID,
		PoolName:      req.PoolName,
		Description:   req.Description,
		Proxy:         req.Proxy,
		ImageRegistry: req.ImageRegistry,
		EskBaseURL:    req.EskBaseURL,
		KcsBaseURL:    req.KcsBaseURL,
		Enable:        req.Enable,
	}

	if err := model.AddPool(pool); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"id":      pool.ID,
		"message": "pool created successfully",
	})
}

func UpdatePool(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid pool id"})
		return
	}

	var req struct {
		PoolID        string `json:"poolId"`
		PoolName      string `json:"poolName"`
		Description   string `json:"description"`
		Proxy         string `json:"proxy"`
		ImageRegistry string `json:"imageRegistry"`
		EskBaseURL    string `json:"eskBaseURL"`
		KcsBaseURL    string `json:"kcsBaseURL"`
		Enable        bool   `json:"enable"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	pool, err := model.GetPoolByID(uint(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "pool not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	updates := map[string]any{
		"description":    req.Description,
		"proxy":          req.Proxy,
		"image_registry": req.ImageRegistry,
		"esk_base_url":   req.EskBaseURL,
		"kcs_base_url":   req.KcsBaseURL,
		"enable":         req.Enable,
	}

	if req.PoolID != "" && req.PoolID != pool.PoolID {
		if _, err := model.GetPoolByPoolID(req.PoolID); err == nil {
			c.JSON(http.StatusConflict, gin.H{"error": "poolId already exists"})
			return
		}
		updates["pool_id"] = req.PoolID
	}

	if req.PoolName != "" {
		updates["pool_name"] = req.PoolName
	}

	if err := model.UpdatePool(pool, updates); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "pool updated successfully"})
}

func DeletePool(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid pool id"})
		return
	}

	pool, err := model.GetPoolByID(uint(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "pool not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	if err := model.DeletePool(pool); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "pool deleted successfully"})
}
