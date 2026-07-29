import {
  type CollisionDetection,
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  type Modifier,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  restrictToHorizontalAxis,
  restrictToParentElement,
  restrictToVerticalAxis,
} from '@dnd-kit/modifiers';
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  type SortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { type ReactNode, useState } from 'react';
import { cn } from '@/lib/utils';

export type DragHandleProps = Record<string, unknown>;
export type OrderReorder = (
  current: string[],
  activeId: string,
  overId: string,
) => string[];

// Axis-locked groups stay inside their owning list or row. Free card grids
// omit modifiers so items can move in both directions.
export const LIST_DRAG = [restrictToVerticalAxis, restrictToParentElement];
export const ROW_DRAG = [restrictToHorizontalAxis, restrictToParentElement];

export const moveOrderItem: OrderReorder = (current, activeId, overId) =>
  arrayMove(current, current.indexOf(activeId), current.indexOf(overId));

// Persisted card order; falls back to `ids` when the stored set no longer
// matches (cards added/removed since it was saved).
export const useStoredOrder = (
  key: string,
  ids: string[],
  reorder: OrderReorder = moveOrderItem,
): { order: string[]; onDragEnd: (event: DragEndEvent) => void } => {
  const [order, setOrder] = useState<string[]>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (
        Array.isArray(stored) &&
        stored.length === ids.length &&
        ids.every((id) => stored.includes(id))
      ) {
        return stored as string[];
      }
    } catch {
      // corrupted storage — fall through to default order
    }
    return ids;
  });

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    setOrder((current) => {
      const next = reorder(current, String(active.id), String(over.id));
      localStorage.setItem(key, JSON.stringify(next));
      return next;
    });
  };

  return { order, onDragEnd };
};

export const SortableGrid = ({
  order,
  onDragEnd,
  modifiers,
  collisionDetection = closestCenter,
  strategy = rectSortingStrategy,
  className,
  children,
}: {
  order: string[];
  onDragEnd: (event: DragEndEvent) => void;
  // dnd-kit modifiers, e.g. to confine dragging to the container (see LIST_DRAG).
  modifiers?: Modifier[];
  collisionDetection?: CollisionDetection;
  strategy?: SortingStrategy;
  className?: string;
  children: ReactNode;
}) => {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      modifiers={modifiers}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={order} strategy={strategy}>
        <div className={className}>{children}</div>
      </SortableContext>
    </DndContext>
  );
};

// `children` as a function receives the drag-handle props (grip-in-header
// pattern); plain children make the whole item the handle.
export const SortableItem = ({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode | ((handleProps: DragHandleProps) => ReactNode);
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isSorting,
  } = useSortable({
    id,
    transition: {
      duration: 200,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    },
  });
  // Translate only: scale transforms would stretch chart canvases.
  const style = { transform: CSS.Translate.toString(transform), transition };
  const handleProps: DragHandleProps = { ...attributes, ...listeners };
  const isRenderProp = typeof children === 'function';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        className,
        !isRenderProp && 'cursor-grab active:cursor-grabbing',
        isSorting && 'will-change-transform',
        // Opaque backing: cards have translucent fills; without this the
        // floating card would composite over whatever it crosses.
        isDragging && 'z-50 bg-bg shadow-lg',
      )}
      {...(isRenderProp ? {} : handleProps)}
    >
      {isRenderProp ? children(handleProps) : children}
    </div>
  );
};
