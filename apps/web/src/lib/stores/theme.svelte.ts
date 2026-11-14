export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'mdl-theme';
const LIGHT_THEME_COLOR = '#f7f7f5';
const DARK_THEME_COLOR = '#0c0c0e';

function isThemeMode(value: string | null): value is ThemeMode {
	return value === 'light' || value === 'dark' || value === 'system';
}

class ThemeStore {
	mode = $state<ThemeMode>('system');
	systemDark = $state<boolean>(false);
	private initialized = false;
	private mediaQuery: MediaQueryList | null = null;

	resolved = $derived<ResolvedTheme>(
		this.mode === 'system' ? (this.systemDark ? 'dark' : 'light') : this.mode
	);

	isDark = $derived<boolean>(this.resolved === 'dark');

	constructor() {
		if (typeof window !== 'undefined') {
			this.init();
		}
	}

	init(): void {
		if (this.initialized || typeof window === 'undefined') return;
		this.initialized = true;

		try {
			const saved = window.localStorage.getItem(STORAGE_KEY);
			if (isThemeMode(saved)) {
				this.mode = saved;
			}
		} catch {
			// Storage unavailable (private mode / restricted context)
		}

		if (typeof window.matchMedia === 'function') {
			this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
			this.systemDark = this.mediaQuery.matches;

			const onChange = (event: MediaQueryListEvent) => {
				this.systemDark = event.matches;
				this.applyToDom();
			};

			if (typeof this.mediaQuery.addEventListener === 'function') {
				this.mediaQuery.addEventListener('change', onChange);
			}
		}

		this.applyToDom();
	}

	setMode(nextMode: ThemeMode): void {
		this.mode = nextMode;
		if (typeof window !== 'undefined') {
			try {
				window.localStorage.setItem(STORAGE_KEY, nextMode);
			} catch {
				// Ignore storage errors
			}
		}
		this.applyToDom();
	}

	toggle(): void {
		this.setMode(this.isDark ? 'light' : 'dark');
	}

	private applyToDom(): void {
		if (typeof document === 'undefined') return;
		const dark = this.resolved === 'dark';
		const root = document.documentElement;
		root.classList.toggle('dark', dark);
		root.style.colorScheme = dark ? 'dark' : 'light';

		const metaTheme = document.querySelector('meta[name="theme-color"]');
		if (metaTheme) {
			metaTheme.setAttribute('content', dark ? DARK_THEME_COLOR : LIGHT_THEME_COLOR);
		}
	}
}

export const theme = new ThemeStore();
