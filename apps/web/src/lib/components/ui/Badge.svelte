<script lang="ts">
  import type { Snippet } from 'svelte';

  type Variant = 'brand' | 'neutral' | 'success' | 'warning' | 'danger';
  type Size = 'sm' | 'md';

  interface Props {
    variant?: Variant;
    size?: Size;
    dot?: boolean;
    class?: string;
    children?: Snippet;
  }

  let {
    variant = 'neutral',
    size = 'md',
    dot = false,
    class: className = '',
    children
  }: Props = $props();

  const variantClasses: Record<Variant, string> = {
    brand: 'bg-brand-soft text-brand-ink',
    neutral: 'bg-surface-2 text-muted',
    success: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400',
    warning: 'bg-amber-500/12 text-amber-700 dark:text-amber-400',
    danger: 'bg-red-500/12 text-red-700 dark:text-red-400'
  };

  const dotColors: Record<Variant, string> = {
    brand: 'bg-brand',
    neutral: 'bg-muted',
    success: 'bg-[#34C759]',
    warning: 'bg-[#FF9F0A]',
    danger: 'bg-[#FF3B30]'
  };

  const sizeClasses: Record<Size, string> = {
    sm: 'px-2 py-0.5 text-[11px] gap-1.5',
    md: 'px-2.5 py-0.5 text-[12px] gap-1.5'
  };
</script>

<span
  class={[
    'inline-flex items-center rounded-full font-medium tracking-[-0.01em] whitespace-nowrap',
    variantClasses[variant],
    sizeClasses[size],
    className
  ]
    .filter(Boolean)
    .join(' ')}
>
  {#if dot}
    <span class={`h-1.5 w-1.5 rounded-full shrink-0 ${dotColors[variant]}`} aria-hidden="true"></span>
  {/if}
  {@render children?.()}
</span>
