# Changelog

## 0.4.1

- Added "hd" and "keywords" meta tags

## 0.4.0

- Add new option: "through-date", to give downloads a hard stop after (well, before, actually) a certain date

## 0.3.4

- Same as last tag, but better

## 0.3.3

- Fix mishandled promise on http error handling

## 0.3.2

- Improve HTTP error handling
- Better metadata on video file

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
