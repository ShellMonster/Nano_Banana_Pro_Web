import { useMemo } from 'react';
import { useGenerateStore } from '../store/generateStore';
import { useHistoryStore } from '../store/historyStore';
import type { GeneratedImage, HistoryItem } from '../types';

const sortGenerateImages = (images: GeneratedImage[]) =>
  [...images].sort((a, b) => {
    const aPending = a.status === 'pending' && !a.url;
    const bPending = b.status === 'pending' && !b.url;
    if (aPending && !bPending) return -1;
    if (!aPending && bPending) return 1;
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
  });

const buildDisplayImages = (
  taskId: string | null,
  images: GeneratedImage[],
  historyItems: HistoryItem[]
) => {
  if (!taskId) return images;

  const currentTask = historyItems.find((item) => item.id === taskId);
  if (!currentTask) return images;

  const localTaskImages = images.filter((img) => img.taskId === taskId);
  const localOtherImages = images.filter((img) => img.taskId !== taskId);
  const hasResolvedLocalTaskImages = localTaskImages.some((img) => img.status === 'failed' || Boolean(img.url));

  if (!hasResolvedLocalTaskImages && (!currentTask.images || currentTask.images.length === 0)) {
    return images;
  }

  const imageMap = new Map<string, GeneratedImage>();

  (currentTask.images || []).forEach((img) => {
    imageMap.set(img.id, {
      ...img,
      previewSource: 'generate'
    });
  });

  localTaskImages.forEach((img) => {
    if (img.status === 'pending' && !img.url) {
      imageMap.set(img.id, img);
      return;
    }

    const prev = imageMap.get(img.id);
    imageMap.set(img.id, prev ? { ...prev, ...img } : img);
  });

  return [...sortGenerateImages(Array.from(imageMap.values())), ...localOtherImages];
};

export function useGenerateDisplayImages() {
  const taskId = useGenerateStore((s) => s.taskId);
  const images = useGenerateStore((s) => s.images);
  const historyItems = useHistoryStore((s) => s.items);

  return useMemo(() => buildDisplayImages(taskId, images, historyItems), [taskId, images, historyItems]);
}
