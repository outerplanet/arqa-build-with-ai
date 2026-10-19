/** @type {import('next').NextConfig} */
const nextConfig = {
	output: 'standalone',
	// Python inference and its immutable index are runtime assets, not JS imports.
	outputFileTracingIncludes: {
		'/api/chat': ['./scripts/vector_search.py', './data/poi.json', './data/poi.vectors.json'],
	},
	reactStrictMode: true,
};

export default nextConfig;
