import {
  cloneElement,
  type ReactElement,
  type Ref,
  useCallback,
  useLayoutEffect,
  useState,
} from 'react';
import { Tooltip, type TooltipProps } from '@/components/dither-kit/tooltip';

type RefChildProps = {
  ref?: Ref<HTMLElement>;
};

export const OverflowTooltip = ({
  children,
  disabled = false,
  ...props
}: Omit<TooltipProps, 'asChild' | 'children'> & {
  children: ReactElement;
}) => {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const measure = useCallback(() => {
    setOverflowing(
      node
        ? node.scrollWidth > node.clientWidth + 1 ||
            node.scrollHeight > node.clientHeight + 1
        : false,
    );
  }, [node]);

  useLayoutEffect(() => {
    measure();
    if (!node || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [measure, node, props.content]);

  const childWithRef = cloneElement(children as ReactElement<RefChildProps>, {
    ref: setNode,
  });

  return (
    <Tooltip {...props} asChild disabled={disabled || !overflowing}>
      {childWithRef}
    </Tooltip>
  );
};
