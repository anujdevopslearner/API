import path from 'path';

export default {
	schema: {
		query: null,
		body: {
			properties: {
				category: {
					type: 'string',
					minLength: 1,
					maxLength: 15,
					pattern: '^[^\\n]+$'
				},
				name: {
					type: 'string',
					minLength: 1,
					maxLength: 100,
					pattern: '^[^\\n]+$'
				},
				description: {
					oneOf: [
						{
							type: 'null'
						},
						{
							type: 'string',
							minLength: 1,
							maxLength: 1000
						}
					]
				},
				query: {
					type: 'object'
				}
			},
			additionalProperties: false,
			required: [ 'category', 'name', 'query' ]
		},
		requirePerms: 'queries.create'
	},

	run: async function run (req, res) {
		const id = (await AKSO.db('savedQueries')
			.insert({
				category: req.body.category,
				name: req.body.name,
				description: req.body.description,
				query: JSON.stringify(req.body.query)
			}))[0];

		res.set('Location', path.join(AKSO.conf.http.path, `/queries/${id}`));
		res.sendStatus(201);
	}
};
