/**
 * 从已启用 Providers 拉平为「provider/modelId」选项列表（与任务 overrideModel 格式一致）
 */
import { ref } from 'vue';
import { getProviders } from '@/api/config';

export interface FlatConfigModelItem {
  value: string;
  label: string;
  provider: string;
  providerId: string;
}

export function useFlatConfigModels() {
  const flatModelList = ref<FlatConfigModelItem[]>([]);

  async function loadFlatModels(): Promise<void> {
    try {
      const result = await getProviders();
      if (!result.success || !result.data?.providers) {
        flatModelList.value = [];
        return;
      }

      const providersConfig = result.data.providers;
      const items: FlatConfigModelItem[] = [];

      for (const [providerKey, provider] of Object.entries(providersConfig)) {
        if (!provider.enabled) continue;

        const models = provider.models || [];
        for (const model of models) {
          items.push({
            value: `${providerKey}/${model.id}`,
            label: model.name,
            provider: provider.name,
            providerId: providerKey
          });
        }
      }

      flatModelList.value = items;
    } catch (err) {
      console.warn('[useFlatConfigModels] load failed:', err);
      flatModelList.value = [];
    }
  }

  return { flatModelList, loadFlatModels };
}
