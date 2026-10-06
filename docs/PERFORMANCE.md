# Performance budget
- Route pages are lazy loaded through React Router in `apps/web/src/router.tsx`.
- Catalog requests are cached by TanStack Query and PWA runtime caching.
- Images should be served as responsive WebP/AVIF assets with explicit dimensions and `loading="lazy"` below the fold.
- Fonts should use `font-display: swap` and subset the English/Bengali ranges.
- Hover/focus preloading is opt-in and must not prefetch authenticated or private routes.
- CI must run Lighthouse against a deployed preview with `lhci` and enforce performance >= 90, accessibility >= 90, best-practices >= 90, and SEO >= 90.
