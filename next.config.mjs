/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // pdfjs-dist optionally requires 'canvas' which isn't needed in Node
    config.resolve.alias.canvas = false
    return config
  },
}

export default nextConfig
