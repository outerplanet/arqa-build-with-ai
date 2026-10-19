/** @type {import('next').NextConfig} */
const nextConfig = {
	// Place photos are Wikimedia Commons files (Wikidata P18). Only that path is optimised; any other
	// image URL is refused by next/image and the card falls back to its category tile.
	images: {
		remotePatterns: [{ hostname: 'upload.wikimedia.org', pathname: '/wikipedia/commons/**', protocol: 'https' }],
	},
	output: 'standalone',
	// The dataset and its vectors are read from disk at runtime, not imported.
	outputFileTracingIncludes: {
		'/api/chat': ['./data/poi.json', './data/poi.vectors.json'],
	},
	reactStrictMode: true,
};

export default nextConfig;
