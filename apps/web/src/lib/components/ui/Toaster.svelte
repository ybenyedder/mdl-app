<script lang="ts">
  import { toast, type ToastType } from '$lib/stores/toast.svelte';

  const dotStyles: Record<ToastType, string> = {
    success: 'bg-[#34C759]',
    danger: 'bg-[#FF3B30]',
    warning: 'bg-[#FF9F0A]',
    info: 'bg-brand'
  };
</script>

<div
  class="pointer-events-none fixed left-3 right-3 sm:left-auto sm:right-5 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] sm:bottom-auto sm:top-4 z-[70] flex flex-col gap-2 sm:w-[360px]"
  aria-live="polite"
  aria-atomic="false"
>
  {#each toast.items as item (item.id)}
    <div
      role={item.type === 'danger' ? 'alert' : 'status'}
      class="pointer-events-auto animate-toast flex items-start gap-3 rounded-2xl border border-border bg-card/96 px-4 py-3 apple-shadow-elevated backdrop-blur-xl"
    >
      <span class={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotStyles[item.type]}`} aria-hidden="true"></span>
      <div class="min-w-0 flex-1">
        <p class="text-[13px] font-semibold leading-snug text-ink">{item.title}</p>
        {#if item.message}
          <p class="mt-0.5 text-[12px] leading-snug text-muted">{item.message}</p>
        {/if}
      </div>
      <button
        type="button"
        onclick={() => toast.dismiss(item.id)}
        class="shrink-0 rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-ink transition-colors focus-visible:outline-2 focus-visible:outline-brand"
        aria-label="Fermer la notification"
      >
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  {/each}
</div>
