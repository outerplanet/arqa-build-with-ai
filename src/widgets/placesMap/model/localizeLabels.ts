interface StyleLayerLike {
	id: string;
	layout?: Record<string, unknown>;
	type: string;
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
