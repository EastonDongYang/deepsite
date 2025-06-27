// next-i18next.config.js

/** @type {import('next-i18next').UserConfig} */
module.exports = {
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'zh'], // 支持英文和中文
    localeDetection: false, // 禁用基于浏览器的语言检测，我们将依赖URL或手动切换
  },
  // debug: process.env.NODE_ENV === 'development', // 在开发模式下开启debug日志
  reloadOnPrerender: process.env.NODE_ENV === 'development', // 开发模式下重新加载翻译
  // ns: ['common'], // 默认的命名空间
  // defaultNS: 'common', // 默认命名空间
  // localePath: typeof window === 'undefined' ? require('path').resolve('./public/locales') : '/locales',
  // Commenting out localePath for now, as default behavior with App Router might be different or handled by next-i18next internals.
  // If using Pages Router, path.resolve is common. For App Router, it's often simpler.
};
