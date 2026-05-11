import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Search, Settings } from 'lucide-react'

import Icon from '@/assets/icon.svg'
import { Cluster } from '@/types/api'
import { useCluster as useClusterContext } from '@/hooks/use-cluster'
import { useAuth } from '@/contexts/auth-context'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { LanguageToggle } from '@/components/language-toggle'
import { ModeToggle } from '@/components/mode-toggle'
import { UserMenu } from '@/components/user-menu'
import { VersionInfo } from '@/components/version-info'
import { ClusterPanel } from '@/components/cluster-panel'

export function ClusterSearch() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const clusterContext = useClusterContext()
  const { clusters, isLoading, setCurrentCluster, currentCluster } = clusterContext
  const { user } = useAuth()
  const isAdmin = user?.isAdmin() ?? false
  const [searchQuery, setSearchQuery] = useState('')
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  const filteredClusters = useMemo(() => {
    if (!searchQuery.trim() || !clusters) {
      return []
    }
    const query = searchQuery.toLowerCase()
    return clusters.filter((cluster) => {
      const nameMatch = cluster.name?.toLowerCase().includes(query) ?? false
      const idMatch = cluster.clusterId?.toLowerCase().includes(query) ?? false
      const poolMatch = cluster.poolId?.toLowerCase().includes(query) ?? false
      const categoryMatch = cluster.category?.toLowerCase().includes(query) ?? false
      return nameMatch || idMatch || poolMatch || categoryMatch
    })
  }, [clusters, searchQuery])

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!filteredClusters.length || e.key === 'Tab') {
        return
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHoveredIndex((prev) => {
          if (prev === null) return 0
          return prev < filteredClusters.length - 1 ? prev + 1 : prev
        })
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHoveredIndex((prev) => {
          if (prev === null) return 0
          return prev > 0 ? prev - 1 : 0
        })
      } else if (e.key === 'Enter' && hoveredIndex !== null) {
        e.preventDefault()
        const selectedCluster = filteredClusters[hoveredIndex]
        if (selectedCluster) {
          setCurrentCluster(selectedCluster.clusterId)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [filteredClusters, hoveredIndex, setCurrentCluster])

  // Auto-select first cluster when search results change
  useEffect(() => {
    if (filteredClusters.length > 0) {
      setHoveredIndex(0)
    }
  }, [filteredClusters])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
  }

  const handleClusterClick = (cluster: Cluster) => {
    setCurrentCluster(cluster.clusterId)
  }

  const handleClusterHover = (index: number) => {
    setHoveredIndex(index)
  }

  const handleMouseLeave = () => {
    setHoveredIndex(null)
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-background to-muted/20">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <div className="flex w-full items-center gap-2">
          <div className="flex items-center gap-2">
            <img src={Icon} alt="Kite Logo" className="h-8 w-8" />
            <div className="flex flex-col">
              <span className="text-base font-semibold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
                EKI-Ops
              </span>
              <VersionInfo />
            </div>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate('/settings')}
              >
                <Settings className="h-5 w-5" />
                <span className="sr-only">Settings</span>
              </Button>
            )}
            <LanguageToggle />
            <ModeToggle />
            <UserMenu />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex">
        {/* Left Sidebar - Cluster Panel */}
        <aside className="w-80 border-r bg-muted/10 flex-shrink-0 overflow-y-auto">
          <div className="p-4">
            <h2 className="text-sm font-semibold text-muted-foreground mb-4">
              {t('clusterSearch.clustersByCategory')}
            </h2>
            <ClusterPanel
              clusters={clusters || []}
              onClusterClick={handleClusterClick}
              currentCluster={currentCluster}
            />
          </div>
        </aside>

        <div className="flex-1 flex flex-col p-4">
          <div className="flex-1 flex flex-col items-center justify-start pt-24 sm:pt-32 md:pt-40">
            <div className="w-full max-w-2xl space-y-8">
          {/* Logo/Title */}
          <div className="text-center space-y-2">
            <h1 className="text-4xl font-bold text-foreground">
              {t('clusterSearch.title')}
            </h1>
            <p className="text-muted-foreground">
              {t('clusterSearch.description')}
            </p>
          </div>

          {/* Search Form */}
          <form onSubmit={handleSearch} className="relative">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                type="text"
                placeholder={t('clusterSearch.placeholder')}
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setHoveredIndex(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
                    e.preventDefault()
                  }
                }}
                className="h-14 pl-12 pr-4 text-lg shadow-lg"
                autoFocus
              />
            </div>
          </form>

          {/* Search Results */}
          {searchQuery.trim() && (
            <div className="space-y-4">
              {isLoading ? (
                <div className="text-center text-muted-foreground py-8">
                  {t('clusterSearch.loading')}
                </div>
              ) : filteredClusters.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  {t('clusterSearch.noResults', { query: searchQuery })}
                </div>
              ) : (
                <div className="bg-card border rounded-lg shadow-lg overflow-hidden">
                  <div className="px-4 py-3 border-b bg-muted/30">
                    <p className="text-sm text-muted-foreground">
                      {t('clusterSearch.resultsCount', { count: filteredClusters.length })}
                    </p>
                  </div>
                  <div className="divide-y">
                    {filteredClusters.map((cluster, index) => (
                      <button
                        key={cluster.id}
                        onClick={() => handleClusterClick(cluster)}
                        onMouseEnter={() => handleClusterHover(index)}
                        onMouseLeave={handleMouseLeave}
                        className={`w-full px-4 py-4 text-left transition-colors flex items-center justify-between group ${
                          hoveredIndex === index ? 'bg-accent' : 'hover:bg-accent'
                        }`}
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-foreground transition-colors">
                              {cluster.name}
                            </span>
                            {cluster.isDefault && (
                              <Badge variant="secondary" className="text-xs">
                                {t('clusterSearch.badges.default')}
                              </Badge>
                            )}
                            {cluster.error && (
                              <Badge variant="destructive" className="text-xs">
                                {t('clusterSearch.badges.error')}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <span className="font-mono">{cluster.clusterId}</span>
                            {cluster.category && (
                              <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-200">
                                {cluster.category}
                              </Badge>
                            )}
                            {cluster.pool?.poolName && (
                              <Badge variant="outline" className="text-xs">
                                {t('clusterSearch.badges.pool', { name: cluster.pool.poolName })}
                              </Badge>
                            )}
                            {cluster.version && (
                              <span>{cluster.version}</span>
                            )}
                            {cluster.description && (
                              <span className="truncate max-w-xs">
                                {cluster.description}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                          <Search className="h-5 w-5 text-muted-foreground" />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Quick Stats */}
          {!searchQuery.trim() && !isLoading && clusters && clusters.length > 0 && (
            <div className="text-center space-y-2">
              <p className="text-muted-foreground text-sm">
                {t('clusterSearch.availableCount', { count: clusters.length })}
              </p>
            </div>
          )}
          </div>
          </div>
        </div>
      </div>
    </div>
  )
}
