import express from 'express';

import { bindMethod } from '../../..';

import method$get from './get';

/**
 * Sets up /votes/{voteId}/stats
 * @return {express.Router}
 */
export function init () {
	const router = new express.Router({ mergeParams: true });

	bindMethod(router, '/', 'get', method$get);

	return router;
}
