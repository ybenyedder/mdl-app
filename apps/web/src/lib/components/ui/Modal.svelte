<script lang="ts">
	import type { Snippet } from 'svelte';

	type Size = 'sm' | 'md' | 'lg';

	interface Props {
		open?: boolean;
		title?: string;
		description?: string;
		size?: Size;
		closeOnBackdrop?: boolean;
		closeOnEscape?: boolean;
		onclose?: () => void;
		class?: string;
		children?: Snippet;
		footer?: Snippet;
	}

	let {
		open = $bindable(false),
		title,
		description,
		size = 'md',
		closeOnBackdrop = true,
		closeOnEscape = true,
		onclose,
		class: className = '',
		children,
		footer
	}: Props = $props();

	const uid = $props.id();
	const titleId = `${uid}-title`;
	const descId = `${uid}-desc`;

	let dialogEl: HTMLDivElement | undefined = $state();
	let previousFocus: HTMLElement | null = null;
	let dragStartY = $state<number | null>(null);
	let dragOffsetY = $state(0);

	const sizeClasses: Record<Size, string> = {
		sm: 'sm:max-w-sm',
		md: 'sm:max-w-lg',
		lg: 'sm:max-w-2xl'
	};

	function close() {
		if (!open) return;
		dragStartY = null;
		dragOffsetY = 0;
		open = false;
		onclose?.();
	}

	function handleSheetTouchStart(event: TouchEvent) {
		if (event.touches.length !== 1) return;
		dragStartY = event.touches[0].clientY;
		dragOffsetY = 0;
	}

	function handleSheetTouchMove(event: TouchEvent) {
		if (dragStartY === null || event.touches.length !== 1) return;
		const delta = event.touches[0].clientY - dragStartY;
		dragOffsetY = delta > 0 ? Math.min(delta, 240) : 0;
	}

	function handleSheetTouchEnd() {
		if (dragStartY === null) return;
		if (dragOffsetY > 88) {
			close();
		} else {
			dragOffsetY = 0;
		}
		dragStartY = null;
	}

	function getFocusableElements(container: HTMLElement): HTMLElement[] {
		const selector = [
			'a[href]',
			'button:not([disabled])',
			'textarea:not([disabled])',
			'input:not([disabled]):not([type="hidden"])',
			'select:not([disabled])',
			'[tabindex]:not([tabindex="-1"])'
		].join(', ');

		return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
			(el) => !el.hasAttribute('disabled') && el.offsetParent !== null
		);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!open) return;

		if (event.key === 'Escape' && closeOnEscape) {
			event.preventDefault();
			close();
			return;
		}

		if (event.key === 'Tab' && dialogEl) {
			const focusables = getFocusableElements(dialogEl);
			if (focusables.length === 0) {
				event.preventDefault();
				dialogEl.focus();
				return;
			}

			const first = focusables[0];
			const last = focusables[focusables.length - 1];
			const active = document.activeElement as HTMLElement | null;

			if (event.shiftKey) {
				if (active === first || !dialogEl.contains(active)) {
					event.preventDefault();
					last.focus();
				}
			} else if (active === last || !dialogEl.contains(active)) {
				event.preventDefault();
				first.focus();
			}
		}
	}

	function handleBackdropClick(event: MouseEvent) {
		if (closeOnBackdrop && event.target === event.currentTarget) {
			close();
		}
	}

	$effect(() => {
		if (typeof document === 'undefined') return;

		if (open) {
			dragStartY = null;
			dragOffsetY = 0;
			previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
			const prevOverflow = document.body.style.overflow;
			document.body.style.overflow = 'hidden';

			queueMicrotask(() => {
				if (!dialogEl) return;
				const focusables = getFocusableElements(dialogEl);
				if (focusables.length > 0) {
					focusables[0].focus();
				} else {
					dialogEl.focus();
				}
			});

			return () => {
				document.body.style.overflow = prevOverflow;
				if (previousFocus && previousFocus.isConnected) {
					previousFocus.focus();
				}
			};
		}
	});
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div
		class="animate-backdrop fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 backdrop-blur-[4px] sm:items-center sm:p-4"
		role="presentation"
		onclick={handleBackdropClick}
	>
		<div
			bind:this={dialogEl}
			role="dialog"
			aria-modal="true"
			aria-labelledby={title ? titleId : undefined}
			aria-describedby={description ? descId : undefined}
			tabindex="-1"
			style={dragOffsetY > 0
				? `transform: translate3d(0, ${dragOffsetY}px, 0); transition: none;`
				: undefined}
			class={`animate-sheet-up sm:animate-spring flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] border border-border bg-card text-ink apple-shadow-elevated focus:outline-none sm:rounded-[26px] ${sizeClasses[size]} ${className}`}
		>
			<!-- Barre tactile iOS/Android pour glisser vers le bas sur mobile -->
			<div
				role="presentation"
				class="flex shrink-0 flex-col pt-2.5 sm:pt-0"
				ontouchstart={handleSheetTouchStart}
				ontouchmove={handleSheetTouchMove}
				ontouchend={handleSheetTouchEnd}
			>
				<div class="mx-auto mb-1 h-1 w-10 rounded-full bg-muted/30 sm:hidden" aria-hidden="true"></div>

				{#if title || description}
					<header class="flex items-start justify-between gap-3 border-b border-border px-5 pt-3 pb-3.5 sm:pt-5">
						<div class="min-w-0">
							{#if title}
								<h2 id={titleId} class="text-lg font-bold tracking-tight text-ink">
									{title}
								</h2>
							{/if}
							{#if description}
								<p id={descId} class="mt-1 text-sm text-muted">
									{description}
								</p>
							{/if}
						</div>
						<button
							type="button"
							onclick={close}
							aria-label="Fermer la fenêtre"
							class="gpu-press -mr-1.5 -mt-0.5 inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-surface-2 text-muted transition hover:text-ink"
						>
							<svg class="size-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6L6 18" />
							</svg>
						</button>
					</header>
				{:else}
					<div class="flex justify-end px-4 pt-2 sm:pt-3">
						<button
							type="button"
							onclick={close}
							aria-label="Fermer la fenêtre"
							class="gpu-press inline-flex size-9 cursor-pointer items-center justify-center rounded-full bg-surface-2 text-muted transition hover:text-ink"
						>
							<svg class="size-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6L6 18" />
							</svg>
						</button>
					</div>
				{/if}
			</div>

			<div class="flex-1 overflow-y-auto overscroll-contain px-5 py-4">
				{@render children?.()}
			</div>

			{#if footer}
				<footer
					class="flex flex-wrap items-center justify-end gap-2.5 border-t border-border bg-surface/70 px-5 pt-3.5"
					style="padding-bottom: max(0.875rem, env(safe-area-inset-bottom));"
				>
					{@render footer()}
				</footer>
			{:else}
				<div class="sm:hidden" style="height: env(safe-area-inset-bottom);"></div>
			{/if}
		</div>
	</div>
{/if}
