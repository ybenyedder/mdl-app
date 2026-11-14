import { redirect } from '@sveltejs/kit';
import { hasPermission } from '$shared/permissions';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.needsAdminBootstrap) {
		throw redirect(303, '/setup');
	}
	if (
		locals.user &&
		hasPermission(locals.user.role, 'admin:settings') &&
		!locals.settings.setupCompleted
	) {
		throw redirect(302, '/setup');
	}
	if (locals.user) {
		throw redirect(302, '/dashboard');
	}
	return {};
};
