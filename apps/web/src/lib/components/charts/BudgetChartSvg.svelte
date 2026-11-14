<script lang="ts">
	export interface ProjectBudgetDatum {
		label: string;
		plannedCents: number;
		spentCents: number;
	}

	export interface CategorySpendDatum {
		category: string;
		totalCents: number;
	}

	interface Props {
		projects: Array<ProjectBudgetDatum>;
		categories: Array<CategorySpendDatum>;
		title?: string;
	}

	let { projects = [], categories = [], title = 'Analyse budgétaire' }: Props = $props();

	const DONUT_PALETTE = [
		{ fill: '#2563eb', name: 'Cobalt' },
		{ fill: '#0891b2', name: 'Cyan' },
		{ fill: '#16a34a', name: 'Émeraude' },
		{ fill: '#d97706', name: 'Ambre' },
		{ fill: '#dc2626', name: 'Corail' },
		{ fill: '#64748b', name: 'Ardoise' },
		{ fill: '#0284c7', name: 'Azur' },
		{ fill: '#65a30d', name: 'Olive' }
	] as const;

	const eurFormatter = new Intl.NumberFormat('fr-FR', {
		style: 'currency',
		currency: 'EUR',
		minimumFractionDigits: 0,
		maximumFractionDigits: 2
	});

	const eurCompactFormatter = new Intl.NumberFormat('fr-FR', {
		style: 'currency',
		currency: 'EUR',
		maximumFractionDigits: 0
	});

	const pctFormatter = new Intl.NumberFormat('fr-FR', {
		maximumFractionDigits: 1
	});

	function formatCents(cents: number): string {
		return eurFormatter.format((Number.isFinite(cents) ? cents : 0) / 100);
	}

	function formatCompactCents(cents: number): string {
		return eurCompactFormatter.format((Number.isFinite(cents) ? cents : 0) / 100);
	}

	function niceCeilCents(maxCents: number): number {
		if (maxCents <= 0) return 10000;
		const euros = maxCents / 100;
		const magnitude = Math.pow(10, Math.floor(Math.log10(euros)));
		const normalized = euros / magnitude;
		let niceNormalized = 10;
		if (normalized <= 1) niceNormalized = 1;
		else if (normalized <= 2) niceNormalized = 2;
		else if (normalized <= 2.5) niceNormalized = 2.5;
		else if (normalized <= 5) niceNormalized = 5;
		return Math.round(niceNormalized * magnitude * 100);
	}

	function truncateLabel(label: string, maxChars = 14): string {
		const trimmed = label.trim();
		if (trimmed.length <= maxChars) return trimmed;
		return `${trimmed.slice(0, maxChars - 1)}…`;
	}

	function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number) {
		const rad = ((angleDeg - 90) * Math.PI) / 180;
		return {
			x: cx + radius * Math.cos(rad),
			y: cy + radius * Math.sin(rad)
		};
	}

	function buildDonutArcPath(
		cx: number,
		cy: number,
		outerR: number,
		innerR: number,
		startAngle: number,
		endAngle: number
	): string {
		const sweep = endAngle - startAngle;
		const largeArcFlag = sweep > 180 ? 1 : 0;

		const outerStart = polarToCartesian(cx, cy, outerR, startAngle);
		const outerEnd = polarToCartesian(cx, cy, outerR, endAngle);
		const innerEnd = polarToCartesian(cx, cy, innerR, endAngle);
		const innerStart = polarToCartesian(cx, cy, innerR, startAngle);

		return [
			`M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
			`A ${outerR} ${outerR} 0 ${largeArcFlag} 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
			`L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
			`A ${innerR} ${innerR} 0 ${largeArcFlag} 0 ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
			'Z'
		].join(' ');
	}

	// Bar chart interaction state
	let hoveredProjectIdx = $state<number | null>(null);
	let pinnedProjectIdx = $state<number | null>(null);
	const activeProjectIdx = $derived(hoveredProjectIdx ?? pinnedProjectIdx);

	// Donut interaction state
	let hoveredCategoryIdx = $state<number | null>(null);
	let pinnedCategoryIdx = $state<number | null>(null);
	const activeCategoryIdx = $derived(hoveredCategoryIdx ?? pinnedCategoryIdx);

	// Sanitized datasets
	const sanitizedProjects = $derived(
		projects.map((p) => ({
			label: p.label?.trim() || 'Sans nom',
			plannedCents: Math.max(0, Number.isFinite(p.plannedCents) ? p.plannedCents : 0),
			spentCents: Math.max(0, Number.isFinite(p.spentCents) ? p.spentCents : 0)
		}))
	);

	// Grouped bar chart geometry
	const barChartHeight = 250;
	const barMargin = { top: 20, right: 20, bottom: 52, left: 68 };
	const barPlotHeight = barChartHeight - barMargin.top - barMargin.bottom;
	const groupStep = 86;

	const barChartWidth = $derived(
		Math.max(380, barMargin.left + barMargin.right + Math.max(1, sanitizedProjects.length) * groupStep)
	);
	const barPlotWidth = $derived(barChartWidth - barMargin.left - barMargin.right);

	const maxProjectCents = $derived(
		sanitizedProjects.reduce(
			(acc, item) => Math.max(acc, item.plannedCents, item.spentCents),
			0
		)
	);
	const yAxisMaxCents = $derived(niceCeilCents(maxProjectCents));
	const yTicks = $derived([0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
		ratio,
		valueCents: Math.round(yAxisMaxCents * ratio),
		y: barMargin.top + barPlotHeight * (1 - ratio)
	})));

	const barBars = $derived(
		sanitizedProjects.map((item, idx) => {
			const slotWidth = barPlotWidth / Math.max(1, sanitizedProjects.length);
			const centerX = barMargin.left + slotWidth * idx + slotWidth / 2;
			const barWidth = Math.min(24, Math.max(12, slotWidth * 0.28));
			const gap = 4;

			const plannedH = Math.max(
				item.plannedCents > 0 ? 3 : 0,
				(item.plannedCents / yAxisMaxCents) * barPlotHeight
			);
			const spentH = Math.max(
				item.spentCents > 0 ? 3 : 0,
				(item.spentCents / yAxisMaxCents) * barPlotHeight
			);

			const baseBottom = barMargin.top + barPlotHeight;
			const isOverBudget = item.spentCents > item.plannedCents && item.plannedCents > 0;
			const usagePct =
				item.plannedCents > 0 ? (item.spentCents / item.plannedCents) * 100 : item.spentCents > 0 ? 100 : 0;

			return {
				idx,
				...item,
				centerX,
				barWidth,
				plannedX: centerX - barWidth - gap / 2,
				plannedY: baseBottom - plannedH,
				plannedH,
				spentX: centerX + gap / 2,
				spentY: baseBottom - spentH,
				spentH,
				baseBottom,
				isOverBudget,
				usagePct,
				diffCents: item.plannedCents - item.spentCents
			};
		})
	);

	const activeProject = $derived(
		activeProjectIdx !== null && barBars[activeProjectIdx] ? barBars[activeProjectIdx] : null
	);

	// Donut geometry
	const donutSize = 220;
	const donutCenter = donutSize / 2;
	const donutOuterR = 92;
	const donutInnerR = 56;

	const sanitizedCategories = $derived(
		categories
			.map((c) => ({
				category: c.category?.trim() || 'Sans catégorie',
				totalCents: Math.max(0, Number.isFinite(c.totalCents) ? c.totalCents : 0)
			}))
			.filter((c) => c.totalCents > 0)
			.sort((a, b) => b.totalCents - a.totalCents)
	);

	const totalCategoryCents = $derived(
		sanitizedCategories.reduce((sum, item) => sum + item.totalCents, 0)
	);

	const donutSlices = $derived.by(() => {
		if (totalCategoryCents <= 0) return [];
		let cursorAngle = 0;
		const count = sanitizedCategories.length;
		const gapDeg = count > 1 ? 1.8 : 0;

		return sanitizedCategories.map((item, idx) => {
			const ratio = item.totalCents / totalCategoryCents;
			const sweep = ratio * 360;
			const startAngle = cursorAngle + gapDeg / 2;
			const endAngle = cursorAngle + sweep - gapDeg / 2;
			cursorAngle += sweep;

			const color = DONUT_PALETTE[idx % DONUT_PALETTE.length];
			const isFullCircle = count === 1 || endAngle - startAngle >= 359.5;

			return {
				idx,
				...item,
				ratio,
				percent: ratio * 100,
				color: color.fill,
				isFullCircle,
				path: isFullCircle
					? ''
					: buildDonutArcPath(
							donutCenter,
							donutCenter,
							donutOuterR,
							donutInnerR,
							startAngle,
							Math.max(startAngle + 0.5, endAngle)
						)
			};
		});
	});

	const activeSlice = $derived(
		activeCategoryIdx !== null && donutSlices[activeCategoryIdx]
			? donutSlices[activeCategoryIdx]
			: null
	);

	function handleProjectKeydown(event: KeyboardEvent, idx: number) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			pinnedProjectIdx = pinnedProjectIdx === idx ? null : idx;
		} else if (event.key === 'Escape') {
			pinnedProjectIdx = null;
			hoveredProjectIdx = null;
		} else if (event.key === 'ArrowRight' && barBars.length > 0) {
			event.preventDefault();
			const next = (idx + 1) % barBars.length;
			pinnedProjectIdx = next;
			const el = (event.currentTarget as SVGGElement | null)?.parentElement?.querySelector<SVGGElement>(
				`[data-project-idx="${next}"]`
			);
			el?.focus();
		} else if (event.key === 'ArrowLeft' && barBars.length > 0) {
			event.preventDefault();
			const prev = (idx - 1 + barBars.length) % barBars.length;
			pinnedProjectIdx = prev;
			const el = (event.currentTarget as SVGGElement | null)?.parentElement?.querySelector<SVGGElement>(
				`[data-project-idx="${prev}"]`
			);
			el?.focus();
		}
	}

	function handleCategoryKeydown(
		event: KeyboardEvent,
		idx: number,
		targetAttr: 'data-cat-slice' | 'data-cat-legend'
	) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			pinnedCategoryIdx = pinnedCategoryIdx === idx ? null : idx;
		} else if (event.key === 'Escape') {
			pinnedCategoryIdx = null;
			hoveredCategoryIdx = null;
		} else if (
			(event.key === 'ArrowDown' || event.key === 'ArrowRight') &&
			donutSlices.length > 0
		) {
			event.preventDefault();
			const next = (idx + 1) % donutSlices.length;
			pinnedCategoryIdx = next;
			const container = (event.currentTarget as Element | null)?.closest('[data-donut-panel]');
			container?.querySelector<HTMLElement>(`[${targetAttr}="${next}"]`)?.focus();
		} else if (
			(event.key === 'ArrowUp' || event.key === 'ArrowLeft') &&
			donutSlices.length > 0
		) {
			event.preventDefault();
			const prev = (idx - 1 + donutSlices.length) % donutSlices.length;
			pinnedCategoryIdx = prev;
			const container = (event.currentTarget as Element | null)?.closest('[data-donut-panel]');
			container?.querySelector<HTMLElement>(`[${targetAttr}="${prev}"]`)?.focus();
		}
	}

	const uid = $props.id();
	const barChartDescriptionId = `${uid}-bar-desc`;
	const donutTitleId = `${uid}-donut-title`;
	const donutChartDescriptionId = `${uid}-donut-desc`;
</script>

<section
	aria-label={title}
	class="grid grid-cols-1 gap-6 lg:grid-cols-12"
>
	<!-- Comparatif Prévisionnel vs Réel par projet -->
	<article
		class="lg:col-span-7 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-xs sm:p-6"
	>
		<header class="mb-4 flex flex-wrap items-start justify-between gap-3">
			<div>
				<h3 class="text-base font-semibold text-[var(--color-ink)]">
					Prévisionnel vs réel par projet
				</h3>
				<p class="mt-0.5 text-xs text-[var(--color-muted)]">
					Comparaison des budgets alloués et des dépenses engagées
				</p>
			</div>

			<div class="flex flex-wrap items-center gap-3 text-xs font-medium text-[var(--color-ink)]">
				<span class="inline-flex items-center gap-1.5">
					<span class="h-2.5 w-2.5 rounded-xs bg-zinc-500" aria-hidden="true"></span>
					Prévisionnel
				</span>
				<span class="inline-flex items-center gap-1.5">
					<span class="h-2.5 w-2.5 rounded-xs bg-blue-600" aria-hidden="true"></span>
					Réel
				</span>
				<span class="inline-flex items-center gap-1.5">
					<span class="h-2.5 w-2.5 rounded-xs bg-red-600" aria-hidden="true"></span>
					Dépassement
				</span>
			</div>
		</header>

		{#if barBars.length === 0}
			<div
				class="flex min-h-[220px] items-center justify-center rounded-xl border border-dashed border-[var(--color-border)] p-6 text-center text-sm text-[var(--color-muted)]"
			>
				Aucun projet budgétaire à afficher pour le moment.
			</div>
		{:else}
			<!-- Info-bulle accessible en lecture directe (évite tout chevauchement SVG sur mobile) -->
			<div
				aria-live="polite"
				class="mb-3 flex min-h-[2.75rem] flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs"
			>
				{#if activeProject}
					<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
						<span class="font-semibold text-[var(--color-ink)]">{activeProject.label}</span>
						<span class="text-[var(--color-muted)]">
							Prévu : <strong class="text-[var(--color-ink)]">{formatCents(activeProject.plannedCents)}</strong>
						</span>
						<span class="text-[var(--color-muted)]">
							Réel :
							<strong
								class={activeProject.isOverBudget
									? 'text-red-600 dark:text-red-400'
									: 'text-blue-600 dark:text-blue-400'}
							>
								{formatCents(activeProject.spentCents)}
							</strong>
						</span>
					</div>
					<span
						class="rounded-full px-2 py-0.5 font-semibold {activeProject.isOverBudget
							? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
							: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'}"
					>
						{activeProject.diffCents >= 0
							? `Reste ${formatCents(activeProject.diffCents)}`
							: `Écart +${formatCents(Math.abs(activeProject.diffCents))}`}
						({pctFormatter.format(activeProject.usagePct)} %)
					</span>
				{:else}
					<span class="text-[var(--color-muted)]">
						Survolez ou naviguez au clavier (Tab / Flèches) sur une barre pour consulter le détail.
					</span>
				{/if}
			</div>

			<div class="overflow-x-auto pb-1">
				<svg
					viewBox="0 0 {barChartWidth} {barChartHeight}"
					class="h-auto w-full min-w-[340px] select-none overflow-visible"
					role="group"
					aria-label="Graphique comparatif prévisionnel et réel par projet"
					aria-describedby={barChartDescriptionId}
				>
					<title>Comparatif budgétaire prévisionnel vs réel par projet</title>
					<desc id={barChartDescriptionId}>
						Diagramme en barres groupées comparant le budget prévisionnel et les dépenses réelles pour {barBars.length} projet(s).
					</desc>

					<!-- Grille horizontale Y -->
					{#each yTicks as tick}
						<line
							x1={barMargin.left}
							y1={tick.y}
							x2={barChartWidth - barMargin.right}
							y2={tick.y}
							stroke="currentColor"
							class="text-[var(--color-border)]"
							stroke-dasharray={tick.ratio === 0 ? undefined : '3 3'}
							stroke-width={tick.ratio === 0 ? 1.25 : 1}
						/>
						<text
							x={barMargin.left - 8}
							y={tick.y + 4}
							text-anchor="end"
							class="fill-[var(--color-muted)] text-[11px] font-medium"
						>
							{formatCompactCents(tick.valueCents)}
						</text>
					{/each}

					<!-- Groupes de barres par projet -->
					{#each barBars as item (item.idx)}
						{@const isSelected = activeProjectIdx === item.idx}
						{@const isDimmed = activeProjectIdx !== null && !isSelected}
						<g
							data-project-idx={item.idx}
							tabindex="0"
							role="button"
							aria-pressed={pinnedProjectIdx === item.idx}
							aria-label={`${item.label} : prévisionnel ${formatCents(item.plannedCents)}, réel ${formatCents(item.spentCents)}${item.isOverBudget ? ', dépassement budgétaire' : ''}`}
							class="bar-group cursor-pointer outline-none"
							class:is-dimmed={isDimmed}
							onmouseenter={() => (hoveredProjectIdx = item.idx)}
							onmouseleave={() => (hoveredProjectIdx = null)}
							onfocus={() => (hoveredProjectIdx = item.idx)}
							onblur={() => (hoveredProjectIdx = null)}
							onclick={() => (pinnedProjectIdx = pinnedProjectIdx === item.idx ? null : item.idx)}
							onkeydown={(e) => handleProjectKeydown(e, item.idx)}
						>
							<!-- Zone de capture tactile / focus -->
							<rect
								x={item.plannedX - 6}
								y={barMargin.top - 4}
								width={item.barWidth * 2 + 16}
								height={barPlotHeight + 34}
								rx="8"
								class="bar-focus-backdrop"
								class:is-active={isSelected}
							/>

							<!-- Barre Prévisionnel -->
							<rect
								x={item.plannedX}
								y={item.plannedY}
								width={item.barWidth}
								height={item.plannedH}
								rx="4"
								fill="#71717a"
								class="svg-bar"
								style:--bar-delay="{Math.min(item.idx * 45, 270)}ms"
							/>

							<!-- Barre Réel -->
							<rect
								x={item.spentX}
								y={item.spentY}
								width={item.barWidth}
								height={item.spentH}
								rx="4"
								fill={item.isOverBudget ? '#dc2626' : '#2563eb'}
								class="svg-bar"
								style:--bar-delay="{Math.min(item.idx * 45 + 30, 300)}ms"
							/>

							<!-- Étiquette projet -->
							<text
								x={item.centerX}
								y={item.baseBottom + 18}
								text-anchor="middle"
								class="fill-[var(--color-ink)] text-[11px] font-medium"
							>
								{truncateLabel(item.label)}
							</text>
							<text
								x={item.centerX}
								y={item.baseBottom + 33}
								text-anchor="middle"
								class="fill-[var(--color-muted)] text-[10px]"
							>
								{pctFormatter.format(item.usagePct)} %
							</text>
						</g>
					{/each}
				</svg>
			</div>
		{/if}
	</article>

	<!-- Répartition des dépenses par catégorie (Donut SVG) -->
	<article
		data-donut-panel
		class="lg:col-span-5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-xs sm:p-6"
	>
		<header class="mb-4">
			<h3 class="text-base font-semibold text-[var(--color-ink)]">
				Dépenses par catégorie
			</h3>
			<p class="mt-0.5 text-xs text-[var(--color-muted)]">
				Répartition des montants engagés
			</p>
		</header>

		{#if donutSlices.length === 0}
			<div
				class="flex min-h-[220px] items-center justify-center rounded-xl border border-dashed border-[var(--color-border)] p-6 text-center text-sm text-[var(--color-muted)]"
			>
				Aucune dépense catégorisée à afficher.
			</div>
		{:else}
			<div class="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
				<div class="relative shrink-0">
					<svg
						width={donutSize}
						height={donutSize}
						viewBox="0 0 {donutSize} {donutSize}"
						class="h-48 w-48 select-none sm:h-52 sm:w-52"
						role="group"
						aria-labelledby={donutTitleId}
						aria-describedby={donutChartDescriptionId}
					>
						<title id={donutTitleId}>Répartition des dépenses par catégorie</title>
						<desc id={donutChartDescriptionId}>
							Anneau représentant {formatCents(totalCategoryCents)} répartis sur {donutSlices.length} catégorie(s).
						</desc>

						<!-- Piste de fond -->
						<circle
							cx={donutCenter}
							cy={donutCenter}
							r={(donutOuterR + donutInnerR) / 2}
							fill="none"
							stroke="currentColor"
							stroke-width={donutOuterR - donutInnerR}
							class="text-[var(--color-surface)]"
						/>

						{#each donutSlices as slice (slice.idx)}
							{@const isActive = activeCategoryIdx === slice.idx}
							{@const isDimmed = activeCategoryIdx !== null && !isActive}
							{#if slice.isFullCircle}
								<circle
									data-cat-slice={slice.idx}
									cx={donutCenter}
									cy={donutCenter}
									r={(donutOuterR + donutInnerR) / 2}
									fill="none"
									stroke={slice.color}
									stroke-width={donutOuterR - donutInnerR}
									class="donut-slice cursor-pointer outline-none"
									class:is-active={isActive}
									class:is-dimmed={isDimmed}
									tabindex="0"
									role="button"
									aria-pressed={pinnedCategoryIdx === slice.idx}
									aria-label={`${slice.category} : ${formatCents(slice.totalCents)} (${pctFormatter.format(slice.percent)} %)`}
									onmouseenter={() => (hoveredCategoryIdx = slice.idx)}
									onmouseleave={() => (hoveredCategoryIdx = null)}
									onfocus={() => (hoveredCategoryIdx = slice.idx)}
									onblur={() => (hoveredCategoryIdx = null)}
									onclick={() =>
										(pinnedCategoryIdx = pinnedCategoryIdx === slice.idx ? null : slice.idx)}
									onkeydown={(e) => handleCategoryKeydown(e, slice.idx, 'data-cat-slice')}
								/>
							{:else}
								<path
									data-cat-slice={slice.idx}
									d={slice.path}
									fill={slice.color}
									class="donut-slice cursor-pointer outline-none"
									class:is-active={isActive}
									class:is-dimmed={isDimmed}
									tabindex="0"
									role="button"
									aria-pressed={pinnedCategoryIdx === slice.idx}
									aria-label={`${slice.category} : ${formatCents(slice.totalCents)} (${pctFormatter.format(slice.percent)} %)`}
									onmouseenter={() => (hoveredCategoryIdx = slice.idx)}
									onmouseleave={() => (hoveredCategoryIdx = null)}
									onfocus={() => (hoveredCategoryIdx = slice.idx)}
									onblur={() => (hoveredCategoryIdx = null)}
									onclick={() =>
										(pinnedCategoryIdx = pinnedCategoryIdx === slice.idx ? null : slice.idx)}
									onkeydown={(e) => handleCategoryKeydown(e, slice.idx, 'data-cat-slice')}
								/>
							{/if}
						{/each}
					</svg>

					<!-- Lecture centrale -->
					<div
						aria-live="polite"
						class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-7 text-center"
					>
						{#if activeSlice}
							<span class="max-w-[7rem] truncate text-[11px] font-medium text-[var(--color-muted)]">
								{activeSlice.category}
							</span>
							<span class="mt-0.5 text-sm font-bold text-[var(--color-ink)]">
								{formatCents(activeSlice.totalCents)}
							</span>
							<span class="text-[11px] font-semibold text-[var(--color-brand)]">
								{pctFormatter.format(activeSlice.percent)} %
							</span>
						{:else}
							<span class="text-[11px] font-medium text-[var(--color-muted)]">Total</span>
							<span class="mt-0.5 text-sm font-bold text-[var(--color-ink)]">
								{formatCompactCents(totalCategoryCents)}
							</span>
							<span class="text-[11px] text-[var(--color-muted)]">
								{donutSlices.length} cat.
							</span>
						{/if}
					</div>
				</div>

				<!-- Légende interactive WCAG AA -->
				<ul class="w-full min-w-0 flex-1 space-y-1.5" aria-label="Légende des catégories">
					{#each donutSlices as slice (slice.idx)}
						{@const isActive = activeCategoryIdx === slice.idx}
						{@const isDimmed = activeCategoryIdx !== null && !isActive}
						<li>
							<button
								type="button"
								data-cat-legend={slice.idx}
								aria-pressed={pinnedCategoryIdx === slice.idx}
								class="legend-btn flex w-full items-center justify-between gap-2 rounded-xl border px-2.5 py-2 text-left text-xs {isActive
									? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)]'
									: 'border-transparent hover:bg-[var(--color-surface)]'} {isDimmed
									? 'opacity-55'
									: 'opacity-100'}"
								onmouseenter={() => (hoveredCategoryIdx = slice.idx)}
								onmouseleave={() => (hoveredCategoryIdx = null)}
								onfocus={() => (hoveredCategoryIdx = slice.idx)}
								onblur={() => (hoveredCategoryIdx = null)}
								onclick={() =>
									(pinnedCategoryIdx = pinnedCategoryIdx === slice.idx ? null : slice.idx)}
								onkeydown={(e) => handleCategoryKeydown(e, slice.idx, 'data-cat-legend')}
							>
								<span class="flex min-w-0 items-center gap-2">
									<span
										class="h-3 w-3 shrink-0 rounded-full"
										style:background-color={slice.color}
										aria-hidden="true"
									></span>
									<span class="truncate font-medium text-[var(--color-ink)]">
										{slice.category}
									</span>
								</span>
								<span class="shrink-0 tabular-nums text-[var(--color-muted)]">
									<strong class="font-semibold text-[var(--color-ink)]">
										{formatCents(slice.totalCents)}
									</strong>
									<span class="ml-1">({pctFormatter.format(slice.percent)} %)</span>
								</span>
							</button>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</article>
</section>

<style>
	/* Animations strictement GPU (transform + opacity uniquement) */
	@keyframes barGrowY {
		from {
			opacity: 0;
			transform: scaleY(0);
		}
		to {
			opacity: 1;
			transform: scaleY(1);
		}
	}

	@keyframes donutPop {
		from {
			opacity: 0;
			transform: scale(0.92);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}

	.svg-bar {
		transform-box: fill-box;
		transform-origin: center bottom;
		animation: barGrowY 340ms cubic-bezier(0.22, 1, 0.36, 1) var(--bar-delay, 0ms) both;
		transition:
			transform 160ms cubic-bezier(0.22, 1, 0.36, 1),
			opacity 160ms ease;
	}

	.bar-group {
		transition: opacity 160ms ease;
	}

	.bar-group.is-dimmed {
		opacity: 0.42;
	}

	.bar-group:hover .svg-bar,
	.bar-group:focus-visible .svg-bar {
		transform: scaleY(1.03);
	}

	.bar-focus-backdrop {
		fill: var(--color-brand-soft);
		stroke: var(--color-brand);
		stroke-width: 1.5;
		opacity: 0;
		transition: opacity 150ms ease;
	}

	.bar-focus-backdrop.is-active,
	.bar-group:focus-visible .bar-focus-backdrop {
		opacity: 1;
	}

	.donut-slice {
		transform-box: view-box;
		transform-origin: 110px 110px;
		animation: donutPop 300ms cubic-bezier(0.22, 1, 0.36, 1) both;
		transition:
			transform 180ms cubic-bezier(0.22, 1, 0.36, 1),
			opacity 160ms ease;
	}

	.donut-slice.is-active,
	.donut-slice:focus-visible {
		transform: scale(1.045);
		opacity: 1;
	}

	.donut-slice.is-dimmed {
		opacity: 0.42;
	}

	.donut-slice:focus-visible {
		outline: 2px solid var(--color-brand);
		outline-offset: 2px;
	}

	.legend-btn {
		transition:
			transform 140ms cubic-bezier(0.22, 1, 0.36, 1),
			opacity 140ms ease;
	}

	.legend-btn:active {
		transform: scale(0.985);
	}

	@media (prefers-reduced-motion: reduce) {
		.svg-bar,
		.bar-group,
		.bar-focus-backdrop,
		.donut-slice,
		.legend-btn {
			animation: none !important;
			transition: none !important;
		}
	}
</style>
