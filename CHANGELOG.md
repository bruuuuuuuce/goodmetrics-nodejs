# Changelog

## [0.6.0](https://github.com/bruuuuuuuce/goodmetrics-nodejs/compare/v0.5.0...v0.6.0) (2024-06-07)


### Features

* semver grpc-js and override core-js ([#32](https://github.com/bruuuuuuuce/goodmetrics-nodejs/issues/32)) ([84cac3e](https://github.com/bruuuuuuuce/goodmetrics-nodejs/commit/84cac3e5ec5893a2b2a9199b5fc471e6c6139110))

## [0.5.0](https://github.com/bruuuuuuuce/goodmetrics-nodejs/compare/v0.4.1...v0.5.0) (2024-05-28)


### Features

* add support for pointing lambda metrics to generic downstream o… ([#26](https://github.com/bruuuuuuuce/goodmetrics-nodejs/issues/26)) ([78a7056](https://github.com/bruuuuuuuce/goodmetrics-nodejs/commit/78a70568d83a48c7d0d84a83fdcd8539875f2a67))

## [0.4.1](https://github.com/bruuuuuuuce/goodmetrics-nodejs/compare/v0.4.0...v0.4.1) (2024-05-06)


### Bug Fixes

* make openTelemetryClient generic not lightstep specific ([#24](https://github.com/bruuuuuuuce/goodmetrics-nodejs/issues/24)) ([251d7fc](https://github.com/bruuuuuuuce/goodmetrics-nodejs/commit/251d7fc1e5b6b4c90faa53e9edba0accd63763a7))

## [0.4.0](https://github.com/bruuuuuuuce/goodmetrics-nodejs/compare/v0.3.2...v0.4.0) (2024-03-19)


### Features

* bump grpc js to version 1.10.0 ([#22](https://github.com/bruuuuuuuce/goodmetrics-nodejs/issues/22)) ([e75bbbc](https://github.com/bruuuuuuuce/goodmetrics-nodejs/commit/e75bbbc491568f5655ca410e8c17461a0f6db381))

## [0.3.2](https://github.com/bruuuuuuuce/goodmetrics-nodejs/compare/v0.3.1...v0.3.2) (2023-09-25)


### Bug Fixes

* properly wait at end to send last batch of metrics ([#18](https://github.com/bruuuuuuuce/goodmetrics-nodejs/issues/18)) ([99c20c7](https://github.com/bruuuuuuuce/goodmetrics-nodejs/commit/99c20c7e8f623e23e1132cf4205a23989b680bcd))

## [0.3.1](https://github.com/bruuuuuuuce/goodmetrics-nodejs/compare/v0.3.0...v0.3.1) (2023-09-25)


### Bug Fixes

* correct ! checks ([#14](https://github.com/bruuuuuuuce/goodmetrics-nodejs/issues/14)) ([1bd9c26](https://github.com/bruuuuuuuce/goodmetrics-nodejs/commit/1bd9c2691902da7a653e2ee7b0578539f847e662))
* use performance.now() and Date.now() correctly ([#17](https://github.com/bruuuuuuuce/goodmetrics-nodejs/issues/17)) ([fae9de7](https://github.com/bruuuuuuuce/goodmetrics-nodejs/commit/fae9de7871aa09eba8cc749546d23f46590d8907))

## [0.3.0](https://github.com/bruuuuuuuce/goodmetrics-nodejs/compare/v0.2.2...v0.3.0) (2023-09-22)


### Features

* bump the build ([4e1d240](https://github.com/bruuuuuuuce/goodmetrics-nodejs/commit/4e1d240d1ba77df7b424edbfbe0f166a7aefe019))

## [0.2.2](https://github.com/bruuuuuuuce/goodmetrics-nodejs/compare/v0.2.1...v0.2.2) (2023-09-22)


### Bug Fixes

* imports should not be pulled from dist dir ([#10](https://github.com/bruuuuuuuce/goodmetrics-nodejs/issues/10)) ([db7abd7](https://github.com/bruuuuuuuce/goodmetrics-nodejs/commit/db7abd76af7486b687e6c6faf1ca5b999af7a985))

## [0.2.1](https://github.com/bruuuuuuuce/goodmetrics-nodejs/compare/v0.2.0...v0.2.1) (2023-09-19)


### Bug Fixes

* build should run on every pr ([#8](https://github.com/bruuuuuuuce/goodmetrics-nodejs/issues/8)) ([4fb49fb](https://github.com/bruuuuuuuce/goodmetrics-nodejs/commit/4fb49fbfc9a54cdf49fbc9a149aed228321f9458))

## [0.2.0](https://github.com/bruuuuuuuce/goodmetrics-nodejs/compare/v0.1.2...v0.2.0) (2023-09-19)


### Features

* add native otlp support ([#4](https://github.com/bruuuuuuuce/goodmetrics-nodejs/issues/4)) ([c3477b1](https://github.com/bruuuuuuuce/goodmetrics-nodejs/commit/c3477b14c02a5148cd001160722050d076a68a35))
* add new metrics setup for goodmetrics client ([#6](https://github.com/bruuuuuuuce/goodmetrics-nodejs/issues/6)) ([6dd8446](https://github.com/bruuuuuuuce/goodmetrics-nodejs/commit/6dd8446e2bfeace3da8faedf552655229b45d46e))

## [0.1.2](https://github.com/bruuuuuuuce/goodmetrics-nodejs/compare/v0.1.1...v0.1.2) (2023-09-15)


### Bug Fixes

* channel credentials passed all the way through ([17ddf37](https://github.com/bruuuuuuuce/goodmetrics-nodejs/commit/17ddf376d43062a4e3448f97d8f028e642807e1d))

## [0.1.1](https://github.com/bruuuuuuuce/goodmetrics-nodejs/compare/v0.1.0...v0.1.1) (2023-09-15)


### Bug Fixes

* Delete src/goodmetrics/data/otlpDataPoints.ts ([e9e54fe](https://github.com/bruuuuuuuce/goodmetrics-nodejs/commit/e9e54fe34dd4e7a744a5acc408794a138cffb717))

## [0.1.0](https://github.com/bruuuuuuuce/goodmetrics-nodejs/compare/v0.0.1...v0.1.0) (2023-09-14)


### Features

* initial commit for goodmetrics nodejs client ([92ac57d](https://github.com/bruuuuuuuce/goodmetrics-nodejs/commit/92ac57d3e9dd7ac4c4cfb7211922aae808ed424b))
