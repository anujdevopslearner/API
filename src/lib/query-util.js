import SimpleCollection from './simple-collection';
import SimpleResource from './resources/simple-resource';

/**
 * Asserts the input to be a scalar (Buffer, string, number, boolean, null)
 * @param  {Buffer, string,number,boolean,null} val
 * @throws {Error} If the input isn't scalar
 */
function filterAssertScalar (val) {
	if (!(val instanceof Buffer) && typeof val !== 'string' && typeof val !== 'number' && typeof val !== 'boolean' && val !== null) {
		const err = new Error('Invalid field comparison value used in ?filter');
		err.statusCode = 400;
		throw err;
	}
	if (typeof val === 'number' && !Number.isFinite(val)) {
		const err = new Error('Non-finite field value used in ?filter');
		err.statusCode = 400;
		throw err;
	}
}

/**
 * Asserts the input to be a number
 * @param  {number} val
 * @throws {Error} If the input isn't a number
 */
function filterAssertNumber (val) {
	if (typeof val !== 'number' || !Number.isFinite(val)) {
		const err = new Error('Invalid number in ?filter');
		err.statusCode = 400;
		throw err;
	}
}

/**
 * Asserts the input to be an array
 * @param  {Array} val
 * @throws {Error} If the input isn't an array
 */
function filterAssertArray (val) {
	if (!Array.isArray(val)) {
		const err = new Error('Expected array in ?filter');
		err.statusCode = 400;
		throw err;
	}
}

/**
 * Asserts the input to be a basic object (not an array or null)
 * @param  {Object} val
 * @throws {Error} If the input isn't an object
 */
function filterAssertObject (val) {
	if (typeof val !== 'object' || val === null || Array.isArray(val)) {
		const err = new Error('Expected object in ?filter');
		err.statusCode = 400;
		throw err;
	}
}

function getAlias (fieldAliases, field, includeAs = true) {
	if (!fieldAliases) { return field; }
	const alias = fieldAliases[field];
	if (!alias) { return field; }
	if (typeof alias === 'string') { return alias; }
	if (typeof alias === 'function') {
		let newField = alias();
		if (includeAs) { newField = AKSO.db.raw(newField + ' as ??', field); }
		return newField;
	}
}

const filterLogicOps = {
	$and: function filterLogicOpAnd (fields, query, filterArr, fieldAliases, fieldWhitelist, customCompOps, customLogicOps) {
		filterAssertArray(filterArr);
		filterArr.forEach(filterAssertObject);

		query.where(function () {
			for (let obj of filterArr) {
				QueryUtil.filter(fields, this, obj, fieldAliases, fieldWhitelist, customCompOps, customLogicOps);
			}
		});
	},
	$or: function filterLogicOpOr (fields, query, filterArr, fieldAliases, fieldWhitelist, customCompOps, customLogicOps) {
		filterAssertArray(filterArr);
		filterArr.forEach(filterAssertObject);

		query.where(function () {
			for (let obj of filterArr) {
				this.orWhere(function () {
					QueryUtil.filter(fields, this, obj, fieldAliases, fieldWhitelist, customCompOps, customLogicOps);
				});
			}
		});
	},
	$not: function filterLogicOpNot (fields, query, filterObj, fieldAliases, fieldWhitelist, customCompOps, customLogicOps) {
		filterAssertObject(filterObj);

		query.whereNot(function () {
			QueryUtil.filter(fields, this, filterObj, fieldAliases, fieldWhitelist, customCompOps, customLogicOps);
		});
	}
};

const filterCompOps = {
	$eq: function filterCompOpEq (field, query, val) {
		filterAssertScalar(val);

		query.where(field, val);
	},
	$neq: function filterCompOpNeq (field, query, val) {
		filterAssertScalar(val);

		query.whereNot(field, val);
	},
	$gt: function filterCompOpGt (field, query, val) {
		filterAssertNumber(val);

		query.where(field, '>', val);
	},
	$gte: function filterCompOpGte (field, query, val) {
		filterAssertNumber(val);

		query.where(field, '>=', val);
	},
	$lt: function filterCompOpLt (field, query, val) {
		filterAssertNumber(val);

		query.where(field, '<', val);
	},
	$lte: function filterCompOpLte (field, query, val) {
		filterAssertNumber(val);

		query.where(field, '<=', val);
	},
	$in: function filterCompOpIn (field, query, val) {
		filterAssertArray(val);
		val.forEach(filterAssertScalar);

		query.whereIn(field, val);
	},
	$nin: function filterCompOpNin (field, query, val) {
		filterAssertArray(val);
		val.forEach(filterAssertScalar);

		query.whereNotIn(field, val);
	}
};

const QueryUtil = {
	/**
	 * Handles the ?filter parameter
	 * @param {string[]}          fields           The permitted filterable fields
	 * @param {knex.QueryBuilder} query            The query builder to apply the where statement to
	 * @param {Object}            filterObj        The filter object as supplied by `req.query.filter`
	 * @param {Object}            [fieldAliases]   The field aliases as defined in the schema
	 * @param {Array}             [fieldWhitelist] The filterable fields used for per client whitelisting
	 * @param {Object}            [customCompOps]  Custom comparison operators. See `/src/routing/codeholders/schema.js` for usage
	 * @param {Object}            [customLogicOps] Custom logic operators. See `/src/routing/codeholders/schema.js` for usage
	 */
	filter: function queryUtilFilter (fields, query, filterObj, fieldAliases = {}, fieldWhitelist = null, customCompOps = {}, customLogicOps = {}) {
		if (!fieldWhitelist) { fieldWhitelist = fields; }

		query.where(function () {
			for (let key in filterObj) { // Iterate through each key
				if (fields.indexOf(key) > -1) { // key is a field
					// Ensure the client has the necessary permissions
					if (fieldWhitelist.indexOf(key) === -1) {
						const err = new Error(`Disallowed field ${key} used in ?filter`);
						err.statusCode = 403;
						throw err;
					}

					let val = filterObj[key];
					if (val === null || val instanceof Buffer || (typeof val !== 'object' && !(val instanceof Array))) { // normal equality
						val = { $eq: val }; // turn into an $eq comparison operator
					}

					// Handle comparison operator
					this.where(function () {
						for (let compOp in val) {
							// Check if the field is an alias
							const orgKey = key;
							key = getAlias(fieldAliases, key, false);

							if (compOp in filterCompOps) {
								filterCompOps[compOp](key, this, val[compOp]);
							} else if (compOp in customCompOps && orgKey in customCompOps[compOp]) {
								val = val[compOp];
								if (compOp === '$hasAny') {
									if (!Array.isArray(val)) { val = [ val ]; }
									val.forEach(x => filterAssertScalar(x));
								}
								customCompOps[compOp][orgKey](this, val);
							} else {
								const err = new Error(`Unknown comparison operator ${compOp} used in ?filter`);
								err.statusCode = 400;
								throw err;
							}
						}
					});

				} else if (key in filterLogicOps || key in customLogicOps) {
					// Check if the field is an alias
					key = getAlias(fieldAliases, key);

					let filter;
					if (key in filterLogicOps) { filter = filterLogicOps[key]; }
					else { filter = customLogicOps[key]; }

					filter(fields, this, filterObj[key], fieldAliases, fieldWhitelist, customCompOps, customLogicOps);
				} else {
					const err = new Error(`Unknown field or logical operator ${key} used in ?filter`);
					err.statusCode = 400;
					throw err;
				}
			}
		});
	},

	/**
	 * Handles a simple resource
	 * @param {express.Request}   req
	 * @param {Object}            schema The endpoint's schema
	 * @param {knex.QueryBuilder} query  The query to build upon
	 */
	simpleResource: function queryUtilSimpleResource (req, schema, query) {
		// ?fields
		const fields = req.query.fields || schema.defaultFields;

		// Get the actual db col names
		const selectFields = fields
			.concat(schema.alwaysSelect || [])
			.map(f => getAlias(schema.fieldAliases, f));
		query.first(selectFields);
	},

	/**
	 * Handles a simple collection
	 * @param  {express.Request}   req
	 * @param  {Object}            schema           The endpoint's schema
	 * @param  {knex.QueryBuilder} query            The query to build upon
	 * @param  {Array}             [fieldWhitelist] The permitted fields for per client whitelisting
	 * @return {Object} An object containing metadata on the collection:
	 *     {knex.QueryBuilder} `totalItems`        The total amount of items in the collection without `?limit` and `?offset`
	 *     {knex.QueryBuilder} `totalItemNoFilter` The total amount of items in the collection without `?limit`, `?offset`, `?search` and `?filter`
	 */
	simpleCollection: function queryUtilSimpleCollection (req, schema, query, fieldWhitelist = null) {
		// ?fields, ?search
		const fields = req.query.fields || schema.defaultFields;
		// Get the actual db col names
		const selectFields = fields
			.concat(schema.alwaysSelect || [])
			.map(f => getAlias(schema.fieldAliases, f));

		if (req.query.search) {
			if (fieldWhitelist && !req.query.search.cols.every(f => fieldWhitelist.includes(f))) {
				const err = new Error('Disallowed field used in ?search');
				err.statusCode = 403;
				throw err;
			}

			const allCols = req.query.search.cols.join(',');
			if (allCols in schema.customSearch) {
				const customSearchFn = schema.customSearch[allCols];
				const matchFn = cols => AKSO.db.raw(
					`MATCH (${'??,'.repeat(cols.length).slice(0,-1)})
					AGAINST (? IN BOOLEAN MODE)`,

					[ ...cols, req.query.search.query ]
				);
				const searchStmt = customSearchFn(matchFn);
				selectFields.push(AKSO.db.raw(searchStmt + ' as `_relevance`'));
				query.whereRaw(searchStmt);

			} else {
				const searchCols = req.query.search.cols.map(f => getAlias(schema.fieldAliases, f));
				selectFields.push(AKSO.db.raw(
					`MATCH (${'??,'.repeat(searchCols.length).slice(0,-1)})
					AGAINST (? IN BOOLEAN MODE) as ??`,

					[ ...searchCols, req.query.search.query, '_relevance' ]
				));
				query.whereRaw(
					`MATCH (${'??,'.repeat(searchCols.length).slice(0,-1)})
					AGAINST (? IN BOOLEAN MODE)`,

					[ ...searchCols, req.query.search.query ]
				);
			}
		}

		query.select(selectFields);

		if (schema.alwaysWhere) { schema.alwaysWhere(query, req); }
		// ?filter
		if (req.query.filter) {
			QueryUtil.filter(
				Object.keys(schema.fields)
					.filter(x => schema.fields[x].indexOf('f' > -1)),
				query,
				req.query.filter,
				schema.fieldAliases || {},
				fieldWhitelist,
				schema.customFilterCompOps,
				schema.customFilterLogicOps
			);
		}

		// ?order
		if (req.query.order) {
			if (fieldWhitelist && !req.query.order.map(x => x.column).every(f => fieldWhitelist.includes(f))) {
				const err = new Error('Disallowed field used in ?order');
				err.statusCode = 403;
				throw err;
			}
			query.orderBy(req.query.order);
		}

		// ?limit
		query.limit(req.query.limit || schema.maxQueryLimit);

		// ?offset
		if (req.query.offset) {
			query.offset(req.query.offset);
		}

		const metadata = {};
		const metaQuery = query.clone();

		metaQuery
			.clearSelect()
			.first(AKSO.db.raw('count(1) as `count`'))

			.clearOrder()
			.limit(Number.MAX_SAFE_INTEGER)
			.offset(0);

		metadata.totalItems = metaQuery.clone();

		metaQuery.clearWhere();
		if (schema.alwaysWhere) { schema.alwaysWhere(metaQuery, req); }
		metadata.totalItemNoFilter = metaQuery.clone();

		return metadata;
	},

	/**
	 * Sets collection metadata headers 
	 * @param {express.Response} res      
	 * @param {Object}           metadata Metadata obtained from #simpleCollection
	 */
	async collectionMetadata (res, metadata) {
		res.set('X-Total-Items', (await metadata.totalItems).count);
		res.set('X-Total-Items-No-Filter', (await metadata.totalItemNoFilter).count);
	},

	/**
	 * Handles an entire basic collection
	 * @param {express.Request}   req
	 * @param {express.Response}  res
	 * @param {Object}            schema           The schema as used in bindMethod
	 * @param {knex.QueryBuilder} query            The query to build upon
	 * @param {Object}            [Res]            The resource type to use
	 * @param {Object}            [Col]            The collection type to use
	 * @param {Object}            [passToCol]      Variables to pass to the collection's constructor
	 * @param {Array}             [fieldWhitelist] The permitted fields for per client whitelisting
	 * @param {Function}          [afterQuery]     A function to run after the query has been performed, before it's passed to the collection. Receives two arguments, the returned array and a callback to run when all modifications are done.
	 */
	async handleCollection (req, res, schema, query, Res = SimpleResource, Col = SimpleCollection, passToCol = [], fieldWhitelist = null, afterQuery) {
		await QueryUtil.collectionMetadata(res, 
			QueryUtil.simpleCollection(req, schema, query, fieldWhitelist)
		);
		const rawData = await query;
		if (afterQuery) { await new Promise(resolve => afterQuery(rawData, resolve)); }
		const data = new Col(rawData, Res, ...passToCol);
		res.sendObj(data);
	}
};

export default QueryUtil;
