# Changelog

## 0.3.1

- Include types

## 0.3.0

- Update packages
  - Major version on dotenv & node-fetch
  - devdeps: major version on ts-node
- fix "stop-at" arg to stop at any tweet after the specified one, so it doesn't just go forever in the event of a transposed number or something
- handle http errors a little better
- add video metadata
- mkdir at destination if it doesn't already exist
- improve exit messages
- output successes & failures on sigint
