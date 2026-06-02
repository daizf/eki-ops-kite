package kcs

import (
	"fmt"
	"net/url"
	"strings"

	"gopkg.in/yaml.v3"
)

// jsonToKubeconfigYAML converts a JSON-encoded kubeconfig object to YAML string,
// replacing the server address in each cluster entry with the first apiEndpoint.
func jsonToKubeconfigYAML(jsonData []byte, apiEndpoints []string) (string, error) {
	var obj map[string]interface{}
	if err := yaml.Unmarshal(jsonData, &obj); err != nil {
		return "", fmt.Errorf("unmarshal kubeconfig: %w", err)
	}

	if len(apiEndpoints) > 0 {
		replaceServer(obj, apiEndpoints[0])
	}

	yamlData, err := yaml.Marshal(obj)
	if err != nil {
		return "", fmt.Errorf("marshal kubeconfig to YAML: %w", err)
	}

	return string(yamlData), nil
}

// replaceServer walks the kubeconfig and replaces every cluster.server value
// with the provided endpoint address.
func replaceServer(obj map[string]interface{}, endpoint string) {
	if endpoint == "" {
		return
	}
	if !strings.HasPrefix(endpoint, "https://") && !strings.HasPrefix(endpoint, "http://") {
		endpoint = "https://" + endpoint
	}

	clusters, ok := obj["clusters"].([]interface{})
	if !ok {
		return
	}
	for _, c := range clusters {
		clusterMap, ok := c.(map[string]interface{})
		if !ok {
			continue
		}
		clusterData, ok := clusterMap["cluster"].(map[string]interface{})
		if !ok {
			continue
		}
		server, ok := clusterData["server"].(string)
		if !ok {
			continue
		}
		u, err := url.Parse(server)
		if err != nil {
			continue
		}
		epURL, err := url.Parse(endpoint)
		if err != nil {
			continue
		}
		u.Host = epURL.Host
		u.Scheme = epURL.Scheme
		clusterData["server"] = u.String()
	}
}