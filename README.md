# Twitter Video Thread Downloader

_Because sometimes, you just want to dowload that entire TikTok thread and watch them all on the big screen._

## Usage

```shell
npx twitter-video-threads [options] <tweetID>

Positionals:
tweetID  The ID of the most recent tweet to begin working backward from
[string]

Options:
--version         Show version number                                         [boolean]
-k, --api-key     Your Twitter API key                                        [string] [required]
                  (will overwrite env variable `TWITTER_API_KEY`)
-d, --destination Download destination folder for videos.                     [string] [default: ~/Downloads]
-l, --limit       Limit the total number of tweets to process.                [number] [default: Infinity]
-s, --stop-at     A tweet ID at which point to stop recursively downloading.  [string]
                  Helpful if you’ve already downloaded this thread before.
-v, --verbose     Chatty logs. More "v"s for more logging.                    [count] [default: 0]
--help            Show help                                                   [boolean]
```

### Some examples

First, I want to archive all of the videos from this thread, starting at 1368126334824837123, and save them in ~/Movies/TikToks

```shell
npx twitter-video-threads -k SAMPLEAPIKEY123456789 -d $HOME/Movies/TikToks 1368126334824837123
```

Now I'm going to move that API key into my shell's environment. There are new tweets in the thread, so I want to archive just the ones that were posted since my last archive.

```shell
export 'TWITTER_API_KEY=SAMPLEAPIKEY123456789'

npx twitter-video-threads --stop-at 1368126334824837123 1384389220912050179
```

In fact, all of the possible options can also be passed in as environment variables prepended with `TWITTER_` if you really want, i.e. `TWITTER_DESTINATION`, `TWITTER_LIMIT`, `TWITTER_STOP_AT`

Today I just want to archive this one because it keeps making me giggle.

```shell
npx twitter-video-threads --limit 1 1386693203936559105
```

## Development

Easy-peasy, all the functional code is in src/index.ts. To run uncompiled during development:

```shell
npm run dev -- [options] <tweetID>
```

To compile

```shell
npm run prepublish
```

To run local compiled version

```shell
./run.js [options] <tweetId>
```
