package middleware

import (
	"net/http"
	"net/url"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
)

const (
	ClusterIdHeader = "x-cluster-id"
	ClusterIdKey    = "cluster-id"
	K8sClientKey    = "k8s-client"
	PromClientKey   = "prom-client"
)

// ClusterMiddleware extracts cluster name from header and injects clients into context
func ClusterMiddleware(cm *cluster.ClusterManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		clusterID := c.GetHeader(ClusterIdHeader)
		if clusterID == "" {
			if v, ok := c.GetQuery(ClusterIdHeader); ok {
				clusterID = v
			}
			if clusterID == "" {
				clusterID, _ = c.Cookie(ClusterIdHeader)
			}
		}
		if clusterID != "" {
			if decoded, err := url.PathUnescape(clusterID); err == nil {
				clusterID = decoded
			}
		}
		cluster, err := cm.GetClientSet(clusterID)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			c.Abort()
			return
		}
		c.Set("cluster", cluster)
		c.Set(ClusterIdKey, cluster.ClusterID)
		c.Next()
	}
}
