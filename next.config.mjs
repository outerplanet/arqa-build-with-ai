/** @type {import('next').NextConfig} */
const nextConfig = {
	output: 'standalone',
	// The dataset and its vectors are read from disk at runtime, not imported.
	outputFileTracingIncludes: {
		'/api/chat': ['./data/poi.json', './data/poi.vectors.json'],
	},
	reactStrictMode: true,
};

export default nextConfig;
