import type { NextConfig } from "next";
// @ts-ignore // next-i18next.config.js is a .js file, so we might need to ignore TS for this import
import { i18n } from "./next-i18next.config.js";

const nextConfig: NextConfig = {
  /* config options here */
  i18n, // Add the i18n configuration
  webpack(config, options) {
    const { isServer } = options;
    config.module.rules.push({
      test: /\.(ogg|mp3|wav|mpe?g)$/i,
      exclude: config.exclude,
      use: [
        {
          loader: require.resolve("url-loader"),
          options: {
            limit: config.inlineImageLimit,
            fallback: require.resolve("file-loader"),
            publicPath: `${config.assetPrefix}/_next/static/images/`,
            outputPath: `${isServer ? "../" : ""}static/images/`,
            name: "[name]-[hash].[ext]",
            esModule: config.esModule || false,
          },
        },
      ],
    });

    // Required for next-i18next under appDir:
    // Issue: https://github.com/i18next/next-i18next/issues/2020
    // Solution: https://github.com/i18next/next-i18next/issues/2020#issuecomment-1561397083
    // However, the recommended way for App Router is to use middleware or server components for i18n.
    // For `next-i18next` with App router, it's a bit different.
    // The `i18n` object in `next.config.js` is primarily for the Pages Router.
    // For App Router, `next-i18next` suggests server-side usage with `serverSideTranslations`.
    // Let's assume for now the goal is to make `public/locales` accessible and prepare for client components.
    // The `i18n` key in next.config.js might not be strictly necessary if only using client components with `useTranslation`.
    // We will manage language detection and context providing manually if needed for App Router.

    return config;
  },
};

export default nextConfig;
