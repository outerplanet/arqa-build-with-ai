/** @type {import('next').NextConfig} */
const nextConfig = {
	// Place photos are Wikimedia Commons files (Wikidata P18): originals on upload.wikimedia.org,
	// sized thumbnails on thumb.wikimedia.org. Only that path is optimised, and only with no query —
	// `commonsImage` (src/views/chat/model/placeLabels.ts) strips the `utm_*` tail and must allow the
	// same hosts. Any other image URL is refused and the card falls back to its category tile.
	images: {
		remotePatterns: [
			{
				hostname: 'thumb.wikimedia.org',
				pathname: '/wikipedia/commons/**',
				port: '',
				protocol: 'https',
				search: '',
			},
			{
				hostname: 'upload.wikimedia.org',
				pathname: '/wikipedia/commons/**',
				port: '',
				protocol: 'https',
				search: '',
			},
		],
	},
	output: 'standalone',
	// The dataset and its vectors are read from disk at runtime, not imported.
	outputFileTracingIncludes: {
		'/api/chat': ['./data/poi.json', './data/poi.vectors.json', './data/walking-graph.json'],
	},
	reactStrictMode: true,
};

export default nextConfig;
