import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { cn } from '@/lib/utils';

export const OnboardingScrollArea = ({
  children,
  className,
  viewportClassName,
  contentClassName,
  label = 'Scroll content',
  scrollbarClassName,
}: {
  children: ReactNode;
  className?: string;
  viewportClassName?: string;
  contentClassName?: string;
  label?: string;
  scrollbarClassName?: string;
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollId = useId();
  const dragRef = useRef<{
    pointerId: number;
    startY: number;
    startScrollTop: number;
  } | null>(null);
  const [scrollbar, setScrollbar] = useState({
    visible: false,
    height: 0,
    top: 0,
    max: 0,
    value: 0,
  });

  const syncScrollbar = useCallback(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    const viewport = element.clientHeight;
    const content = element.scrollHeight;
    if (content <= viewport + 1) {
      setScrollbar({ visible: false, height: 0, top: 0, max: 0, value: 0 });
      return;
    }
    const max = content - viewport;
    const height = Math.max(36, (viewport / content) * viewport);
    const top = (element.scrollTop / max) * Math.max(0, viewport - height);
    setScrollbar({
      visible: true,
      height,
      top,
      max,
      value: element.scrollTop,
    });
  }, []);

  useEffect(() => {
    syncScrollbar();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(syncScrollbar);
    if (scrollRef.current) {
      observer.observe(scrollRef.current);
    }
    if (contentRef.current) {
      observer.observe(contentRef.current);
    }
    return () => observer.disconnect();
  }, [syncScrollbar]);

  const scrollTo = (top: number) => {
    if (!scrollRef.current) {
      return;
    }
    scrollRef.current.scrollTop = Math.max(0, Math.min(scrollbar.max, top));
  };

  const onTrackPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || !scrollRef.current) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const travel = Math.max(1, rect.height - scrollbar.height);
    const thumbTop = Math.max(
      0,
      Math.min(travel, event.clientY - rect.top - scrollbar.height / 2),
    );
    scrollTo((thumbTop / travel) * scrollbar.max);
  };

  const onThumbPointerDown = (event: PointerEvent<HTMLSpanElement>) => {
    if (!scrollRef.current) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startScrollTop: scrollRef.current.scrollTop,
    };
  };

  const onThumbPointerMove = (event: PointerEvent<HTMLSpanElement>) => {
    const drag = dragRef.current;
    const element = scrollRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !element) {
      return;
    }
    const travel = Math.max(1, element.clientHeight - scrollbar.height);
    scrollTo(
      drag.startScrollTop +
        ((event.clientY - drag.startY) / travel) * scrollbar.max,
    );
  };

  const stopDragging = (event: PointerEvent<HTMLSpanElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onScrollbarKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const viewport = scrollRef.current?.clientHeight ?? 0;
    const next = {
      ArrowUp: scrollbar.value - 40,
      ArrowDown: scrollbar.value + 40,
      PageUp: scrollbar.value - viewport * 0.8,
      PageDown: scrollbar.value + viewport * 0.8,
      Home: 0,
      End: scrollbar.max,
    }[event.key];
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    scrollTo(next);
  };

  return (
    <div className={cn('relative min-w-0', className)}>
      <div
        id={scrollId}
        ref={scrollRef}
        onScroll={syncScrollbar}
        className={cn(
          'onboarding-step-scroll min-w-0 overflow-y-auto overflow-x-hidden',
          viewportClassName,
        )}
      >
        <div ref={contentRef} className={cn('min-w-0', contentClassName)}>
          {children}
        </div>
      </div>
      {scrollbar.visible ? (
        <div
          role="scrollbar"
          aria-controls={scrollId}
          aria-label={label}
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={Math.round(scrollbar.max)}
          aria-valuenow={Math.round(scrollbar.value)}
          tabIndex={0}
          onKeyDown={onScrollbarKeyDown}
          onPointerDown={onTrackPointerDown}
          className={cn(
            'group/scrollbar absolute inset-y-0 right-0 z-10 w-3 cursor-pointer touch-none',
            scrollbarClassName,
          )}
        >
          <span
            onPointerDown={onThumbPointerDown}
            onPointerMove={onThumbPointerMove}
            onPointerUp={stopDragging}
            onPointerCancel={stopDragging}
            className="group/thumb absolute inset-x-0 cursor-grab active:cursor-grabbing"
            style={{ height: scrollbar.height, top: scrollbar.top }}
          >
            <span className="pointer-events-none absolute inset-y-0 right-0 w-px bg-secondary/45 transition-[width,background-color] duration-150 group-hover/scrollbar:w-1 group-hover/scrollbar:bg-secondary/70 group-focus-visible/scrollbar:w-1 group-focus-visible/scrollbar:bg-secondary/70 group-active/thumb:w-1 group-active/thumb:bg-secondary/70" />
          </span>
        </div>
      ) : null}
    </div>
  );
};
