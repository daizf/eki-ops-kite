import { useQuery } from '@tanstack/react-query'

import { fetchAPI } from './shared'

export interface WatermarkConfig {
  watermarkEnabled: boolean
}

export const fetchWatermarkConfig = async (): Promise<WatermarkConfig> => {
  return fetchAPI<WatermarkConfig>('/watermark')
}

export const useWatermarkConfig = () => {
  return useQuery({
    queryKey: ['watermark-config'],
    queryFn: fetchWatermarkConfig,
    staleTime: 30000,
    retry: false,
  })
}
