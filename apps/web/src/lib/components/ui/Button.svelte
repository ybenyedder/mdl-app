<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';

  type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
  type Size = 'sm' | 'md' | 'lg';

  interface BaseProps {
    variant?: Variant;
    size?: Size;
    loading?: boolean;
    disabled?: boolean;
    fullWidth?: boolean;
    href?: string;
    class?: string;
    children?: Snippet;
  }

  type Props = BaseProps &
    Omit<HTMLButtonAttributes, keyof BaseProps> &
    Omit<HTMLAnchorAttributes, keyof BaseProps>;

  let {
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled = false,
    fullWidth = false,
    href,
    type = 'button',
    class: className = '',
    children,
    ...rest
  }: Props = $props();

  const variantClasses: Record<Variant, string> = {
    primary:
      'bg-[#18181b] text-white hover:bg-[#27272a] dark:bg-[#f4f4f5] dark:text-[#111113] dark:hover:bg-white',
    secondary:
      'bg-card text-ink border border-border hover:bg-surface-2',
    ghost: 'bg-transparent text-ink/80 hover:bg-surface-2 hover:text-ink',
    danger: 'bg-[#dc2626] text-white hover:bg-[#b91c1c]'
  };

  const sizeClasses: Record<Size, string> = {
    sm: 'h-9 px-3.5 text-[13px] gap-1.5 rounded-[10px]',
    md: 'min-h-11 px-4 text-[15px] gap-2 rounded-[12px]',
    lg: 'min-h-12 px-5 text-[15px] gap-2 rounded-[14px]'
  };

  const baseClass = $derived(
    [
      'inline-flex items-center justify-center font-medium tracking-[-0.01em] select-none gpu-press',
      'transition-[background-color,color,opacity,transform,filter] duration-150 ease-out',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
      'disabled:opacity-45 disabled:pointer-events-none',
      variantClasses[variant],
      sizeClasses[size],
      fullWidth ? 'w-full' : '',
      className
    ]
      .filter(Boolean)
      .join(' ')
  );
</script>

{#if href}
  <a
    {href}
    class={baseClass}
    aria-disabled={disabled || loading ? 'true' : undefined}
    {...rest as HTMLAnchorAttributes}
  >
    {@render children?.()}
  </a>
{:else}
  <button
    {type}
    class={baseClass}
    disabled={disabled || loading}
    aria-busy={loading ? 'true' : undefined}
    {...rest as HTMLButtonAttributes}
  >
    {#if loading}
      <svg
        class="h-4 w-4 animate-spin shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" />
        <path
          class="opacity-90"
          fill="currentColor"
          d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z"
        />
      </svg>
    {/if}
    {@render children?.()}
  </button>
{/if}
