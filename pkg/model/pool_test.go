package model

import (
	"testing"
)

func TestApplyImageRegistry(t *testing.T) {
	tests := []struct {
		name     string
		registry string
		image    string
		want     string
	}{
		{
			name:     "empty registry returns image as-is",
			registry: "",
			image:    "zzde/kubectl:latest",
			want:     "zzde/kubectl:latest",
		},
		{
			name:     "registry prefixes simple image",
			registry: "registry.example.com",
			image:    "zzde/kubectl:latest",
			want:     "registry.example.com/zzde/kubectl:latest",
		},
		{
			name:     "registry prefixes library image",
			registry: "registry.example.com",
			image:    "busybox:latest",
			want:     "registry.example.com/busybox:latest",
		},
		{
			name:     "image with existing registry is not double-prefixed",
			registry: "registry.example.com",
			image:    "ghcr.io/org/image:1.0",
			want:     "ghcr.io/org/image:1.0",
		},
		{
			name:     "image with port in registry is not double-prefixed",
			registry: "registry.example.com",
			image:    "myregistry:5000/myimage:latest",
			want:     "myregistry:5000/myimage:latest",
		},
		{
			name:     "registry with trailing slash is trimmed",
			registry: "registry.example.com/",
			image:    "zzde/kubectl:latest",
			want:     "registry.example.com/zzde/kubectl:latest",
		},
		{
			name:     "library prefix with registry is prefixed",
			registry: "registry.example.com",
			image:    "library/nginx:latest",
			want:     "registry.example.com/library/nginx:latest",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ApplyImageRegistry(tt.registry, tt.image)
			if got != tt.want {
				t.Errorf("ApplyImageRegistry(%q, %q) = %q, want %q", tt.registry, tt.image, got, tt.want)
			}
		})
	}
}
