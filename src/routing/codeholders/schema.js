import QueryUtil from '../../lib/query-util';

export const schema = {
	defaultFields: [ 'id' ],
	fields: {
		// Codeholder
		'id': 'f',
		'oldCode': 'f',
		'newCode': 'f',
		'codeholderType': 'f',
		'address.country': '',
		'address.countryArea': '',
		'address.city': '',
		'address.cityArea': '',
		'address.streetAddress': '',
		'address.postalCode': '',
		'address.sortingCode': '',
		'addressCountryGroups': 'f',
		'feeCountry': 'f',
		'feeCountryGroups': 'f',
		'addressLatin.country': 'f',
		'addressLatin.countryArea': 'fs',
		'addressLatin.city': 'fs',
		'addressLatin.cityArea': 'fs',
		'addressLatin.streetAddress': 'fs',
		'addressLatin.postalCode': 'fs',
		'addressLatin.sortingCode': 'fs',
		'searchAddress': 's',
		'email': 'fs',
		'notes': 'fs',
		'enabled': 'f',
		'officePhone': 's',
		'officePhoneFormatted': '',
		'isDead': 'f',
		'deathdate': 'f',
		'hasProfilePicture': 'f',
		'membership': '',
		'hasPassword': 'f',
		'isActiveMember': 'f',

		// HumanCodeholder
		'firstName': 'f',
		'firstNameLegal': 'f',
		'lastName': 'f',
		'lastNameLegal': 'f',
		'honorific': '',
		'birthdate': 'f',
		'age': 'f',
		'agePrimo': 'f',
		'profession': '',
		'landlinePhone': 's',
		'landlinePhoneFormatted': '',
		'cellphone': 's',
		'cellphoneFormatted': '',

		// OrgCodeholder
		'fullName': 'f',
		'fullNameLocal': 'f',
		'careOf': 'fs',
		'nameAbbrev': 'f'
	},
	fieldAliases: {
		'address.country': 'address_country',
		'address.countryArea': 'address_countryArea',
		'address.city': 'address_city',
		'address.cityArea': 'address_cityArea',
		'address.streetAddress': 'address_streetAddress',
		'address.postalCode': 'address_postalCode',
		'address.sortingCode': 'address_sortingCode',
		'addressLatin.country': 'address_country',
		'addressLatin.countryArea': 'address_countryArea_latin',
		'addressLatin.city': 'address_city_latin',
		'addressLatin.cityArea': 'address_cityArea_latin',
		'addressLatin.streetAddress': 'address_streetAddress_latin',
		'addressLatin.postalCode': 'address_postalCode_latin',
		'addressLatin.sortingCode': 'address_sortingCode_latin',
		'addressCountryGroups': () => AKSO.db.raw('(select group_concat(group_code) from countries_groups_members where countries_groups_members.country_code = view_codeholders.address_country)'),
		'feeCountryGroups': () => AKSO.db.raw('(select group_concat(group_code) from countries_groups_members where countries_groups_members.country_code = view_codeholders.feeCountry)'),
		'searchAddress': 'address_search',
		'officePhoneFormatted': 'officePhone',
		'landlinePhoneFormatted': 'landlinePhone',
		'cellphoneFormatted': 'cellphone',
		'membership': () => AKSO.db.raw('1'),
		'hasPassword': () => AKSO.db.raw('`password` is not null')
	},
	fieldSearchGroups: [
		'firstName,firstNameLegal,lastName,lastNameLegal',
		'fullName,fullNameLocal,nameAbbrev'
	],
	customSearch: {
		'name': match => AKSO.db.raw(
			`IF(codeholderType = "human",
				${match(['firstName', 'firstNameLegal', 'lastName', 'lastNameLegal'])},
				${match(['fullName', 'fullNameLocal', 'nameAbbrev'])}
			)`)
	},
	alwaysSelect: [
		'id',
		'codeholderType',
		'addressCountryGroups',
		'feeCountryGroups'
	],
	customFilterCompOps: {
		$hasAny: {
			addressCountryGroups: (query, arr) => {
				query.whereExists(function () {
					this.select(1).from('countries_groups_members')
						.whereRaw('`countries_groups_members`.`country_code` = `view_codeholders`.`address_country`')
						.whereIn('countries_groups_members.group_code', arr);
				});
			},
			feeCountryGroups: (query, arr) => {
				query.whereExists(function () {
					this.select(1).from('countries_groups_members')
						.whereRaw('`countries_groups_members`.`country_code` = `view_codeholders`.`address_country`')
						.whereIn('countries_groups_members.group_code', arr);
				});
			}
		}
	},
	customFilterLogicOps: {
		$membership: (fields, query, obj) => {
			if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
				const err = new Error('$membership expects an object');
				err.statusCode = 400;
				throw err;
			}
			query.whereExists(function () {
				this.select(1)
					.from('membershipCategories_codeholders')
					.innerJoin('membershipCategories', 'membershipCategories.id', 'membershipCategories_codeholders.categoryId')
					.whereRaw('`codeholderId` = `view_codeholders`.`id`');

				QueryUtil.filter(
					[
						'categoryId',
						'givesMembership',
						'lifetime',
						'year'
					],
					this,
					obj
				);
			});
		}
	}
};

export function memberFilter (schema, query, req) {
	QueryUtil.filter(
		Object.keys(schema.fields)
			.filter(x => schema.fields[x].indexOf('f' > -1)),
		query,
		req.memberFilter,
		schema.fieldAliases
	);
}

export function memberFields (defaultFields, req, res, flag, memberFields) {
	const fields = req.query.fields || schema.defaultFields;

	const haveFlag = memberFieldsManual(fields, req, flag, memberFields);
	if (!haveFlag) {
		res.status(403).type('text/plain').send('Illegal codeholder fields used, check /perms');
	}

	return haveFlag;
}

export function memberFieldsManual (fields, req, flag, memberFields) {
	if (memberFields === undefined) { memberFields = req.memberFields; }
	if (req.memberFields === null) { return true; }

	const haveFlag = fields
		.map(f => f.split('.')[0])
		.map(f => {
			if (!(f in memberFields)) { return false; }
			return memberFields[f].indexOf(flag) > -1;
		})
		.reduce((a, b) => a && b);

	return haveFlag;
}

export async function afterQuery (arr, done) {
	if (!arr.length || !arr[0].membership) { return done(); }

	const codeholders = {};
	const ids = arr.map(x => {
		codeholders[x.id] = x;
		x.membership = [];
		return x.id;
	});
	// See: https://stackoverflow.com/a/47696704/1248084
	// Obtains the two most relevant membership entries for the codeholder
	const memberships = await AKSO.db.raw(`
		SELECT
		    \`categoryId\`,
		    \`codeholderId\`,
		    \`year\`,
		    \`nameAbbrev\`,
		    \`name\`,
		    \`lifetime\`

			FROM (
			    SELECT
		        	*,
		            (@rn := if(@prev = codeholderId, @rn + 1, 1)) AS rn,
		            @prev := codeholderId

		        FROM (
		            SELECT
		                \`categoryId\`,
		                \`codeholderId\`,
		                \`year\`,
		                \`nameAbbrev\`,
		                \`name\`,
		                \`lifetime\`
		            
		            FROM membershipCategories_codeholders

		            INNER JOIN membershipCategories
		                ON membershipCategories.id = membershipCategories_codeholders.categoryId

		            WHERE
		            	\`codeholderId\` IN (${ids.map(() => '?').join(',')}) AND
		                \`givesMembership\` AND
		                \`year\` <= YEAR(CURDATE())

		            ORDER BY
		                codeholderId,
		                \`lifetime\` desc,
		                \`year\` desc
		            
		        ) AS \`sortedTable\`
		        
		        JOIN (SELECT @prev := NULL, @rn := 0) AS \`vars\`
			    
			) AS \`groupedTable\`
		    
		    WHERE rn <= 2
	`,

	ids
	);

	for (let membership of memberships[0]) {
		codeholders[membership.codeholderId].membership.push({
			categoryId: membership.categoryId,
			year: membership.year,
			nameAbbrev: membership.nameAbbrev,
			name: membership.name,
			lifetime: !!membership.lifetime
		});
	}
	

	done();
}

export const profilePictureSizes = [
	32, 64, 128, 256, 512
];
