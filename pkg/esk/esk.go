package esk

import (
	"context"
	"net/http"
	"net/url"
	"time"

	"github.com/zxh326/kite/pkg/model"
	"k8s.io/klog/v2"
)

type Syncer struct {
	client   *http.Client
	baseURL  string
	poolID   string
	interval time.Duration
}

func newSyncer(pool *model.Pool, interval time.Duration) *Syncer {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	client := &http.Client{Timeout: 30 * time.Second}

	if pool.Proxy != "" {
		proxyURL, err := url.Parse(pool.Proxy)
		if err != nil {
			klog.Warningf("Invalid proxy %q for pool %s: %v", pool.Proxy, pool.PoolID, err)
		} else {
			transport.Proxy = http.ProxyURL(proxyURL)
			client.Transport = transport
		}
	}

	return &Syncer{
		client:   client,
		baseURL:  pool.EskBaseURL,
		poolID:   pool.PoolID,
		interval: interval,
	}
}

func StartSyncer(ctx context.Context) {
	go runSyncer(ctx)
}

func runSyncer(ctx context.Context) {
	interval := 5 * time.Minute

	// Perform initial sync for all enabled pools
	syncAllPools(ctx, interval)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			klog.Info("ESK sync stopped")
			return
		case <-ticker.C:
			syncAllPools(ctx, interval)
		}
	}
}

func syncAllPools(ctx context.Context, interval time.Duration) {
	pools, err := model.ListPools()
	if err != nil {
		klog.Errorf("ESK sync: failed to list pools: %v", err)
		return
	}

	for _, pool := range pools {
		if !pool.Enable || pool.EskBaseURL == "" {
			continue
		}

		s := newSyncer(pool, interval)
		klog.Infof("ESK sync: syncing pool %s (%s), baseURL=%s, proxy=%s", pool.PoolID, pool.PoolName, s.baseURL, pool.Proxy)
		if err := s.sync(ctx); err != nil {
			klog.Errorf("ESK sync: pool %s sync failed: %v", pool.PoolID, err)
		}
	}
}