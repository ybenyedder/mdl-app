export type ToastType = 'info' | 'success' | 'warning' | 'danger';

export interface ToastItem {
	id: string;
	type: ToastType;
	title: string;
	message?: string;
	duration: number;
}

export interface ToastOptions {
	type?: ToastType;
	title: string;
	message?: string;
	duration?: number;
}

const MAX_TOASTS = 5;
const DEFAULT_DURATION = 4200;

class ToastStore {
	items = $state<ToastItem[]>([]);
	private timers = new Map<string, ReturnType<typeof setTimeout>>();

	private nextId(): string {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return crypto.randomUUID();
		}
		return `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	}

	show(options: ToastOptions): string {
		const id = this.nextId();
		const duration = options.duration ?? DEFAULT_DURATION;
		const item: ToastItem = {
			id,
			type: options.type ?? 'info',
			title: options.title,
			message: options.message,
			duration
		};

		if (this.items.length >= MAX_TOASTS) {
			const oldest = this.items[0];
			if (oldest) this.dismiss(oldest.id);
		}

		this.items.push(item);

		if (typeof window !== 'undefined' && duration > 0) {
			const timer = setTimeout(() => this.dismiss(id), duration);
			this.timers.set(id, timer);
		}

		return id;
	}

	success(title: string, message?: string, duration?: number): string {
		return this.show({ type: 'success', title, message, duration });
	}

	error(title: string, message?: string, duration?: number): string {
		return this.show({ type: 'danger', title, message, duration: duration ?? 5500 });
	}

	warning(title: string, message?: string, duration?: number): string {
		return this.show({ type: 'warning', title, message, duration });
	}

	info(title: string, message?: string, duration?: number): string {
		return this.show({ type: 'info', title, message, duration });
	}

	dismiss(id: string): void {
		const timer = this.timers.get(id);
		if (timer) {
			clearTimeout(timer);
			this.timers.delete(id);
		}
		const idx = this.items.findIndex((t) => t.id === id);
		if (idx !== -1) {
			this.items.splice(idx, 1);
		}
	}

	clear(): void {
		for (const timer of this.timers.values()) {
			clearTimeout(timer);
		}
		this.timers.clear();
		this.items = [];
	}
}

export const toast = new ToastStore();
