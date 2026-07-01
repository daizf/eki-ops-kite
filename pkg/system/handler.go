package system

import (
	"net/http"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"github.com/zxh326/kite/pkg/utils"
	"golang.org/x/sync/errgroup"
	v1 "k8s.io/api/core/v1"
)

var knownAcceleratorResources = []string{
	"nvidia.com/gpu",
	"huawei.com/Ascend",
	"cambricon.com/mlu",
	"intel.com/gpu",
	"intel.com/sgpu",
	"baidu.com/xpu",
	"metax-tech.com/gpu",
	"hygon.com/dcu",
	"mthreads.com/musa",
	"enflame.com/tops",
	"iluvatar.ai/corex",
}

func isAccelerator(name string) bool {
	for _, p := range knownAcceleratorResources {
		if name == p || strings.HasPrefix(name, p) {
			return true
		}
	}
	return false
}

type OverviewData struct {
	TotalNodes      int                       `json:"totalNodes"`
	ReadyNodes      int                       `json:"readyNodes"`
	TotalPods       int                       `json:"totalPods"`
	RunningPods     int                       `json:"runningPods"`
	TotalNamespaces int                       `json:"totalNamespaces"`
	TotalServices   int                       `json:"totalServices"`
	PromEnabled     bool                      `json:"prometheusEnabled"`
	Resource        common.ResourceMetric     `json:"resource"`
	Accelerators    []common.ExtendedResource `json:"accelerators"`
}

// nodeMetrics holds aggregated metrics computed from the node list.
type nodeMetrics struct {
	total          int
	ready          int
	cpuAllocatable int64 // millicores
	memAllocatable int64 // milli-bytes (matches original MilliValue() contract)
}

// podMetrics holds aggregated metrics computed from the pod list.
type podMetrics struct {
	total        int
	running      int
	cpuRequested int64 // millicores
	memRequested int64 // milli-bytes (matches original MilliValue() contract)
	cpuLimited   int64 // millicores
	memLimited   int64 // milli-bytes (matches original MilliValue() contract)
}

func GetOverview(c *gin.Context) {
	ctx := c.Request.Context()

	cs := c.MustGet("cluster").(*cluster.ClientSet)
	user := c.MustGet("user").(model.User)
	if !rbac.CanAccessClusterByName(user, cs.Name) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	// Solution : Fetch and compute all 4 resource types in parallel.
	// Each goroutine owns its data — no shared state, no mutexes needed.
	var nm nodeMetrics
	var pm podMetrics
	var nsCount, svcCount int
	accAllocatable := make(map[string]int64)
	accRequested := make(map[string]int64)
	accLimited := make(map[string]int64)

	g, gctx := errgroup.WithContext(ctx)

	// Goroutine 1: List nodes + compute allocatable resources + ready count
	g.Go(func() error {
		var nodes v1.NodeList
		if err := cs.K8sClient.List(gctx, &nodes); err != nil {
			return err
		}
		nm.total = len(nodes.Items)
		// Solution : Use int64 arithmetic instead of resource.Quantity.Add()
		// (avoids big.Int operations — ~10-50x faster for the accumulation loop)
		for i := range nodes.Items {
			node := &nodes.Items[i]
			nm.cpuAllocatable += node.Status.Allocatable.Cpu().MilliValue()
			nm.memAllocatable += node.Status.Allocatable.Memory().MilliValue()
			for rn, q := range node.Status.Allocatable {
				name := string(rn)
				if isAccelerator(name) {
					accAllocatable[name] += q.Value()
				}
			}
			for _, cond := range node.Status.Conditions {
				if cond.Type == v1.NodeReady && cond.Status == v1.ConditionTrue {
					nm.ready++
					break
				}
			}
		}
		return nil
	})

	// Goroutine 2: List pods + compute resource requests/limits + running count
	g.Go(func() error {
		var pods v1.PodList
		if err := cs.K8sClient.List(gctx, &pods); err != nil {
			return err
		}
		pm.total = len(pods.Items)
		// Solution : int64 accumulation instead of resource.Quantity.Add()
		for i := range pods.Items {
			pod := &pods.Items[i]
			// Skip terminal pods; leads to over counting
			if pod.Status.Phase != v1.PodSucceeded && pod.Status.Phase != v1.PodFailed {
				for j := range pod.Spec.Containers {
					container := &pod.Spec.Containers[j]
					pm.cpuRequested += container.Resources.Requests.Cpu().MilliValue()
					pm.memRequested += container.Resources.Requests.Memory().MilliValue()
					for rn, q := range container.Resources.Requests {
						name := string(rn)
						if isAccelerator(name) {
							accRequested[name] += q.Value()
						}
					}

					if container.Resources.Limits != nil {
						if cpu := container.Resources.Limits.Cpu(); cpu != nil {
							pm.cpuLimited += cpu.MilliValue()
						}
						if mem := container.Resources.Limits.Memory(); mem != nil {
							pm.memLimited += mem.MilliValue()
						}
						for rn, q := range container.Resources.Limits {
							name := string(rn)
							if isAccelerator(name) {
								accLimited[name] += q.Value()
							}
						}
					}
				}
			}
			if utils.IsPodReady(pod) || pod.Status.Phase == v1.PodSucceeded {
				pm.running++
			}
		}
		return nil
	})

	// Goroutine 3: List namespaces (count only)
	g.Go(func() error {
		var namespaces v1.NamespaceList
		if err := cs.K8sClient.List(gctx, &namespaces); err != nil {
			return err
		}
		nsCount = len(namespaces.Items)
		return nil
	})

	// Goroutine 4: List services (count only)
	g.Go(func() error {
		var services v1.ServiceList
		if err := cs.K8sClient.List(gctx, &services); err != nil {
			return err
		}
		svcCount = len(services.Items)
		return nil
	})

	// Wait for all goroutines; if any fails the context is cancelled
	if err := g.Wait(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Merge accelerator allocatable/requested/limited maps into a sorted slice.
	// Only resources seen on nodes (allocatable) are reported; pods may request a
	// resource that no node advertises, in which case allocatable stays 0.
	acceleratorNames := make(map[string]struct{})
	for name := range accAllocatable {
		acceleratorNames[name] = struct{}{}
	}
	for name := range accRequested {
		acceleratorNames[name] = struct{}{}
	}
	for name := range accLimited {
		acceleratorNames[name] = struct{}{}
	}
	var accelerators []common.ExtendedResource
	for name := range acceleratorNames {
		accelerators = append(accelerators, common.ExtendedResource{
			Name: name,
			Resource: common.Resource{
				Allocatable: accAllocatable[name],
				Requested:   accRequested[name],
				Limited:     accLimited[name],
			},
		})
	}
	sort.Slice(accelerators, func(i, j int) bool {
		return accelerators[i].Name < accelerators[j].Name
	})

	// Memory is reported in bytes from Value(); convert to milli for the API
	// (consistent with the original behavior that used MilliValue() on Quantity)
	overview := OverviewData{
		TotalNodes:      nm.total,
		ReadyNodes:      nm.ready,
		TotalPods:       pm.total,
		RunningPods:     pm.running,
		TotalNamespaces: nsCount,
		TotalServices:   svcCount,
		PromEnabled:     cs.PromClient != nil,
		Resource: common.ResourceMetric{
			CPU: common.Resource{
				Allocatable: nm.cpuAllocatable,
				Requested:   pm.cpuRequested,
				Limited:     pm.cpuLimited,
			},
			Mem: common.Resource{
				Allocatable: nm.memAllocatable,
				Requested:   pm.memRequested,
				Limited:     pm.memLimited,
			},
		},
		Accelerators: accelerators,
	}

	c.JSON(http.StatusOK, overview)
}
