import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	return {
		user: locals.user,
		settings: locals.settings,
		roles: locals.roles,
		needsAdminBootstrap: locals.needsAdminBootstrap
	};
};
