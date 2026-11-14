<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Padding = 'none' | 'sm' | 'md' | 'lg';
  type ElementTag = 'div' | 'section' | 'article' | 'aside';

  interface Props extends HTMLAttributes<HTMLElement> {
    padding?: Padding;
    hover?: boolean;
    animate?: boolean;
    stagger?: number;
    as?: ElementTag;
    class?: string;
    children?: Snippet;
  }

  let {
    padding = 'md',
    hover = false,
    animate = false,
    stagger = 0,
    as = 'div',
    class: className = '',
    children,
    ...rest
  }: Props = $props();

  const paddingClasses: Record<Padding, string> = {
    none: 'p-0',
    sm: 'p-3.5',
    md: 'p-4 sm:p-5',
    lg: 'p-5 sm:p-6'
  };

  const classes = $derived(
    [
      'rounded-[16px] bg-card border border-border apple-shadow-card',
      paddingClasses[padding],
      hover
        ? 'transition-[border-color,background-color,transform] duration-150 ease-out hover:border-ink/15 active:scale-[0.99]'
        : '',
      animate ? 'animate-spring' : '',
      className
    ]
      .filter(Boolean)
      .join(' ')
  );

  const inlineStyle = $derived(
    animate && stagger > 0 ? `animation-delay: ${Math.min(stagger * 35, 220)}ms;` : undefined
  );
</script>

<svelte:element this={as} class={classes} style={inlineStyle} {...rest}>
  {@render children?.()}
</svelte:element>
