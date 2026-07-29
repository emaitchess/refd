import { cn } from '@/lib/utils';

export const ShortcutKeys = ({ keys }: { keys: string }) =>
  keys.split(' ').map((key, index) => (
    <kbd key={`${key}-${index}`} className="kbd h-4 min-w-4 text-[10px]">
      {key}
    </kbd>
  ));

// Right-aligned chord hint, revealed on row hover (expanded rail only).
export const KeyHint = ({ keys, show }: { keys: string; show: boolean }) => (
  <span
    className={cn(
      'ml-auto hidden items-center gap-0.5 opacity-0 transition-opacity duration-150 lg:flex',
      show && 'group-hover:opacity-100',
    )}
  >
    <ShortcutKeys keys={keys} />
  </span>
);
