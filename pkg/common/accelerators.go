package common

import "strings"

var KnownAcceleratorResources = []string{
	"nvidia.com/gpu",
	"huawei.com/Ascend",
	"cambricon.com/mlu",
	"intel.com/gpu",
	"intel.com/sgpu",
	"baidu.com/xpu",
	"hygon.com/dcu",
	"kunlunxin.com/xpu",
	"alibabacloud.com/ppu",
}

func IsAccelerator(name string) bool {
	for _, p := range KnownAcceleratorResources {
		if name == p || strings.HasPrefix(name, p) {
			return true
		}
	}
	return false
}
