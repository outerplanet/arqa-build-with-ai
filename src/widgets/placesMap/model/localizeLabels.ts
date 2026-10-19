interface StyleLayerLike {
	id: string;
	layout?: Record<string, unknown>;
	type: string;
}

/** Beyond this zoom a walk is inside one city, and its name only collides with the start marker. */
export const CITY_LABEL_MAX_ZOOM = 12;

/**
 * Symbol layers that print a city or town name (`label_city_capital` in positron, `place_city*`
 * in the dark style). Positron keeps «Астана» at every zoom, right on top of a start near Baiterek.
 */
export function cityLabelLayerIds(layers: readonly StyleLayerLike[]): string[] {
	return layers
		.filter((layer) => layer.type === 'symbol' && /^(?:label|place)_(?:city|town)(?:_|$)/u.test(layer.id))
		.map((layer) => layer.id);
}

/**
 * Symbol layers whose text is a place, street or water name. Road shields (`ref`) and layers
 * without text keep their own field.
 */
export function nameLabelLayerIds(layers: readonly StyleLayerLike[]): string[] {
	return layers
		.filter((layer) => {
			if (layer.type !== 'symbol') return false;
			const field = layer.layout?.['text-field'];
			if (field === undefined) return false;
			const text = JSON.stringify(field);
			return /"name(?:[:_][a-z]+)?"|\{name/u.test(text);
		})
		.map((layer) => layer.id);
}
