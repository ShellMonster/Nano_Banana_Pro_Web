import React, { useEffect, useMemo } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { useInternalDragStore } from '../../store/internalDragStore';
import { cn } from '../common/Button';

const DRAG_THRESHOLD = 6;

export function InternalDragLayer() {
  const {
    isActive,
    isDragging,
    activePointerId,
    startX,
    startY,
    x,
    y,
    payload,
    dropTarget,
    isOverDropTarget,
    updatePosition,
    setDragging,
    setOverDropTarget,
    triggerDrop,
    endDrag,
  } = useInternalDragStore();

  useEffect(() => {
    if (!isActive || activePointerId === null) return;

    const handleMove = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!isDragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        setDragging(true);
      }

      if (isDragging) {
        if (e.cancelable) e.preventDefault();
      }

      updatePosition(e.clientX, e.clientY);

      if (dropTarget) {
        const rect = dropTarget.getBoundingClientRect();
        const over =
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom;
        if (over !== isOverDropTarget) {
          setOverDropTarget(over);
        }
      }
    };

    const handleUp = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return;

      let over = false;
      if (dropTarget) {
        const rect = dropTarget.getBoundingClientRect();
        over =
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom;
      }

      if (isDragging && payload && over) {
        triggerDrop(payload);
      }

      endDrag();
    };

    window.addEventListener('pointermove', handleMove, true);
    window.addEventListener('pointerup', handleUp, true);
    window.addEventListener('pointercancel', handleUp, true);

    return () => {
      window.removeEventListener('pointermove', handleMove, true);
      window.removeEventListener('pointerup', handleUp, true);
      window.removeEventListener('pointercancel', handleUp, true);
    };
  }, [
    activePointerId,
    dropTarget,
    endDrag,
    isActive,
    isDragging,
    isOverDropTarget,
    payload,
    setDragging,
    setOverDropTarget,
    startX,
    startY,
    triggerDrop,
    updatePosition,
  ]);

  useEffect(() => {
    if (!isDragging) return;
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.userSelect = prev;
    };
  }, [isDragging]);

  const ghostUrl = useMemo(() => {
    if (!payload) return '';
    return payload.thumbnailUrl || payload.url || '';
  }, [payload]);

  if (!isDragging || !payload) return null;

  return (
    <div className="fixed inset-0 z-[9999] pointer-events-none">
      <div
        className={cn(
          'absolute flex items-center justify-center w-16 h-16 rounded-2xl bg-white/90 shadow-lg border border-white/60',
          isOverDropTarget ? 'ring-2 ring-blue-500' : 'ring-1 ring-slate-200'
        )}
        style={{
          transform: `translate3d(${x + 12}px, ${y + 12}px, 0)`,
        }}
      >
        {ghostUrl ? (
          <img src={ghostUrl} alt="drag-preview" className="w-full h-full object-cover rounded-2xl" />
        ) : (
          <ImageIcon className="w-6 h-6 text-slate-400" />
        )}
      </div>
    </div>
  );
}
