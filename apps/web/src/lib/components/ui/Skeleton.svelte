<script lang="ts">
	type Variant = 'text' | 'circle' | 'rect' | 'card';

	interface Props {
		variant?: Variant;
		width?: string;
		height?: string;
		lines?: number;
		class?: string;
	}

	let {
		variant = 'text',
		width,
		height,
		lines = 1,
		class: className = ''
	}: Props = $props();

	const base = 'shimmer-surface bg-surface-2/90';
	const inlineStyle = $derived(
		[width ? `width: ${width};` : '', height ? `height: ${height};` : ''].filter(Boolean).join(' ')
	);
</script>

{#if variant === 'text'}
	<div class={`space-y-2 ${className}`} aria-hidden="true">
		{#each Array(Math.max(1, lines)) as _, idx (idx)}
			<div
				class={`${base} h-4 rounded-lg ${idx === lines - 1 && lines > 1 ? 'w-3/4' : 'w-full'}`}
				style={idx === 0 ? inlineStyle : height ? `height: ${height};` : undefined}
			></div>
		{/each}
	</div>
{:else if variant === 'circle'}
	<div
		aria-hidden="true"
		class={`${base} rounded-full size-10 shrink-0 ${className}`}
		style={inlineStyle}
	></div>
{:else if variant === 'card'}
	<div
		aria-hidden="true"
		class={`${base} rounded-[var(--radius-card)] h-32 w-full ${className}`}
		style={inlineStyle}
	></div>
{:else}
	<div
		aria-hidden="true"
		class={`${base} rounded-[var(--radius-btn)] h-20 w-full ${className}`}
		style={inlineStyle}
	></div>
{/if}
